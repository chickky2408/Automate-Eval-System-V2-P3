"""
Regression test for a gap found while working on B5.3 (PROJECT.md B1.9
follow-up), SQLite-demo-only: the "begin" event listener that sets PRAGMA
defer_foreign_keys=ON is not sufficient by itself. Per SQLite docs,
defer_foreign_keys reverts to OFF at the conclusion of every commit --
including an *implicit* one. pysqlite's default isolation_level="" does not
issue a real BEGIN for a plain SELECT, so a read-only query issued earlier in
the same ORM-level transaction can run in autocommit mode and silently clear
the pragma before the multi-branch INSERT batch it exists to protect ever
runs -- reproducing the exact "FOREIGN KEY constraint failed" B1.9 fixed,
even though every referenced row is valid.

A `before_flush` listener now re-asserts the pragma immediately before each
flush's INSERT/UPDATE/DELETE statements, regardless of what ran earlier in
the transaction.

This is SQLite-only (guarded by `if "sqlite" in DATABASE_URL`) and has no
bearing on production, which runs Postgres -- Postgres has no equivalent
pragma at all; see test_postgres_flush_order.py for that separate, still-
unverified question.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid

import pytest
from sqlalchemy import select

from db.database import init_db, async_session
from db.orm_models import FileORM, TestCaseORM, JobORM, JobTargetORM, ResultORM


@pytest.mark.asyncio
async def test_multi_branch_commit_survives_a_preceding_select():
    await init_db()

    job_id = f"job-{uuid.uuid4().hex[:8]}"
    target_id = str(uuid.uuid4())
    async with async_session() as session:
        session.add(JobORM(id=job_id, name="j", state="completed"))
        session.add(JobTargetORM(id=target_id, job_id=job_id, target_type="any", status="completed"))
        await session.commit()

    res_id = str(uuid.uuid4())[:8]
    file_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())
    async with async_session() as session:
        # An unrelated read BEFORE the multi-branch write, in the same
        # transaction -- this is what previously reset defer_foreign_keys.
        existing = (await session.execute(
            select(FileORM).where(FileORM.filename == "does-not-exist.vcd")
        )).scalar_one_or_none()
        assert existing is None

        session.add(FileORM(id=file_id, filename="golden.vcd", file_type="VCD",
                             storage_path="uploads/VCD/2026/09/golden.vcd", size_bytes=0))
        session.add(TestCaseORM(id=tc_id, name="tc", vcd_file_id=file_id))
        session.add(ResultORM(
            id=res_id, job_id=job_id, job_target_id=target_id, test_case_id=tc_id,
            status="completed", execution_order=1, passed=None,
        ))
        # Previously raised sqlite3.IntegrityError: FOREIGN KEY constraint
        # failed here, despite every referenced row being valid.
        await session.commit()

    async with async_session() as session:
        row = (await session.execute(select(ResultORM).where(ResultORM.id == res_id))).scalar_one()
        assert row.test_case_id == tc_id
