"""
Job execution pipeline: download -> flash -> capture -> upload -> cleanup.

JobRunner.run_job() is launched as a background task by /execute. A single
module-level `job_runner` also exposes `busy` so the heartbeat loop can report
arm_status correctly.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import Dict, Optional

from backend_client import backend_client
from config import config
from hardware import FpgaError, fpga_controller
from simulator import CaptureSource, PLDmaCapture, SimulatedCapture

logger = logging.getLogger("board_agent.runner")


class JobRunner:
    def __init__(self, capture: Optional[CaptureSource] = None) -> None:
        # Default to production PLDmaCapture (which gracefully handles DRY_RUN as needed)
        self.capture: CaptureSource = capture or PLDmaCapture()
        self.busy: bool = False
        self.current_job_id: Optional[str] = None

    async def run_job(
        self,
        *,
        job_id: str,
        result_id: str,
        binary_url: str,
        fw_url: str,
        params: Optional[Dict] = None,
    ) -> None:
        params = params or {}
        self.busy = True
        self.current_job_id = job_id
        work = Path(config.work_dir) / job_id
        work.mkdir(parents=True, exist_ok=True)
        started = time.time()
        passed = False
        error: Optional[str] = None
        result_bytes = 0
        try:
            logger.info("job %s: starting pipeline (result=%s)", job_id, result_id)

            fw_ext = ".app" if (".app" in fw_url.lower() or "app" in fw_url.lower() or ".bin" not in fw_url.lower()) else ".bin"
            fw_path = work / f"firmware{fw_ext}"
            await backend_client.download_asset(fw_url, fw_path)

            stimulus_path = None
            if binary_url:
                # Support .sh (Linux shell / devmem), .ist, .hex, .bin stimulus
                if ".sh" in binary_url.lower():
                    ext = ".sh"
                elif ".ist" in binary_url.lower():
                    ext = ".ist"
                elif ".hex" in binary_url.lower():
                    ext = ".hex"
                else:
                    ext = ".bin"
                stimulus_path = work / f"stimulus{ext}"
                await backend_client.download_asset(binary_url, stimulus_path)

            # Flash FPGA PL Bitstream
            fpga_controller.flash(str(fw_path))

            # Hardware Capture (Direct LZ4 Output)
            capture_path = work / "scope_capture.bin.lz4"
            capture_params = {
                "stimulus_path": str(stimulus_path) if stimulus_path and stimulus_path.exists() else None,
                "instruction_path": str(stimulus_path) if stimulus_path and stimulus_path.exists() else None,
                **params,
            }
            result_bytes = self.capture.capture(capture_path, capture_params)

            # Upload via REST Chunked Upload Protocol
            receiver_url = params.get("result_receiver_url")
            upload = await backend_client.upload_result(capture_path, f"{result_id}.bin.lz4", receiver_url=receiver_url)
            passed = True
            logger.info("job %s: completed, uploaded result -> %s", job_id, upload.get("hdf5_file_path") or upload.get("upload_id"))
        except FpgaError as exc:
            error = f"flash error: {exc}"
            logger.error("job %s: %s", job_id, error)
        except Exception as exc:  # noqa: BLE001 - report any failure back to backend
            error = str(exc)
            logger.exception("job %s failed", job_id)
        finally:
            receiver_url = params.get("result_receiver_url") if params else None
            await backend_client.post_measurements(
                job_id,
                result_id,
                {
                    "passed": passed,
                    "error_message": error,
                    "duration_seconds": round(time.time() - started, 3),
                    "result_bytes": result_bytes,
                    "capture_source": self.capture.name,
                },
                receiver_url=receiver_url,
            )
            shutil.rmtree(work, ignore_errors=True)
            self.busy = False
            self.current_job_id = None


job_runner = JobRunner()


class LocalQueueManager:
    def __init__(self, runner: JobRunner) -> None:
        self.runner = runner
        self.queue: list[dict] = []
        self._loop_task: Optional[asyncio.Task] = None

    def add_job(
        self,
        erom_path: Optional[str], erom_filename: Optional[str],
        ist_path: Optional[str] = None, ist_filename: Optional[str] = None,
        vcd_path: Optional[str] = None, vcd_filename: Optional[str] = None,
        ulp_path: Optional[str] = None, ulp_filename: Optional[str] = None,
        params: dict = None,
        job_id: Optional[str] = None
    ) -> str:
        if not job_id:
            job_id = f"local-{uuid.uuid4().hex[:8]}"
        final_ist_path = ist_path or vcd_path
        final_ist_filename = ist_filename or vcd_filename
        job = {
            "job_id": job_id,
            "status": "pending",
            "erom_path": erom_path,
            "erom_filename": erom_filename,
            "ist_path": final_ist_path,
            "ist_filename": final_ist_filename,
            "vcd_path": final_ist_path,
            "vcd_filename": final_ist_filename,
            "ulp_path": ulp_path,
            "ulp_filename": ulp_filename,
            "params": params or {},
            "error": None,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "started_at": None,
            "completed_at": None,
        }
        self.queue.append(job)
        return job_id

    def get_status(self) -> list[dict]:
        res = []
        for j in self.queue:
            res.append({
                "job_id": j["job_id"],
                "status": j["status"],
                "erom_filename": j["erom_filename"],
                "ist_filename": j.get("ist_filename") or j.get("vcd_filename"),
                "vcd_filename": j.get("vcd_filename") or j.get("ist_filename"),
                "ulp_filename": j["ulp_filename"],
                "params": j["params"],
                "error": j["error"],
                "created_at": j["created_at"],
                "started_at": j["started_at"],
                "completed_at": j["completed_at"],
            })
        return res

    def clear(self) -> None:
        self.queue = [j for j in self.queue if j["status"] in ("pending", "running")]

    async def start(self) -> None:
        if self._loop_task is None or self._loop_task.done():
            self._loop_task = asyncio.create_task(self._process_queue_loop())

    async def stop(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass

    async def _process_queue_loop(self) -> None:
        logger.info("Local queue processor loop started")
        while True:
            try:
                # Find the first pending job
                job = next((j for j in self.queue if j["status"] == "pending"), None)
                if job and not self.runner.busy:
                    await self._run_local_job(job)
                else:
                    await asyncio.sleep(1.0)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in queue processor loop")
                await asyncio.sleep(2.0)

    async def _run_local_job(self, job: dict) -> None:
        job["status"] = "running"
        job["started_at"] = datetime.utcnow().isoformat() + "Z"
        self.runner.busy = True
        self.runner.current_job_id = job["job_id"]
        
        logger.info("Starting local queued job: %s", job["job_id"])
        
        # Job directory
        job_dir = Path(config.work_dir) / "manual" / job["job_id"]
        job_dir.mkdir(parents=True, exist_ok=True)
        
        capture_path = Path(config.work_dir) / "manual" / "scope_capture.bin"
        
        try:
            # 1. Move and setup EROM (Firmware/Bitstream)
            erom_local_path = None
            if job["erom_path"] and Path(job["erom_path"]).exists():
                erom_local_path = job_dir / "firmware.bin"
                shutil.copy2(job["erom_path"], erom_local_path)
                logger.info("Queued job %s: flashing EROM %s", job["job_id"], job["erom_filename"])
                fpga_controller.flash(str(erom_local_path))

            # 2. Move IST (Stimulus Instructions)
            ist_local_path = None
            stimulus_input = job.get("ist_path") or job.get("vcd_path")
            stimulus_name = job.get("ist_filename") or job.get("vcd_filename") or "stimulus.ist"
            if stimulus_input and Path(stimulus_input).exists():
                ext = Path(stimulus_name).suffix or ".ist"
                ist_local_path = job_dir / f"stimulus{ext}"
                shutil.copy2(stimulus_input, ist_local_path)
                logger.info("Queued job %s: copied IST stimulus %s", job["job_id"], stimulus_name)

            # 3. Move ULP (Config)
            ulp_local_path = None
            if job["ulp_path"] and Path(job["ulp_path"]).exists():
                ulp_local_path = job_dir / "config.ulp"
                shutil.copy2(job["ulp_path"], ulp_local_path)
                logger.info("Queued job %s: copied ULP config %s", job["job_id"], job["ulp_filename"])
                
            # 4. Trigger Capture
            logger.info("Queued job %s: triggering capture", job["job_id"])
            raw_params = job["params"]
            duration_ms = 100.0
            try:
                duration_ms = float(raw_params.get("durationMs", "100"))
            except ValueError:
                pass
                
            # Parse sampling rate (e.g. 1MS/s -> 1,000,000)
            rate_str = raw_params.get("samplingRate", "1MS/s") or "1MS/s"
            rate_hz = 1_000_000.0
            if "M" in rate_str:
                try: rate_hz = float(rate_str.split("M")[0]) * 1_000_000.0
                except ValueError: pass
            elif "k" in rate_str:
                try: rate_hz = float(rate_str.split("k")[0]) * 1_000.0
                except ValueError: pass
                
            parsed_params = {
                "duration_seconds": duration_ms / 1000.0,
                "sample_rate_hz": rate_hz,
                # Pass file paths to CaptureSource
                "erom_path": str(erom_local_path) if erom_local_path else None,
                "ist_path": str(ist_local_path) if ist_local_path else None,
                "instruction_path": str(ist_local_path) if ist_local_path else None,
                "vcd_path": str(ist_local_path) if ist_local_path else None,
                "ulp_path": str(ulp_local_path) if ulp_local_path else None,
                "stimulus_path": str(ist_local_path or ulp_local_path) if (ist_local_path or ulp_local_path) else None,
            }
            
            # Run capture
            self.runner.capture.capture(capture_path, parsed_params)
            job["status"] = "completed"
            logger.info("Queued job %s: completed successfully", job["job_id"])
        except Exception as e:
            job["status"] = "failed"
            job["error"] = str(e)
            logger.exception("Queued job %s failed", job["job_id"])
        finally:
            job["completed_at"] = datetime.utcnow().isoformat() + "Z"
            
            # Clean up job work directory
            shutil.rmtree(job_dir, ignore_errors=True)
            
            # Clean up temporary uploads
            for path_key in ("erom_path", "ist_path", "vcd_path", "ulp_path"):
                if job.get(path_key):
                    try:
                        p = Path(job[path_key])
                        if p.exists():
                            if p.is_file():
                                p.unlink()
                            if p.parent.name == job["job_id"]:
                                shutil.rmtree(p.parent, ignore_errors=True)
                    except Exception:
                        pass
            
            self.runner.busy = False
            self.runner.current_job_id = None


local_queue_manager = LocalQueueManager(job_runner)
