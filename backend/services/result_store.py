"""
Result Store Service with normalized results table and unified files storage for logs/waveforms.
"""
import hashlib
from typing import List, Optional, Dict, Any
from datetime import datetime
import os
import uuid
import json
import h5py
import numpy as np
from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.result import TestResult, WaveformData, WaveformChannel
from db.database import async_session
from db.orm_models import ResultORM, FileORM, FileType, JobTargetORM, TestCaseORM
from services.file_store import file_store

class ResultStore:
    """Manages test result storage (Postgres/SQLite + files on disk for logs/waveforms)."""
    
    def __init__(self, base_path: str = "storage/waveforms"):
        self.base_path = base_path.replace("\\", "/")
        os.makedirs(self.base_path, exist_ok=True)

    def _get_waveform_relative_path(self, result_id: str) -> str:
        """Generate relative path: uploads/WAVEFORM/YYYY/MM/result_id.h5"""
        now = datetime.utcnow()
        year_dir = now.strftime("%Y")
        month_dir = now.strftime("%m")
        rel_dir = f"uploads/WAVEFORM/{year_dir}/{month_dir}"
        # Ensure directory exists physically
        os.makedirs(file_store.resolve_path(rel_dir), exist_ok=True)
        return f"{rel_dir}/{result_id}.h5"

    def _get_log_relative_path(self, result_id: str) -> str:
        """Generate relative path: uploads/LOG/YYYY/MM/result_id.log"""
        now = datetime.utcnow()
        year_dir = now.strftime("%Y")
        month_dir = now.strftime("%m")
        rel_dir = f"uploads/LOG/{year_dir}/{month_dir}"
        os.makedirs(file_store.resolve_path(rel_dir), exist_ok=True)
        return f"{rel_dir}/{result_id}.log"

    def _orm_to_model(
        self,
        orm: ResultORM,
        log_content: Optional[str] = None,
        waveform_available: bool = False,
        waveform_filename: Optional[str] = None,
    ) -> TestResult:
        """Convert ORM object to Pydantic model using snapshot details."""
        snap = orm.snapshot_data or {}
        metrics = orm.metrics_json or {}
        
        job_name = snap.get("job_name", "")
        board_id = snap.get("board_id", "")
        board_name = snap.get("board_name", "")
        vcd_file_id = snap.get("vcd_file_id")
        firmware_file_id = snap.get("bin_file_id") or snap.get("firmware_file_id")
        vcd_filename = snap.get("vcd_filename", "")
        firmware_filename = snap.get("firmware_filename")

        return TestResult(
            id=orm.id,
            job_id=orm.job_id,
            job_name=job_name,
            board_id=board_id,
            board_name=board_name,
            passed=orm.passed if orm.passed is not None else False,
            started_at=orm.started_at or datetime.utcnow(),
            completed_at=orm.completed_at or datetime.utcnow(),
            duration_seconds=orm.duration_seconds or 0.0,
            vcd_file_id=vcd_file_id,
            firmware_file_id=firmware_file_id,
            vcd_filename=vcd_filename,
            firmware_filename=firmware_filename,
            error_message=orm.error_message,
            packet_count=metrics.get("packet_count", 0),
            crc_errors=metrics.get("crc_errors", 0),
            console_log=log_content,
            waveform_available=waveform_available,
            waveform_filename=waveform_filename,
        )

    def _save_waveform_to_hdf5(self, path: str, waveform: WaveformData):
        """Write waveform data to HDF5 file."""
        resolved = file_store.resolve_path(path)
        with h5py.File(resolved, "w") as f:
            f.attrs["time_unit"] = waveform.time_unit
            f.attrs["total_duration"] = waveform.total_duration
            
            grp = f.create_group("channels")
            for ch in waveform.channels:
                dset = grp.create_dataset(ch.name, data=ch.data, compression="gzip")
                dset.attrs["color"] = ch.color

    def _read_waveform_from_hdf5(self, path: str) -> Optional[WaveformData]:
        """Read waveform data from HDF5 file."""
        resolved = file_store.resolve_path(path)
        if not os.path.exists(resolved):
            return None
            
        try:
            with h5py.File(resolved, "r") as f:
                time_unit = f.attrs.get("time_unit", "us")
                total_duration = f.attrs.get("total_duration", 0.0)
                
                channels = []
                if "channels" in f:
                    grp = f["channels"]
                    for name in grp:
                        dset = grp[name]
                        color = dset.attrs.get("color", "#000000")
                        data = dset[:]
                        channels.append(WaveformChannel(
                            name=name,
                            color=color,
                            data=data.tolist()
                        ))
                
                return WaveformData(
                    channels=channels,
                    time_unit=time_unit,
                    total_duration=total_duration
                )
        except Exception as e:
            print(f"Error reading HDF5 {resolved}: {e}")
            return None

    async def get_results(
        self,
        board_id: Optional[str] = None,
        passed: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[TestResult]:
        """Get filtered completed results."""
        async with async_session() as session:
            # Query completed or errored results only (or all)
            query = select(ResultORM).order_by(ResultORM.completed_at.desc())
            if board_id:
                # filter by board_id in snapshot or actual_board_id
                query = query.join(JobTargetORM, JobTargetORM.id == ResultORM.job_target_id).where(
                    JobTargetORM.actual_board_id == board_id
                )
            if passed is not None:
                query = query.where(ResultORM.passed == passed)
            
            query = query.offset(offset).limit(limit)
            result = await session.execute(query)
            results = result.scalars().all()
            
            out = []
            for r in results:
                # check if waveform is available
                w_q = select(FileORM.filename).where(
                    and_(
                        FileORM.result_id == r.id,
                        FileORM.file_type == FileType.WAVEFORM
                    )
                )
                w_res = await session.execute(w_q)
                waveform_filename = w_res.scalar_one_or_none()
                out.append(self._orm_to_model(r, waveform_available=waveform_filename is not None, waveform_filename=waveform_filename))
            return out

    async def get_result(self, result_id: str) -> Optional[TestResult]:
        """Get a specific result (loads log content and waveform status)."""
        async with async_session() as session:
            result = await session.execute(
                select(ResultORM).where(ResultORM.id == result_id)
            )
            orm = result.scalar_one_or_none()
            if not orm:
                return None
            
            # Retrieve log file from files table
            log_q = select(FileORM).where(
                and_(
                    FileORM.result_id == result_id,
                    FileORM.file_type == FileType.LOG
                )
            )
            log_res = await session.execute(log_q)
            log_file = log_res.scalar_one_or_none()
            log_content = None
            if log_file:
                log_content_bytes = await file_store.get_file_content(log_file.id)
                if log_content_bytes:
                    log_content = log_content_bytes.decode("utf-8", errors="replace")

            # Retrieve waveform file status
            wf_q = select(FileORM.filename).where(
                and_(
                    FileORM.result_id == result_id,
                    FileORM.file_type == FileType.WAVEFORM
                )
            )
            wf_res = await session.execute(wf_q)
            waveform_filename = wf_res.scalar_one_or_none()

            return self._orm_to_model(orm, log_content=log_content, waveform_available=waveform_filename is not None, waveform_filename=waveform_filename)

    async def get_waveform(self, result_id: str) -> Optional[WaveformData]:
        """Get full waveform data for a result."""
        async with async_session() as session:
            wf_q = select(FileORM.storage_path).where(
                and_(
                    FileORM.result_id == result_id,
                    FileORM.file_type == FileType.WAVEFORM
                )
            )
            wf_res = await session.execute(wf_q)
            path = wf_res.scalar_one_or_none()
            if not path:
                return None
            return self._read_waveform_from_hdf5(path)

    async def get_waveform_path(self, result_id: str) -> Optional[str]:
        """Get the absolute path to the waveform HDF5 file."""
        async with async_session() as session:
            wf_q = select(FileORM.storage_path).where(
                and_(
                    FileORM.result_id == result_id,
                    FileORM.file_type == FileType.WAVEFORM
                )
            )
            wf_res = await session.execute(wf_q)
            path = wf_res.scalar_one_or_none()
            if not path:
                return None
            return file_store.resolve_path(path)

    async def add_result(
        self, 
        result: TestResult, 
        waveform: Optional[WaveformData] = None,
        console_log: Optional[str] = None
    ) -> str:
        """Add a new result and write log/waveform output files."""
        async with async_session() as session:
            # Get job target to determine actual board details and execution order
            # (Fallback: generate a mockup UUID for target if missing)
            job_target_id = getattr(result, "job_target_id", None)
            if not job_target_id:
                # Find matching target for this job
                q_t = select(JobTargetORM.id).where(
                    and_(
                        JobTargetORM.job_id == result.job_id,
                        JobTargetORM.actual_board_id == result.board_id
                    )
                )
                res_t = await session.execute(q_t)
                job_target_id = res_t.scalar_one_or_none()
                if not job_target_id:
                    # Create job target mock for backward compatibility
                    mock_target = JobTargetORM(
                        id=str(uuid.uuid4()),
                        job_id=result.job_id,
                        actual_board_id=result.board_id,
                        status="completed"
                    )
                    session.add(mock_target)
                    await session.flush()
                    job_target_id = mock_target.id

            # Determine test case ID
            # (Fallback: find or create TestCaseORM matching VCD)
            test_case_id = getattr(result, "test_case_id", None)
            if not test_case_id:
                # Look up test case matching VCD
                vcd_id = result.vcd_file_id
                if not vcd_id and result.vcd_filename:
                    v_q = select(FileORM.id).where(FileORM.filename == result.vcd_filename)
                    vcd_id = (await session.execute(v_q)).scalar_one_or_none()
                
                if vcd_id:
                    tc_q = select(TestCaseORM.id).where(TestCaseORM.vcd_file_id == vcd_id)
                    test_case_id = (await session.execute(tc_q)).scalar_one_or_none()

                if not test_case_id:
                    # Create a test case mockup
                    mock_tc = TestCaseORM(
                        id=str(uuid.uuid4()),
                        name=result.job_name + "_tc",
                        vcd_file_id=vcd_id or str(uuid.uuid4())
                    )
                    session.add(mock_tc)
                    await session.flush()
                    test_case_id = mock_tc.id

            # Save the result ORM
            metrics = {
                "packet_count": result.packet_count,
                "crc_errors": result.crc_errors
            }
            snapshot = {
                "job_name": result.job_name,
                "board_id": result.board_id,
                "board_name": result.board_name,
                "vcd_file_id": result.vcd_file_id,
                "firmware_file_id": result.firmware_file_id,
                "vcd_filename": result.vcd_filename,
                "firmware_filename": result.firmware_filename,
            }

            orm = ResultORM(
                id=result.id,
                job_id=result.job_id,
                job_target_id=job_target_id,
                test_case_id=test_case_id,
                status="completed" if result.passed else "error",
                execution_order=0,
                try_count=1,
                passed=result.passed,
                duration_seconds=result.duration_seconds,
                error_message=result.error_message,
                metrics_json=metrics,
                snapshot_data=snapshot,
                started_at=result.started_at,
                completed_at=result.completed_at,
                created_at=datetime.utcnow()
            )
            session.add(orm)
            await session.commit()

        # 3. Save Waveform HDF5 if provided
        if waveform:
            wf_rel_path = self._get_waveform_relative_path(result.id)
            self._save_waveform_to_hdf5(wf_rel_path, waveform)
            
            # Register in FileORM
            resolved_wf = file_store.resolve_path(wf_rel_path)
            wf_size = os.path.getsize(resolved_wf) if os.path.exists(resolved_wf) else 0
            wf_checksum = hashlib.sha256(open(resolved_wf, "rb").read()).hexdigest() if os.path.exists(resolved_wf) else ""
            
            async with async_session() as session:
                wf_file = FileORM(
                    id=str(uuid.uuid4()),
                    filename=f"{result.id}_waveform.h5",
                    file_type=FileType.WAVEFORM,
                    storage_path=wf_rel_path,
                    checksum_sha256=wf_checksum,
                    size_bytes=wf_size,
                    result_id=result.id,
                    uploaded_at=datetime.utcnow()
                )
                session.add(wf_file)
                await session.commit()

        # 4. Save Console Log if provided
        # (Fallback to result.console_log if parameter is None)
        log_txt = console_log or result.console_log
        if log_txt:
            log_rel_path = self._get_log_relative_path(result.id)
            resolved_log = file_store.resolve_path(log_rel_path)
            async with aiofiles.open(resolved_log, "w", encoding="utf-8") as lf:
                await lf.write(log_txt)
                
            log_size = os.path.getsize(resolved_log) if os.path.exists(resolved_log) else 0
            log_checksum = hashlib.sha256(open(resolved_log, "rb").read()).hexdigest() if os.path.exists(resolved_log) else ""

            async with async_session() as session:
                log_file = FileORM(
                    id=str(uuid.uuid4()),
                    filename=f"{result.id}_console.log",
                    file_type=FileType.LOG,
                    storage_path=log_rel_path,
                    checksum_sha256=log_checksum,
                    size_bytes=log_size,
                    result_id=result.id,
                    uploaded_at=datetime.utcnow()
                )
                session.add(log_file)
                await session.commit()

        return result.id

    async def delete_result(self, result_id: str) -> bool:
        """Delete a result and purge all output files associated with it."""
        async with async_session() as session:
            # 1. Load result
            result_q = select(ResultORM).where(ResultORM.id == result_id)
            orm = (await session.execute(result_q)).scalar_one_or_none()
            if not orm:
                return False

            # 2. Find and delete all output files registered for this result
            files_q = select(FileORM).where(FileORM.result_id == result_id)
            files_res = await session.execute(files_q)
            files = files_res.scalars().all()
            
            for f in files:
                resolved_path = file_store.resolve_path(f.storage_path)
                if os.path.exists(resolved_path):
                    try:
                        os.remove(resolved_path)
                    except OSError:
                        pass
                await session.delete(f)

            # Delete the result record
            await session.delete(orm)
            await session.commit()
            return True

    async def delete_results_for_job(self, job_id: str) -> int:
        """Delete all persisted results for a job and remove their output files."""
        async with async_session() as session:
            result_q = select(ResultORM).where(ResultORM.job_id == job_id)
            rows = (await session.execute(result_q)).scalars().all()
            if not rows:
                return 0
            
            count = 0
            for r in rows:
                ok = await self.delete_result(r.id)
                if ok:
                    count += 1
            return count

result_store = ResultStore()
