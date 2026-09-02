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
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from db.database import async_session
from db.orm_models import FileORM, FileType, ResultORM
from services.file_store import file_store
from services.waveform_file import convert_bin_to_vcd

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


def _convert_to_hdf5(bin_path: str, h5_path: str) -> int:
    import h5py
    import numpy as np

    total = os.path.getsize(bin_path)
    sample_count = total // 2
    os.makedirs(os.path.dirname(h5_path), exist_ok=True)
    with h5py.File(h5_path, "w") as h5f:
        data = np.memmap(bin_path, dtype="<i2", mode="r", shape=(sample_count,)) if sample_count else np.array([], dtype="<i2")
        ds = h5f.create_dataset("raw", data=np.asarray(data, dtype="<i2"))
        ds.attrs["source_bin"] = Path(bin_path).name
        ds.attrs["sample_count"] = sample_count
        ds.attrs["created_at_unix"] = datetime.utcnow().timestamp()
    return os.path.getsize(h5_path)


def _process_waveform_artifacts(tmp_path: str, target_filename: str, abs_h5: str, abs_vcd: str) -> tuple[int, int]:
    """
    Decompresses LZ4 if needed, converts to HDF5 and VCD waveform formats.
    Returns (h5_size, vcd_size).
    """
    is_lz4 = _is_lz4_file(tmp_path) or target_filename.endswith(".lz4")
    raw_bin_path = f"{tmp_path}.decompressed.bin" if is_lz4 else tmp_path

    try:
        if is_lz4:
            _decompress_lz4_to_bin(tmp_path, raw_bin_path)

        # 1. Generate HDF5 Dataset
        h5_size = _convert_to_hdf5(raw_bin_path, abs_h5)

        # 2. Generate Logic Trace VCD
        raw_size = os.path.getsize(raw_bin_path) if os.path.exists(raw_bin_path) else 0
        vcd_size = 0
        if raw_size > 0:
            stride = 16 if (raw_size % 16 == 0 and raw_size >= 16) else 1
            offset = 0x0C if stride == 16 else 0
            convert_bin_to_vcd(
                bin_filepath=raw_bin_path,
                vcd_filepath=abs_vcd,
                channel_names=["CH0", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7"],
                stride_bytes=stride,
                byte_offset=offset,
                timescale="10 ns"
            )
            vcd_size = os.path.getsize(abs_vcd) if os.path.exists(abs_vcd) else 0

        return h5_size, vcd_size
    finally:
        if is_lz4 and os.path.exists(raw_bin_path):
            try:
                os.remove(raw_bin_path)
            except OSError:
                pass


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


@router.post("/v1/upload/complete/{upload_id}")
async def complete_upload(upload_id: str, payload: CompleteUploadRequest) -> dict:
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

        try:
            h5_size, vcd_size = await asyncio.to_thread(
                _process_waveform_artifacts, session.tmp_path, session.target_filename, abs_h5, abs_vcd
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

        async with async_session() as db:
            run = (await db.execute(select(ResultORM).where(ResultORM.id == result_id))).scalar_one_or_none()
            
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

            await db.commit()

    return {
        "status": "completed",
        "upload_id": upload_id,
        "result_id": result_id,
        "bytes_received": session.bytes_received,
        "sha256": session.hasher.hexdigest(),
        "hdf5_file_path": rel_h5,
        "vcd_file_path": rel_vcd if vcd_size > 0 else None,
    }
