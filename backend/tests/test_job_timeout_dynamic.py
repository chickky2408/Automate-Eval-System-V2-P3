"""
Regression test for PROJECT.md B1.5: the main job-creation path used to hardcode
timeout_seconds=60 (routers/jobs.py), and even after removing that hardcode,
JobORM.timeout_seconds had a Column(default=60) that fired even when None was
explicitly assigned -- so every UI-created job was capped at 60s of hardware
execution regardless of capture size (job_queue.py's size-based dynamic timeout
only engages when timeout_seconds is falsy).
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import pytest
from sqlalchemy import select

from db.database import init_db, async_session
from db.orm_models import JobORM
from models.job import JobCreate
from services.job_queue import job_queue_service


@pytest.mark.asyncio
async def test_job_created_without_explicit_timeout_persists_as_null():
    await init_db()
    job_data = JobCreate(name="dynamic-timeout-check", vcd_filename="x.vcd")
    assert job_data.timeout_seconds is None  # model default

    job = await job_queue_service.add_job(job_data)

    async with async_session() as session:
        orm = (await session.execute(select(JobORM).where(JobORM.id == job.id))).scalar_one()
    # Must be NULL, not silently 60 -- this is what lets job_queue.py's
    # `if not timeout_seconds or timeout_seconds <= 0:` dynamic-timeout branch engage.
    assert orm.timeout_seconds is None


@pytest.mark.asyncio
async def test_job_created_with_explicit_timeout_is_respected():
    await init_db()
    job_data = JobCreate(name="fixed-timeout-check", vcd_filename="x.vcd", timeout_seconds=300)
    job = await job_queue_service.add_job(job_data)
    async with async_session() as session:
        orm = (await session.execute(select(JobORM).where(JobORM.id == job.id))).scalar_one()
    assert orm.timeout_seconds == 300


if __name__ == "__main__":
    import asyncio

    async def _run():
        await test_job_created_without_explicit_timeout_persists_as_null()
        print("test_job_created_without_explicit_timeout_persists_as_null OK")
        await test_job_created_with_explicit_timeout_is_respected()
        print("test_job_created_with_explicit_timeout_is_respected OK")

    asyncio.run(_run())
