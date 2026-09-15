"""
Regression test for PROJECT.md B1.2: DELETE /test-cases/{id} must refuse to delete
a test case that still has results referencing it, instead of the old zero-guard
behavior (which combined with the CASCADE on results.test_case_id to silently wipe
result history).
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid
import pytest
from sqlalchemy import select

from db.database import init_db, async_session
from db.orm_models import TestCaseORM, JobORM, JobTargetORM, ResultORM, FileORM
from services.test_case_store import test_case_store, TestCaseInUseError


@pytest.mark.asyncio
async def test_delete_test_case_with_results_raises_and_preserves_results():
    await init_db()

    tc_id = str(uuid.uuid4())
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    target_id = str(uuid.uuid4())
    res_id = str(uuid.uuid4())[:8]

    async with async_session() as session:
        # PRAGMA foreign_keys=ON (B1.9) enforces test_cases.vcd_file_id -> files.id.
        vcd_file_id = str(uuid.uuid4())
        session.add(FileORM(id=vcd_file_id, filename="guard.vcd", file_type="VCD", storage_path="uploads/VCD/guard.vcd", size_bytes=1))
        session.add(TestCaseORM(id=tc_id, name="TC guarded", vcd_file_id=vcd_file_id))
        session.add(JobORM(id=job_id, name="Job for guard test", state="completed"))
        session.add(JobTargetORM(id=target_id, job_id=job_id, target_type="any", status="completed"))
        session.add(ResultORM(
            id=res_id, job_id=job_id, job_target_id=target_id, test_case_id=tc_id,
            status="completed", execution_order=1, passed=True,
        ))
        await session.commit()

    with pytest.raises(TestCaseInUseError) as exc_info:
        await test_case_store.delete_test_case(tc_id)
    assert res_id in exc_info.value.result_ids

    # The test case AND the result must both still exist -- nothing was deleted.
    async with async_session() as session:
        tc = (await session.execute(select(TestCaseORM).where(TestCaseORM.id == tc_id))).scalar_one_or_none()
        res = (await session.execute(select(ResultORM).where(ResultORM.id == res_id))).scalar_one_or_none()
    assert tc is not None
    assert res is not None


@pytest.mark.asyncio
async def test_delete_test_case_without_results_succeeds():
    await init_db()
    tc_id = str(uuid.uuid4())
    async with async_session() as session:
        vcd_file_id = str(uuid.uuid4())
        session.add(FileORM(id=vcd_file_id, filename="unref.vcd", file_type="VCD", storage_path="uploads/VCD/unref.vcd", size_bytes=1))
        session.add(TestCaseORM(id=tc_id, name="TC unreferenced", vcd_file_id=vcd_file_id))
        await session.commit()

    ok = await test_case_store.delete_test_case(tc_id)
    assert ok is True

    async with async_session() as session:
        tc = (await session.execute(select(TestCaseORM).where(TestCaseORM.id == tc_id))).scalar_one_or_none()
    assert tc is None


if __name__ == "__main__":
    import asyncio

    async def _run():
        await test_delete_test_case_with_results_raises_and_preserves_results()
        print("test_delete_test_case_with_results_raises_and_preserves_results OK")
        await test_delete_test_case_without_results_succeeds()
        print("test_delete_test_case_without_results_succeeds OK")

    asyncio.run(_run())
