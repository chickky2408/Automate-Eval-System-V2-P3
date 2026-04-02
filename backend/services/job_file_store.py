"""
Job File Store Service with Database persistence.
"""
from __future__ import annotations

from typing import List, Optional
from datetime import datetime
import uuid

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import JobFileORM


class JobFileStore:
    """Manages job files with database persistence."""

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
        """Create a new job file."""
        file_id = str(uuid.uuid4())[:32]
        
        async with async_session() as session:
            orm = JobFileORM(
                id=file_id,
                job_id=job_id,
                name=name,
                status="pending",
                result=None,
                order=order,
                vcd=vcd,
                erom=erom,
                ulp=ulp,
                try_count=try_count,
                test_case_name=test_case_name,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            
            return {
                "id": orm.id,
                "job_id": orm.job_id,
                "name": orm.name,
                "status": orm.status,
                "result": orm.result,
                "order": orm.order,
                "vcd": orm.vcd,
                "erom": orm.erom,
                "ulp": orm.ulp,
                "try_count": orm.try_count,
                "test_case_name": orm.test_case_name,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def list_job_files(self, job_id: str) -> List[dict]:
        """List all files for a job."""
        async with async_session() as session:
            result = await session.execute(
                select(JobFileORM)
                .where(JobFileORM.job_id == job_id)
                .order_by(JobFileORM.order)
            )
            files = result.scalars().all()
            
            return [
                {
                    "id": f.id,
                    "job_id": f.job_id,
                    "name": f.name,
                    "status": f.status,
                    "result": f.result,
                    "order": f.order,
                    "vcd": f.vcd,
                    "erom": f.erom,
                    "ulp": f.ulp,
                    "try_count": f.try_count,
                    "test_case_name": f.test_case_name,
                    "created_at": f.created_at.isoformat() + "Z",
                    "updated_at": f.updated_at.isoformat() + "Z",
                }
                for f in files
            ]

    async def get_job_file(self, file_id: str) -> Optional[dict]:
        """Get a specific job file."""
        async with async_session() as session:
            result = await session.execute(
                select(JobFileORM).where(JobFileORM.id == file_id)
            )
            orm = result.scalar_one_or_none()
            
            if not orm:
                return None
            
            return {
                "id": orm.id,
                "job_id": orm.job_id,
                "name": orm.name,
                "status": orm.status,
                "result": orm.result,
                "order": orm.order,
                "vcd": orm.vcd,
                "erom": orm.erom,
                "ulp": orm.ulp,
                "try_count": orm.try_count,
                "test_case_name": orm.test_case_name,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def update_job_file(
        self,
        file_id: str,
        status: Optional[str] = None,
        result: Optional[str] = None,
        order: Optional[int] = None,
    ) -> bool:
        """Update a job file."""
        async with async_session() as session:
            values = {"updated_at": datetime.utcnow()}
            if status is not None:
                values["status"] = status
            if result is not None:
                values["result"] = result
            if order is not None:
                values["order"] = order
            
            result = await session.execute(
                update(JobFileORM).where(JobFileORM.id == file_id).values(**values)
            )
            await session.commit()
            
            return result.rowcount > 0

    async def delete_job_file(self, file_id: str) -> bool:
        """Delete a job file."""
        async with async_session() as session:
            result = await session.execute(
                delete(JobFileORM).where(JobFileORM.id == file_id)
            )
            await session.commit()
            
            return result.rowcount > 0

    async def delete_job_files(self, job_id: str) -> int:
        """Delete all files for a job."""
        async with async_session() as session:
            result = await session.execute(
                delete(JobFileORM).where(JobFileORM.job_id == job_id)
            )
            await session.commit()
            
            return result.rowcount

    async def sync_files_for_status(self, job_id: str, status: str) -> List[dict]:
        """Sync files status based on job status."""
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
