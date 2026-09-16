"""
Regression test: services/job_file_store.py's create_job_file() had the same
dangling-FK fabrication bug PROJECT.md B1.1 fixed in job_queue.py -- an
unresolved `vcd` name fell back to `vcd_id or str(uuid.uuid4())`, writing a
TestCaseORM.vcd_file_id that points at nothing. Found while auditing every
production call site that builds TestCaseORM/ResultORM/JobTargetORM together
for the same flush-ordering issue test_postgres_flush_order.py checks.

This endpoint (POST /api/jobs/{id}/files) is not called by the frontend
(confirmed: `getJobFiles` is exported from api.js but never imported anywhere,
and there is no POST wrapper for create_job_file at all) but it is mounted
and reachable directly, so the bug was real, not merely theoretical.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid
import pytest
from sqlalchemy import select

from db.database import init_db, async_session
from db.orm_models import JobORM, TestCaseORM
from services.job_file_store import job_file_store


@pytest.mark.asyncio
async def test_create_job_file_rejects_unresolvable_vcd_name():
    await init_db()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    async with async_session() as session:
        session.add(JobORM(id=job_id, name="job-file-store-test", state="draft"))
        await session.commit()

    bogus_name = f"does-not-exist-{uuid.uuid4().hex}.vcd"

    with pytest.raises(ValueError, match="does not exist"):
        await job_file_store.create_job_file(
            job_id=job_id, name="TC1", order=1, vcd=bogus_name,
        )

    # No TestCaseORM with a fabricated random-UUID vcd_file_id was written.
    async with async_session() as session:
        rows = (await session.execute(
            select(TestCaseORM).where(TestCaseORM.name == "TC1")
        )).scalars().all()
        assert rows == []


@pytest.mark.asyncio
async def test_create_job_file_rejects_when_nothing_to_reference():
    await init_db()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    async with async_session() as session:
        session.add(JobORM(id=job_id, name="job-file-store-test-2", state="draft"))
        await session.commit()

    with pytest.raises(ValueError, match="neither a resolvable"):
        await job_file_store.create_job_file(job_id=job_id, name="TC_bare", order=1)
