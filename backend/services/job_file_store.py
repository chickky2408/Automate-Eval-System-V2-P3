"""
Job File Store Service (Redesigned to map to ResultORM).
"""
from __future__ import annotations
from typing import List, Optional
from datetime import datetime
import uuid

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import ResultORM, TestCaseORM

class JobFileStore:
    """Manages job items/files by mapping them to ResultORM records under the hood."""

    def _orm_to_dict(self, f: ResultORM) -> dict:
        passed_val = f.passed
        result_str = None
        if passed_val is True:
            result_str = "pass"
        elif passed_val is False:
            result_str = "fail"
            
        snap = f.snapshot_data or {}
        return {
            "id": f.id,
            "job_id": f.job_id,
            "name": snap.get("test_case_name") or f"TC_{f.id}",
            "status": f.status or "pending",
            "result": result_str,
            "order": f.execution_order,
            "vcd": snap.get("vcd_filename"),
            "erom": snap.get("firmware_filename"),
            "ulp": snap.get("ulp_filename"),
            "try_count": f.try_count or 1,
            "test_case_name": snap.get("test_case_name"),
            "created_at": f.created_at.isoformat() + "Z" if f.created_at else datetime.utcnow().isoformat() + "Z",
            "updated_at": f.completed_at.isoformat() + "Z" if f.completed_at else datetime.utcnow().isoformat() + "Z",
        }

    async def create_job_file(
        self,
        job_id: str,
        name: str,
        order: int,
        vcd: Optional[str] = None,
        erom: Optional[str] = None,
        ulp: Optional[str] = None,
        try_count: Optional[int] = None,
        test_case_name: Optional[str] = None,
    ) -> dict:
        """Create a new run item mapped to ResultORM."""
        file_id = str(uuid.uuid4())[:8] # Keep ID short
        
        async with async_session() as session:
            # Check or create a TestCaseORM matching this VCD
            tc_id = None
            if vcd:
                from db.orm_models import FileORM
                f_res = await session.execute(select(FileORM.id).where(FileORM.filename == vcd))
                vcd_id = f_res.scalar_one_or_none()
                if vcd_id:
                    tc_q = select(TestCaseORM.id).where(TestCaseORM.vcd_file_id == vcd_id)
                    tc_id = (await session.execute(tc_q)).scalar_one_or_none()

            if not tc_id:
                tc_id = str(uuid.uuid4())
                mock_tc = TestCaseORM(
                    id=tc_id,
                    name=test_case_name or name,
                    vcd_file_id=str(uuid.uuid4()) # fallback dummy VCD ID
                )
                session.add(mock_tc)
                await session.flush()

            # Find or create a JobTargetORM for this job (fallback dummy target if none exists)
            from db.orm_models import JobTargetORM
            t_res = await session.execute(select(JobTargetORM.id).where(JobTargetORM.job_id == job_id))
            target_id = t_res.scalar_one_or_none()
            if not target_id:
                target_id = str(uuid.uuid4())
                mock_target = JobTargetORM(
                    id=target_id,
                    job_id=job_id,
                    target_type="any",
                    status="pending"
                )
                session.add(mock_target)
                await session.flush()

            orm = ResultORM(
                id=file_id,
                job_id=job_id,
                job_target_id=target_id,
                test_case_id=tc_id,
                status="pending",
                execution_order=order,
                try_count=try_count or 1,
                passed=None,
                snapshot_data={
                    "test_case_name": test_case_name or name,
                    "vcd_filename": vcd,
                    "firmware_filename": erom,
                    "ulp_filename": ulp
                },
                created_at=datetime.utcnow()
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            return self._orm_to_dict(orm)

    async def list_job_files(self, job_id: str) -> List[dict]:
        """List all run items for a job."""
        async with async_session() as session:
            result = await session.execute(
                select(ResultORM)
                .where(ResultORM.job_id == job_id)
                .order_by(ResultORM.execution_order)
            )
            files = result.scalars().all()
            return [self._orm_to_dict(f) for f in files]

    async def get_job_file(self, file_id: str) -> Optional[dict]:
        """Get a specific run item by ID."""
        async with async_session() as session:
            result = await session.execute(
                select(ResultORM).where(ResultORM.id == file_id)
            )
            orm = result.scalar_one_or_none()
            if not orm:
                return None
            return self._orm_to_dict(orm)

    async def update_job_file(
        self,
        file_id: str,
        status: Optional[str] = None,
        result: Optional[str] = None,
        order: Optional[int] = None,
    ) -> bool:
        """Update a run item status/passed value."""
        async with async_session() as session:
            values = {}
            if status is not None:
                values["status"] = status
            if result is not None:
                if result == "pass":
                    values["passed"] = True
                elif result == "fail":
                    values["passed"] = False
                else:
                    values["passed"] = None
            if order is not None:
                values["execution_order"] = order
            
            if not values:
                return True

            res = await session.execute(
                update(ResultORM).where(ResultORM.id == file_id).values(**values)
            )
            await session.commit()
            return res.rowcount > 0

    async def delete_job_file(self, file_id: str) -> bool:
        """Delete a run item."""
        async with async_session() as session:
            res = await session.execute(
                delete(ResultORM).where(ResultORM.id == file_id)
            )
            await session.commit()
            return res.rowcount > 0

    async def delete_job_files(self, job_id: str) -> int:
        """Delete all run items for a job."""
        async with async_session() as session:
            res = await session.execute(
                delete(ResultORM).where(ResultORM.job_id == job_id)
            )
            await session.commit()
            return res.rowcount

    async def sync_files_for_status(self, job_id: str, status: str) -> List[dict]:
        """Sync run items statuses based on job status."""
        files = await self.list_job_files(job_id)
        
        if status == "completed":
            for f in files:
                await self.update_job_file(f["id"], status="completed", result="pass" if f["result"] is None else f["result"])
        elif status == "stopped":
            for f in files:
                if f["status"] in {"running", "pending"}:
                    await self.update_job_file(f["id"], status="stopped")
        elif status == "running":
            if not any(f["status"] == "running" for f in files):
                for f in files:
                    if f["status"] == "pending":
                        await self.update_job_file(f["id"], status="running")
                        break
        
        return await self.list_job_files(job_id)

job_file_store = JobFileStore()
