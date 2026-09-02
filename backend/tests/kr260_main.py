"""
On-board agent for KR260 / ZynqMP.

FastAPI app (default port 8000) that:
  - registers with the backend on boot and runs a heartbeat loop
  - exposes /health and /system/reboot (called by backend board_manager)
  - exposes /execute to receive a job, then runs download->flash->capture->upload

Run on a dev PC:
  DRY_RUN=1 BACKEND_URL=http://127.0.0.1:8000 BOARD_ID=test-kr260 \
    uvicorn main:app --port 8000
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
from contextlib import asynccontextmanager
from datetime import datetime
import shutil
from pathlib import Path
from typing import Optional, Dict

import uuid
from fastapi import BackgroundTasks, FastAPI, File, UploadFile, Form
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend_client import backend_client
from config import config
from hardware import fpga_controller
from metrics import get_cpu_load, get_cpu_temp, get_fpga_status, get_ram_usage
from runner import job_runner, local_queue_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("board_agent")

# Serialize board-claim (busy) checks so two concurrent requests can't both
# see busy=False and start work at the same time.
_board_lock = asyncio.Lock()


def _safe_filename(name: Optional[str], fallback: str) -> str:
    """Return just the basename of a client-supplied filename (no path traversal)."""
    base = Path(name or "").name
    if base in ("", ".", ".."):
        return fallback
    return base


async def _heartbeat_loop() -> None:
    while True:
        try:
            busy = job_runner.busy
            await backend_client.send_heartbeat(
                cpu_temp=get_cpu_temp(),
                cpu_load=get_cpu_load(),
                ram_usage=get_ram_usage(),
                status="BUSY" if busy else "IDLE",
                fpga_status=get_fpga_status(),
                arm_status="busy" if busy else "online",
            )
        except Exception:  # noqa: BLE001 - never let the loop die
            logger.exception("heartbeat loop iteration failed")
        await asyncio.sleep(config.heartbeat_interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "agent starting board_id=%s backend=%s dry_run=%s",
        config.board_id, config.base_url, config.dry_run,
    )
    await backend_client.register()
    hb_task = asyncio.create_task(_heartbeat_loop())
    await local_queue_manager.start()
    try:
        yield
    finally:
        await local_queue_manager.stop()
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass
        await backend_client.aclose()


app = FastAPI(title="KR260 Board Agent", version="0.1.0", lifespan=lifespan)

static_dir = Path(__file__).resolve().parent / "static"
static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")


class ExecuteRequest(BaseModel):
    job_id: str
    result_id: str
    # Either supply file IDs (resolved against the agent's own backend base, the
    # robust default) or explicit full URLs (override).
    fw_file_id: Optional[str] = None
    binary_file_id: Optional[str] = None
    fw_url: Optional[str] = None
    binary_url: Optional[str] = None
    params: Optional[Dict] = None

    def resolved_fw_url(self) -> str:
        if self.fw_url:
            return self.fw_url
        if self.fw_file_id:
            return f"{config.base_url}/api/files/{self.fw_file_id}/content"
        raise ValueError("fw_url or fw_file_id is required")

    def resolved_binary_url(self) -> str:
        if self.binary_url:
            return self.binary_url
        if self.binary_file_id:
            return f"{config.base_url}/api/files/{self.binary_file_id}/content"
        return ""


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "board_id": config.board_id,
        "busy": job_runner.busy,
        "fpga_status": get_fpga_status(),
    }


@app.post("/execute", status_code=202)
async def execute(payload: ExecuteRequest, background: BackgroundTasks) -> dict:
    try:
        fw_url = payload.resolved_fw_url()
    except ValueError as exc:
        return {"accepted": False, "reason": str(exc)}
    # Atomically claim the board so two concurrent /execute calls can't both start.
    async with _board_lock:
        if job_runner.busy:
            return {"accepted": False, "reason": "board busy", "current_job_id": job_runner.current_job_id}
        job_runner.busy = True
        job_runner.current_job_id = payload.job_id
    background.add_task(
        job_runner.run_job,
        job_id=payload.job_id,
        result_id=payload.result_id,
        binary_url=payload.resolved_binary_url(),
        fw_url=fw_url,
        params=payload.params,
    )
    return {"accepted": True, "job_id": payload.job_id}


@app.post("/system/reboot")
async def reboot() -> dict:
    if config.dry_run:
        logger.info("[DRY_RUN] reboot requested (skipped)")
        return {"status": "ok", "dry_run": True}
    subprocess.Popen(["sudo", "reboot"])
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def get_index():
    index_path = Path(__file__).resolve().parent / "index.html"
    if index_path.exists():
        return HTMLResponse(content=index_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>index.html not found</h1>", status_code=404)


@app.get("/api/telemetry")
async def get_telemetry():
    return {
        "board_id": config.board_id,
        "name": config.name,
        "model": config.model,
        "firmware": config.firmware_version,
        "status": "busy" if job_runner.busy else "online",
        "cpu_temp": get_cpu_temp(),
        "cpu_load": get_cpu_load(),
        "ram_usage": get_ram_usage(),
        "fpga_status": get_fpga_status(),
        "busy": job_runner.busy,
        "current_job_id": job_runner.current_job_id,
        "last_heartbeat": datetime.utcnow().isoformat() + "Z",
    }


@app.post("/api/flash")
async def local_flash(file: UploadFile = File(...)):
    async with _board_lock:
        if job_runner.busy:
            return {"success": False, "reason": "Board is currently busy"}
        job_runner.busy = True
        job_runner.current_job_id = "manual-flash"
    # Create a temp file in work_dir (basename only — never trust client path)
    temp_dir = Path(config.work_dir) / "manual"
    temp_dir.mkdir(parents=True, exist_ok=True)
    fw_path = temp_dir / _safe_filename(file.filename, "firmware.bin")
    try:
        content = await file.read()
        fw_path.write_bytes(content)
        # Flash it
        status = fpga_controller.flash(str(fw_path))
        return {"success": True, "fpga_status": status}
    except Exception as e:
        return {"success": False, "reason": str(e)}
    finally:
        # Cleanup temp file
        try:
            if fw_path.exists():
                fw_path.unlink()
        except Exception:
            pass
        job_runner.busy = False
        job_runner.current_job_id = None


class CaptureRequest(BaseModel):
    samplingRate: Optional[str] = None
    durationMs: Optional[str] = None
    channels: Optional[str] = None
    triggerMode: Optional[str] = None
    voltageRange: Optional[str] = None


@app.post("/api/capture")
async def local_capture(payload: CaptureRequest):
    async with _board_lock:
        if job_runner.busy:
            return {"success": False, "reason": "Board is currently busy"}
        job_runner.busy = True
        job_runner.current_job_id = "manual"

    temp_dir = Path(config.work_dir) / "manual"
    temp_dir.mkdir(parents=True, exist_ok=True)
    capture_path = temp_dir / "scope_capture.bin"
    try:
        params = {
            "samplingRate": payload.samplingRate,
            "durationMs": payload.durationMs,
            "channels": payload.channels,
            "triggerMode": payload.triggerMode,
            "voltageRange": payload.voltageRange,
        }
        result_bytes = job_runner.capture.capture(capture_path, params)
        return {"success": True, "result_bytes": result_bytes}
    except Exception as e:
        return {"success": False, "reason": str(e)}
    finally:
        job_runner.busy = False
        job_runner.current_job_id = None


def _load_latest_capture_raw() -> Optional[bytes]:
    base = Path(config.work_dir) / "manual"
    bin_path = base / "scope_capture.bin"
    lz4_path = base / "scope_capture.bin.lz4"
    if bin_path.exists():
        return bin_path.read_bytes()
    if lz4_path.exists():
        try:
            import lz4.frame
            decompressed = lz4.frame.decompress(lz4_path.read_bytes())
            # Cache decompressed .bin for faster subsequent reads
            try:
                bin_path.write_bytes(decompressed)
            except Exception:
                pass
            return decompressed
        except Exception as e:
            logger.error("Failed to decompress LZ4 capture: %s", e)
            return None
    return None


@app.get("/api/latest-capture")
async def get_latest_capture():
    content = _load_latest_capture_raw()
    if not content:
        return {"success": False, "reason": "No capture data available"}
    try:
        import struct
        num_samples = len(content) // 2
        step = max(1, num_samples // 1000)
        samples = []
        for i in range(0, num_samples, step):
            val = struct.unpack_from("<h", content, i * 2)[0]
            samples.append(val)
        return {"success": True, "samples": samples, "total_samples": num_samples}
    except Exception as e:
        return {"success": False, "reason": str(e)}


@app.get("/api/download-latest")
async def download_latest():
    base = Path(config.work_dir) / "manual"
    bin_path = base / "scope_capture.bin"
    if not bin_path.exists():
        content = _load_latest_capture_raw()
        if not content:
            return HTMLResponse(content="<h1>No capture data available to download</h1>", status_code=404)
        bin_path.write_bytes(content)

    return FileResponse(
        path=bin_path,
        filename="scope_capture.bin",
        media_type="application/octet-stream"
    )


@app.get("/api/download-latest-csv")
async def download_latest_csv():
    content = _load_latest_capture_raw()
    if not content:
        return HTMLResponse(content="<h1>No capture data available to download</h1>", status_code=404)
    
    try:
        import struct
        num_samples = len(content) // 2
        
        # Write temporary CSV file
        csv_path = Path(config.work_dir) / "manual" / "scope_capture.csv"
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        
        with csv_path.open("w", encoding="utf-8") as f:
            f.write("Index,Value\n")
            for i in range(num_samples):
                val = struct.unpack_from("<h", content, i * 2)[0]
                f.write(f"{i},{val}\n")
                
        return FileResponse(
            path=csv_path,
            filename="scope_capture.csv",
            media_type="text/csv"
        )
    except Exception as e:
        return HTMLResponse(content=f"<h1>Error generating CSV: {str(e)}</h1>", status_code=500)


@app.get("/api/queue/status")
async def get_queue_status():
    return {
        "busy": job_runner.busy,
        "current_job_id": job_runner.current_job_id,
        "queue": local_queue_manager.get_status()
    }


@app.post("/api/queue/add")
async def add_to_queue(
    erom: Optional[UploadFile] = File(None),
    ist: Optional[UploadFile] = File(None),
    vcd: Optional[UploadFile] = File(None),
    ulp: Optional[UploadFile] = File(None),
    samplingRate: str = Form("1MS/s"),
    durationMs: str = Form("100"),
    channels: str = Form("A"),
    triggerMode: str = Form("auto")
):
    job_id = f"local-{uuid.uuid4().hex[:8]}"
    temp_job_dir = Path(config.work_dir) / "queue_temp" / job_id
    temp_job_dir.mkdir(parents=True, exist_ok=True)

    erom_path = None
    erom_filename = None
    if erom and erom.filename:
        erom_filename = erom.filename
        erom_path = str(temp_job_dir / f"erom_{_safe_filename(erom_filename, 'erom.bin')}")
        try:
            content = await erom.read()
            Path(erom_path).write_bytes(content)
        except Exception as e:
            shutil.rmtree(temp_job_dir, ignore_errors=True)
            return {"success": False, "reason": f"Failed to save EROM file: {str(e)}"}

    ist_upload = ist or vcd
    ist_path = None
    ist_filename = None
    if ist_upload and ist_upload.filename:
        ist_filename = ist_upload.filename
        ist_path = str(temp_job_dir / f"ist_{_safe_filename(ist_filename, 'stimulus.ist')}")
        try:
            content = await ist_upload.read()
            Path(ist_path).write_bytes(content)
        except Exception as e:
            shutil.rmtree(temp_job_dir, ignore_errors=True)
            return {"success": False, "reason": f"Failed to save IST file: {str(e)}"}

    ulp_path = None
    ulp_filename = None
    if ulp and ulp.filename:
        ulp_filename = ulp.filename
        ulp_path = str(temp_job_dir / f"ulp_{_safe_filename(ulp_filename, 'config.ulp')}")
        try:
            content = await ulp.read()
            Path(ulp_path).write_bytes(content)
        except Exception as e:
            shutil.rmtree(temp_job_dir, ignore_errors=True)
            return {"success": False, "reason": f"Failed to save ULP file: {str(e)}"}

    params = {
        "samplingRate": samplingRate,
        "durationMs": durationMs,
        "channels": channels,
        "triggerMode": triggerMode,
    }
    
    local_queue_manager.add_job(
        erom_path=erom_path, erom_filename=erom_filename,
        ist_path=ist_path, ist_filename=ist_filename,
        ulp_path=ulp_path, ulp_filename=ulp_filename,
        params=params,
        job_id=job_id
    )
    return {"success": True, "job_id": job_id}


@app.post("/api/queue/clear")
async def clear_queue():
    local_queue_manager.clear()
    return {"success": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=config.agent_port)
