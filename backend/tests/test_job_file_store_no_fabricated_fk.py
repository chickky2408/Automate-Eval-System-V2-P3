"""
Regression test: services/job_file_store.py's create_job_file() had the same
dangling-FK fabrication bug PROJECT.md B1.1 fixed in job_queue.py -- an
unresolved `vcd` name fell back to `vcd_id or str(uuid.uuid4())`, writing a
TestCaseORM.vcd_file_id that points at nothing. Found while auditing every
production call site that builds TestCaseORM/ResultORM/JobTargetORM together
for the same flush-ordering issue test_postgres_flush_order.py checks.

Follow-up (advisor review): the first fix only closed the "no file row at
all" case. A files row that exists but is missing on disk fell through the
same `if not vcd_id and candidates: vcd_id = candidates[0].id` fallback
job_queue._resolve_pair_reference already rejects (B1.1) -- fixed here too,
along with the B1.8 soft-delete filter _resolve_pair_reference also has,
which this sibling function never got.

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
from db.orm_models import JobORM, TestCaseORM, FileORM
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


@pytest.mark.asyncio
async def test_create_job_file_rejects_vcd_row_missing_on_disk():
    """A files row exists for this filename, but its bytes are gone -- must
    not fall back to 'newest candidate ID' (the same case B1.1 closed in
    job_queue._resolve_pair_reference)."""
    await init_db()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    ghost_id = str(uuid.uuid4())
    filename = f"ghost-{uuid.uuid4().hex}.vcd"
    async with async_session() as session:
        session.add(JobORM(id=job_id, name="job-file-store-test-3", state="draft"))
        session.add(FileORM(
            id=ghost_id, filename=filename, file_type="VCD",
            storage_path=f"uploads/VCD/1999/01/{ghost_id}_{filename}",
            checksum_sha256=None, size_bytes=123,
        ))
        await session.commit()

    with pytest.raises(ValueError, match="missing on disk"):
        await job_file_store.create_job_file(job_id=job_id, name="TC_ghost", order=1, vcd=filename)


@pytest.mark.asyncio
async def test_create_job_file_ignores_soft_deleted_file_with_same_name():
    """B1.8 soft-delete: an archived row must not resolve ahead of (or in
    place of) a live file sharing the same name, matching
    job_queue._resolve_pair_reference's existing filter."""
    await init_db()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    filename = f"reused-{uuid.uuid4().hex}.vcd"
    from services.file_store import file_store

    archived_id = str(uuid.uuid4())
    archived_rel = f"VCD/1999/01/{archived_id}_{filename}"
    async with async_session() as session:
        session.add(JobORM(id=job_id, name="job-file-store-test-4", state="draft"))
        session.add(FileORM(
            id=archived_id, filename=filename, file_type="VCD",
            storage_path=archived_rel, checksum_sha256=None, size_bytes=1,
            status="archived",
        ))
        await session.commit()

    abs_path = file_store.resolve_path(archived_rel)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(b"$end\n")

    # Only an archived row exists -- must be treated as if no live file exists.
    with pytest.raises(ValueError, match="does not exist"):
        await job_file_store.create_job_file(job_id=job_id, name="TC_reused", order=1, vcd=filename)
