"""
Result Store Service with PostgreSQL and HDF5 persistence.
"""
from typing import List, Optional, Dict
from datetime import datetime
import os
import uuid
import json
import h5py
import numpy as np

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from models.result import TestResult, WaveformData, WaveformChannel
from db.database import async_session
from db.orm_models import ResultORM

class ResultStore:
    """Manages test result storage with Hybrid Strategy (Postgres + HDF5)."""
    
    def __init__(self, base_path: str = "storage/waveforms"):
        self.base_path = base_path
        os.makedirs(self.base_path, exist_ok=True)

    def _get_hdf5_path(self, result_id: str) -> str:
        """Generate path: storage/waveforms/YYYY/MM/result_id.h5"""
        now = datetime.utcnow()
        year_dir = now.strftime("%Y")
        month_dir = now.strftime("%m")
        directory = os.path.join(self.base_path, year_dir, month_dir)
        os.makedirs(directory, exist_ok=True)
        return os.path.join(directory, f"{result_id}.h5")

    def _orm_to_model(self, orm: ResultORM) -> TestResult:
        """Convert ORM object to Pydantic model."""
        return TestResult(
            id=orm.id,
            job_id=orm.job_id,
            job_name=orm.job_name,
            board_id=orm.board_id,
            board_name=orm.board_name,
            passed=orm.passed,
            started_at=orm.started_at,
            completed_at=orm.completed_at,
            duration_seconds=orm.duration_seconds,
            vcd_filename=orm.vcd_filename,
            firmware_filename=orm.firmware_filename,
            error_message=orm.error_message,
            packet_count=orm.packet_count,
            crc_errors=orm.crc_errors,
            console_log=orm.console_log,
            waveform_available=bool(orm.waveform_hdf5_path),
        )

    def _save_waveform_to_hdf5(self, path: str, waveform: WaveformData):
        """Write waveform data to HDF5 file (Synchronous disk I/O)."""
        # H5py is synchronous. In heavy production, run this in ThreadPoolExecutor.
        with h5py.File(path, "w") as f:
            # Attributes
            f.attrs["time_unit"] = waveform.time_unit
            f.attrs["total_duration"] = waveform.total_duration
            
            # Create group for channels
            grp = f.create_group("channels")
            for ch in waveform.channels:
                # Store data as dataset
                dset = grp.create_dataset(ch.name, data=ch.data, compression="gzip")
                dset.attrs["color"] = ch.color

    def _read_waveform_from_hdf5(self, path: str) -> Optional[WaveformData]:
        """Read waveform data from HDF5 file."""
        if not os.path.exists(path):
            return None
            
        try:
            with h5py.File(path, "r") as f:
                time_unit = f.attrs.get("time_unit", "us")
                total_duration = f.attrs.get("total_duration", 0.0)
                
                channels = []
                if "channels" in f:
                    grp = f["channels"]
                    for name in grp:
                        dset = grp[name]
                        color = dset.attrs.get("color", "#000000")
                        data = dset[:] # Read all data into numpy array -> list
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
            print(f"Error reading HDF5 {path}: {e}")
            return None

    async def get_results(
        self,
        board_id: Optional[str] = None,
        passed: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[TestResult]:
        """Get filtered results."""
        async with async_session() as session:
            query = select(ResultORM).order_by(ResultORM.completed_at.desc())
            
            if board_id:
                query = query.where(ResultORM.board_id == board_id)
            if passed is not None:
                query = query.where(ResultORM.passed == passed)
            
            query = query.offset(offset).limit(limit)
            result = await session.execute(query)
            results = result.scalars().all()
            return [self._orm_to_model(r) for r in results]

    async def get_result(self, result_id: str) -> Optional[TestResult]:
        """Get a specific result."""
        async with async_session() as session:
            result = await session.execute(
                select(ResultORM).where(ResultORM.id == result_id)
            )
            orm = result.scalar_one_or_none()
            return self._orm_to_model(orm) if orm else None

    async def get_waveform(self, result_id: str) -> Optional[WaveformData]:
        """Get full waveform data for a result."""
        async with async_session() as session:
            result = await session.execute(
                select(ResultORM.waveform_hdf5_path).where(ResultORM.id == result_id)
            )
            path = result.scalar_one_or_none()
            
            if not path:
                return None
                
            return self._read_waveform_from_hdf5(path)

    async def get_waveform_path(self, result_id: str) -> Optional[str]:
        """Get the filesystem path to the HDF5 waveform file."""
        async with async_session() as session:
            result = await session.execute(
                select(ResultORM.waveform_hdf5_path).where(ResultORM.id == result_id)
            )
            return result.scalar_one_or_none()

    async def add_result(
        self, 
        result: TestResult, 
        waveform: Optional[WaveformData] = None
    ) -> str:
        """Add a new result."""
        hdf5_path = None
        if waveform:
            hdf5_path = self._get_hdf5_path(result.id)
            # Write HDF5 (Blocking I/O, acceptable for now)
            self._save_waveform_to_hdf5(hdf5_path, waveform)

        async with async_session() as session:
            orm = ResultORM(
                id=result.id,
                job_id=result.job_id,
                job_name=result.job_name,
                board_id=result.board_id,
                board_name=result.board_name,
                passed=result.passed,
                started_at=result.started_at,
                completed_at=result.completed_at,
                duration_seconds=result.duration_seconds,
                vcd_filename=result.vcd_filename,
                firmware_filename=result.firmware_filename,
                error_message=result.error_message,
                packet_count=result.packet_count,
                crc_errors=result.crc_errors,
                console_log=result.console_log,
                waveform_hdf5_path=hdf5_path,
                metrics=None # Future use
            )
            session.add(orm)
            await session.commit()
            return result.id

    async def delete_result(self, result_id: str) -> bool:
        """Delete a result and its HDF5 file."""
        async with async_session() as session:
            result = await session.execute(
                select(ResultORM).where(ResultORM.id == result_id)
            )
            orm = result.scalar_one_or_none()
            if not orm:
                return False
            
            hdf5_path = orm.waveform_hdf5_path
            
            await session.delete(orm)
            await session.commit()
            
            # Delete HDF5 file
            if hdf5_path and os.path.exists(hdf5_path):
                try:
                    os.remove(hdf5_path)
                except OSError:
                    pass
            
            return True

    async def delete_results_for_job(self, job_id: str) -> int:
        """Delete all persisted results for a job and remove waveform HDF5 files."""
        async with async_session() as session:
            result = await session.execute(
                select(ResultORM).where(ResultORM.job_id == job_id)
            )
            rows = list(result.scalars().all())
            if not rows:
                return 0
            paths = [r.waveform_hdf5_path for r in rows]
            await session.execute(delete(ResultORM).where(ResultORM.job_id == job_id))
            await session.commit()

        for path in paths:
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
        return len(rows)

result_store = ResultStore()
