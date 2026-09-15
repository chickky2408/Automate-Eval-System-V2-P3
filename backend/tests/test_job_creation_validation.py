"""
Regression tests for PROJECT.md B1.1: job creation must validate pairs_data and
target boards up front and raise JobValidationError instead of fabricating a
TestCaseORM with a random-UUID vcd_file_id (dangling FK).
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid
import pytest
from sqlalchemy import select

from db.database import init_db, async_session
from db.orm_models import JobORM, TestCaseORM, FileORM
from services.job_queue import job_queue_service, JobValidationError
from models.job import JobCreate


@pytest.mark.asyncio
async def test_add_job_rejects_nonexistent_test_case_id():
    await init_db()
    job_data = JobCreate(
        name="job-bad-tc",
        vcd_filename="whatever.vcd",
        pairs_data=[{"testCaseName": "TC1", "testCaseId": f"does-not-exist-{uuid.uuid4().hex}"}],
    )

    tc_count_before = await _count(TestCaseORM)
    job_count_before = await _count(JobORM)

    with pytest.raises(JobValidationError) as exc_info:
        await job_queue_service.add_job(job_data)

    assert exc_info.value.errors[0]["type"] == "pair"
    # Nothing was written: no fabricated TestCaseORM, no JobORM row.
    assert await _count(TestCaseORM) == tc_count_before
    assert await _count(JobORM) == job_count_before


@pytest.mark.asyncio
async def test_add_job_rejects_vcd_name_missing_on_disk():
    await init_db()
    ghost_id = str(uuid.uuid4())
    filename = f"ghost-{uuid.uuid4().hex}.vcd"
    async with async_session() as session:
        # A files row whose storage_path does not exist on disk -- exactly the
        # case that used to fall back to "newest candidate ID" and dispatch
        # against a file that isn't there.
        session.add(FileORM(
            id=ghost_id,
            filename=filename,
            file_type="VCD",
            storage_path=f"uploads/VCD/1999/01/{ghost_id}_{filename}",
            checksum_sha256=None,
            size_bytes=123,
        ))
        await session.commit()

    job_data = JobCreate(
        name="job-ghost-file",
        vcd_filename="whatever.vcd",
        pairs_data=[{"testCaseName": "TC_ghost", "vcdName": filename}],
    )

    with pytest.raises(JobValidationError) as exc_info:
        await job_queue_service.add_job(job_data)

    assert "missing on disk" in exc_info.value.errors[0]["reason"]


@pytest.mark.asyncio
async def test_add_job_rejects_nonexistent_board():
    await init_db()
    job_data = JobCreate(
        name="job-bad-board",
        vcd_filename="whatever.vcd",
        target_board_ids=[f"no-such-board-{uuid.uuid4().hex}"],
    )

    with pytest.raises(JobValidationError) as exc_info:
        await job_queue_service.add_job(job_data)

    assert exc_info.value.errors[0]["type"] == "board"


async def _count(model) -> int:
    async with async_session() as session:
        rows = (await session.execute(select(model))).scalars().all()
        return len(rows)


if __name__ == "__main__":
    import asyncio

    async def _run():
        await test_add_job_rejects_nonexistent_test_case_id()
        print("test_add_job_rejects_nonexistent_test_case_id OK")
        await test_add_job_rejects_vcd_name_missing_on_disk()
        print("test_add_job_rejects_vcd_name_missing_on_disk OK")
        await test_add_job_rejects_nonexistent_board()
        print("test_add_job_rejects_nonexistent_board OK")

    asyncio.run(_run())
