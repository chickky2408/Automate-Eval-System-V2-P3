"""
Result waveform receiver for board agents.

Implements the REST chunked init/part/complete protocol with LZ4 decompression,
generating both HDF5 analog dataset and VCD logic trace waveform artifacts on server RAM/NVMe.

Mounted without a prefix so the agent's `{backend}/v1/upload/...` calls resolve.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from db.database import async_session
from db.orm_models import FileORM, FileType, ResultORM, TestCaseORM
from services.file_store import file_store
from services.waveform_comparator import waveform_comparator_service
from services.waveform_file import convert_bin_to_vcd, trim_bin_beats

router = APIRouter()


class InitUploadRequest(BaseModel):
    upload_id: Optional[str] = None
    total_size_bytes: Optional[int] = Field(None, gt=0)
    part_size_bytes: int = Field(..., gt=0)
    target_filename: Optional[str] = None


class CompleteUploadRequest(BaseModel):
    expected_total_size_bytes: Optional[int] = Field(None, gt=0)
    expected_total_parts: Optional[int] = Field(None, gt=0)


class _Session:
    def __init__(self, upload_id: str, target_filename: str, tmp_path: str):
        self.upload_id = upload_id
        self.target_filename = target_filename
        self.tmp_path = tmp_path
        self.file_obj = open(tmp_path, "wb")
        self.bytes_received = 0
        self.parts_received = 0
        self.received_parts: set[int] = set()
        self.hasher = hashlib.sha256()
        self.last_activity = datetime.utcnow().timestamp()
        self.lock = asyncio.Lock()


SESSIONS: Dict[str, _Session] = {}
_TMP_DIR = file_store.resolve_path("uploads/_agent_tmp")
os.makedirs(_TMP_DIR, exist_ok=True)


async def cleanup_stale_upload_sessions(max_idle_seconds: float = 600) -> int:
    """Purge upload sessions that have been idle longer than max_idle_seconds (default 10 mins)."""
    now = datetime.utcnow().timestamp()
    stale_ids = []
    for upload_id, session in list(SESSIONS.items()):
        if now - session.last_activity > max_idle_seconds:
            stale_ids.append(upload_id)

    cleaned_count = 0
    for upload_id in stale_ids:
        session = SESSIONS.pop(upload_id, None)
        if session:
            try:
                session.file_obj.close()
            except Exception:
                pass
            try:
                if os.path.exists(session.tmp_path):
                    os.remove(session.tmp_path)
            except Exception:
                pass
            cleaned_count += 1
            print(f"[agent_results] Cleaned up stale upload session {upload_id}")
    return cleaned_count


def _result_id_from_filename(name: str) -> str:
    base = Path(name).name
    # Strip compound extensions like .bin.lz4 or .tar.gz
    for ext in (".bin.lz4", ".lz4", ".bin", ".tar.gz", ".h5", ".vcd"):
        if base.endswith(ext):
            base = base[:-len(ext)]
            break
    return base


def _is_lz4_file(file_path: str) -> bool:
    try:
        with open(file_path, "rb") as f:
            magic = f.read(4)
            return magic in (b"\x04\x22\x4d\x18", b"\x02\x21\x4c\x18")
    except Exception:
        return False


def _decompress_lz4_to_bin(lz4_path: str, raw_bin_path: str) -> int:
    import lz4.frame

    os.makedirs(os.path.dirname(raw_bin_path), exist_ok=True)
    with lz4.frame.open(lz4_path, "rb") as src, open(raw_bin_path, "wb") as dst:
        while True:
            chunk = src.read(16 * 1024 * 1024)
            if not chunk:
                break
            dst.write(chunk)
    return os.path.getsize(raw_bin_path)


CHANNEL_NAMES = ["CH0", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7"]
CHANNEL_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#34495e"]


def _convert_to_hdf5(bin_path: str, h5_path: str, stride: int, offset: int, word_size: int = 1) -> int:
    """Write both the flat 'raw' dataset (legacy/back-compat) and a 'channels'
    group extracted with the same stride/byte-offset as the VCD writer, so the
    waveform viewer shows the same bit-level channels as the logic trace
    instead of the unfiltered raw AXI beat bytes.
    """
    import h5py
    import numpy as np

    total = os.path.getsize(bin_path)
    sample_count = total // 2
    os.makedirs(os.path.dirname(h5_path), exist_ok=True)

    num_channels = min(len(CHANNEL_NAMES), word_size * 8)

    with h5py.File(h5_path, "w") as h5f:
        data = np.memmap(bin_path, dtype="<i2", mode="r", shape=(sample_count,)) if sample_count else np.array([], dtype="<i2")
        ds = h5f.create_dataset("raw", data=np.asarray(data, dtype="<i2"))
        ds.attrs["source_bin"] = Path(bin_path).name
        ds.attrs["sample_count"] = sample_count
        ds.attrs["created_at_unix"] = datetime.utcnow().timestamp()

        grp = h5f.create_group("channels")
        extracted_count = total // stride if stride > 0 else 0
        if extracted_count > 0:
            raw_bytes = np.fromfile(bin_path, dtype=np.uint8, count=extracted_count * stride)
            raw_bytes = raw_bytes[: extracted_count * stride].reshape(extracted_count, stride)
            column = raw_bytes[:, offset:offset + word_size].copy().view(dtype=np.uint8).reshape(-1)
            for i in range(num_channels):
                bit_vals = ((column >> i) & 1).astype(np.uint8)
                cds = grp.create_dataset(CHANNEL_NAMES[i], data=bit_vals, compression="gzip")
                cds.attrs["color"] = CHANNEL_COLORS[i]

        h5f.attrs["sample_rate_hz"] = 1.0e8  # 10 ns/sample, matches the VCD timescale
        h5f.attrs["time_unit"] = "us"
        h5f.attrs["total_duration"] = (extracted_count * 10e-9 / 1e-6) if extracted_count else 0.0

    return os.path.getsize(h5_path)


def _process_waveform_artifacts(tmp_path: str, target_filename: str, abs_h5: str, abs_vcd: str, abs_lz4: str) -> tuple[int, int, int]:
    """
    Saves permanent compressed .bin.lz4, temporarily decompresses to generate HDF5 and VCD,
    then immediately purges the temporary raw .bin file to save storage.
    Returns (h5_size, vcd_size, lz4_size).
    """
    is_lz4 = _is_lz4_file(tmp_path) or target_filename.endswith(".lz4")
    os.makedirs(os.path.dirname(abs_lz4), exist_ok=True)
    os.makedirs(os.path.dirname(abs_h5), exist_ok=True)
    os.makedirs(os.path.dirname(abs_vcd), exist_ok=True)

    # 1. Store permanent compressed .bin.lz4 directly to abs_lz4
    if is_lz4:
        shutil.copy2(tmp_path, abs_lz4)
    else:
        import lz4.frame
        with open(tmp_path, "rb") as fin, lz4.frame.open(abs_lz4, "wb") as fout:
            shutil.copyfileobj(fin, fout, length=4 * 1024 * 1024)

    lz4_size = os.path.getsize(abs_lz4) if os.path.exists(abs_lz4) else 0

    # 2. Decompress temporarily to extract HDF5 and VCD
    tmp_raw_bin = abs_lz4 + f".{uuid.uuid4().hex[:8]}.tmp.bin"
    try:
        _decompress_lz4_to_bin(abs_lz4, tmp_raw_bin)
        bin_size = os.path.getsize(tmp_raw_bin) if os.path.exists(tmp_raw_bin) else 0
        stride = 16 if (bin_size % 16 == 0 and bin_size >= 16) else 1
        offset = 0x0C if stride == 16 else 0

        # 3. Generate HDF5 Dataset (raw + extracted channels, same stride/offset as VCD below)
        h5_size = _convert_to_hdf5(tmp_raw_bin, abs_h5, stride=stride, offset=offset)

        # 4. Generate Logic Trace VCD (bus mode: monitor_data [15:0])
        vcd_size = 0
        if bin_size > 0:
            convert_bin_to_vcd(
                bin_filepath=tmp_raw_bin,
                vcd_filepath=abs_vcd,
                stride_bytes=stride,
                byte_offset=offset,
                timescale="1 ps",
                bus_mode=True,
                bus_width=16,
                bus_name="monitor_data",
                ts_scale=10000,  # 100 MHz @ 1ps: 10 ns/sample = 10 000 ps
            )
            vcd_size = os.path.getsize(abs_vcd) if os.path.exists(abs_vcd) else 0
    finally:
        # 5. IMMEDIATELY PURGE TEMPORARY RAW .BIN (Zero uncompressed raw .bin kept on disk)
        if os.path.exists(tmp_raw_bin):
            try:
                os.remove(tmp_raw_bin)
            except OSError:
                pass

    return h5_size, vcd_size, lz4_size


@router.post("/v1/upload/init")
async def init_upload(payload: InitUploadRequest) -> dict:
    upload_id = payload.upload_id or str(uuid.uuid4())
    if upload_id in SESSIONS:
        raise HTTPException(status_code=409, detail=f"Upload ID already exists: {upload_id}")
    target = (payload.target_filename or f"{upload_id}.bin").strip()
    target = Path(target).name
    tmp_path = os.path.join(_TMP_DIR, f"{upload_id}.part")
    SESSIONS[upload_id] = _Session(upload_id, target, tmp_path)
    return {"upload_id": upload_id, "target_filename": target}


@router.get("/v1/upload/status/{upload_id}")
async def get_upload_status(upload_id: str) -> dict:
    """Query current upload progress and received part indexes for smart retry."""
    session = SESSIONS.get(upload_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Upload session not found: {upload_id}")

    async with session.lock:
        return {
            "upload_id": session.upload_id,
            "target_filename": session.target_filename,
            "bytes_received": session.bytes_received,
            "parts_received": session.parts_received,
            "received_parts": sorted(list(session.received_parts)),
            "last_activity_unix": session.last_activity,
        }


@router.put("/v1/upload/part/{upload_id}/{part_index}")
async def upload_part(upload_id: str, part_index: int, request: Request) -> dict:
    session = SESSIONS.get(upload_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Upload not found: {upload_id}")

    part_sha = request.headers.get("x-part-sha256")
    if not part_sha:
        raise HTTPException(status_code=400, detail="Missing x-part-sha256 header")

    async with session.lock:
        session.last_activity = datetime.utcnow().timestamp()
        local = hashlib.sha256()
        written = 0
        async for chunk in request.stream():
            if not chunk:
                continue
            session.file_obj.write(chunk)
            session.hasher.update(chunk)
            local.update(chunk)
            written += len(chunk)
        if local.hexdigest() != part_sha.lower():
            raise HTTPException(status_code=400, detail=f"SHA256 mismatch for part {part_index}")
        session.bytes_received += written
        session.parts_received += 1
        session.received_parts.add(part_index)
    return {"status": "ok", "part_index": part_index, "bytes_received": session.bytes_received}


async def run_waveform_verification(result_id: str, vcd_abs_path: Optional[str] = None) -> None:
    """
    Asynchronous digital waveform verification against Golden Expected VCD.
    Computes Trigger Alignment, Strobe Majority Voting XOR, and Edge F1 score.
    Saves compressed .diff.json.lz4 artifact and updates ResultORM.
    """
    async with async_session() as db:
        run = (await db.execute(select(ResultORM).where(ResultORM.id == result_id))).scalar_one_or_none()
        if not run:
            return

        if not run.test_case_id:
            run.verification_status = "SKIPPED"
            await db.commit()
            return

        test_case = (await db.execute(select(TestCaseORM).where(TestCaseORM.id == run.test_case_id))).scalar_one_or_none()
        if not test_case or not test_case.vcd_file_id:
            run.verification_status = "SKIPPED"
            await db.commit()
            return

        golden_file = (await db.execute(select(FileORM).where(FileORM.id == test_case.vcd_file_id))).scalar_one_or_none()
        if not golden_file or not golden_file.storage_path:
            run.verification_status = "SKIPPED"
            await db.commit()
            return

        golden_abs = file_store.resolve_path(golden_file.storage_path)
        if not os.path.exists(golden_abs) or not golden_file.filename.lower().endswith(".vcd"):
            run.verification_status = "SKIPPED"
            await db.commit()
            return

        # Determine actual captured VCD path
        actual_abs = vcd_abs_path
        if not actual_abs or not os.path.exists(actual_abs):
            vcd_rec = (await db.execute(
                select(FileORM).where(FileORM.result_id == result_id, FileORM.filename.like("%.vcd"))
            )).scalars().first()
            if vcd_rec and vcd_rec.storage_path:
                cand = file_store.resolve_path(vcd_rec.storage_path)
                if os.path.exists(cand):
                    actual_abs = cand

        if not actual_abs or not os.path.exists(actual_abs):
            run.verification_status = "SKIPPED"
            await db.commit()
            return

        # Run comparison in background thread
        try:
            diff_payload = await asyncio.to_thread(
                waveform_comparator_service.compare_and_build_diff,
                result_id=result_id,
                expected_vcd_path=golden_abs,
                actual_vcd_path=actual_abs,
            )
            waveform_comparator_service.save_diff_artifact(result_id, diff_payload)

            summary = diff_payload.get("summary", {})
            run.f1_score = summary.get("avg_f1_score")
            run.sample_xor_score = summary.get("avg_sample_xor_score")
            run.majority_score = summary.get("avg_majority_score")
            run.verification_status = "PASS" if summary.get("overall_pass") else "FAIL"
            await db.commit()
            print(f"[waveform_verification] Result {result_id} verified: status={run.verification_status}, F1={run.f1_score}")
        except Exception as exc:
            print(f"[waveform_verification] Verification error for {result_id}: {exc}")
            run.verification_status = "ERROR"
            await db.commit()


@router.post("/v1/upload/complete/{upload_id}")
async def complete_upload(
    upload_id: str,
    payload: CompleteUploadRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    session = SESSIONS.get(upload_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Upload not found: {upload_id}")

    async with session.lock:
        session.last_activity = datetime.utcnow().timestamp()
        session.file_obj.flush()
        session.file_obj.close()

        if payload.expected_total_size_bytes is not None and payload.expected_total_size_bytes != session.bytes_received:
            raise HTTPException(status_code=400, detail="Total size mismatch")

        result_id = _result_id_from_filename(session.target_filename)
        now = datetime.utcnow()
        rel_h5 = f"uploads/WAVEFORM/{now:%Y}/{now:%m}/{result_id}.h5"
        abs_h5 = file_store.resolve_path(rel_h5)

        rel_vcd = f"uploads/WAVEFORM/{now:%Y}/{now:%m}/{result_id}.vcd"
        abs_vcd = file_store.resolve_path(rel_vcd)

        rel_lz4 = f"uploads/WAVEFORM/{now:%Y}/{now:%m}/{result_id}_capture.bin.lz4"
        abs_lz4 = file_store.resolve_path(rel_lz4)

        try:
            h5_size, vcd_size, lz4_size = await asyncio.to_thread(
                _process_waveform_artifacts, session.tmp_path, session.target_filename, abs_h5, abs_vcd, abs_lz4
            )
        finally:
            try:
                os.remove(session.tmp_path)
            except OSError:
                pass
            SESSIONS.pop(upload_id, None)

        # Compute Checksums
        with open(abs_h5, "rb") as fh:
            h5_checksum = hashlib.sha256(fh.read()).hexdigest()

        vcd_checksum = None
        if os.path.exists(abs_vcd):
            with open(abs_vcd, "rb") as fh:
                vcd_checksum = hashlib.sha256(fh.read()).hexdigest()

        lz4_checksum = None
        if os.path.exists(abs_lz4):
            with open(abs_lz4, "rb") as fh:
                lz4_checksum = hashlib.sha256(fh.read()).hexdigest()

        async with async_session() as db:
            run = (await db.execute(select(ResultORM).where(ResultORM.id == result_id))).scalar_one_or_none()
            if run:
                run.status = "completed"
                run.passed = True
                if run.completed_at is None:
                    run.completed_at = now
            
            # 1. Register HDF5 Record
            wf_h5 = FileORM(
                id=str(uuid.uuid4()),
                filename=f"{result_id}_waveform.h5",
                file_type=FileType.WAVEFORM,
                storage_path=rel_h5,
                checksum_sha256=h5_checksum,
                size_bytes=h5_size,
                result_id=result_id if run else None,
                uploaded_at=now,
            )
            db.add(wf_h5)

            # 2. Register VCD Record (if generated)
            if vcd_size > 0 and vcd_checksum:
                wf_vcd = FileORM(
                    id=str(uuid.uuid4()),
                    filename=f"{result_id}_logic.vcd",
                    file_type=FileType.WAVEFORM,
                    storage_path=rel_vcd,
                    checksum_sha256=vcd_checksum,
                    size_bytes=vcd_size,
                    result_id=result_id if run else None,
                    uploaded_at=now,
                )
                db.add(wf_vcd)

            # 3. Register LZ4 Record (compressed capture binary, raw bin is discarded to save disk)
            if lz4_size > 0 and lz4_checksum:
                wf_lz4 = FileORM(
                    id=str(uuid.uuid4()),
                    filename=f"{result_id}_capture.bin.lz4",
                    file_type=FileType.WAVEFORM,
                    storage_path=rel_lz4,
                    checksum_sha256=lz4_checksum,
                    size_bytes=lz4_size,
                    result_id=result_id if run else None,
                    uploaded_at=now,
                )
                db.add(wf_lz4)

            await db.commit()

        if run and background_tasks is not None:
            background_tasks.add_task(
                run_waveform_verification,
                result_id=result_id,
                vcd_abs_path=abs_vcd if vcd_size > 0 else None,
            )

    return {
        "status": "completed",
        "upload_id": upload_id,
        "result_id": result_id,
        "bytes_received": session.bytes_received,
        "sha256": session.hasher.hexdigest(),
        "hdf5_file_path": rel_h5,
        "vcd_file_path": rel_vcd if vcd_size > 0 else None,
        "lz4_file_path": rel_lz4 if lz4_size > 0 else None,
        "bin_file_path": None,
    }
