"""
Regression test for a security-audit finding (2026-09-16): routers/profiles.py's
_sync_normalized_test_tables() did an unconditional `DELETE FROM test_cases`
(no WHERE) on every single profile save, then re-inserted the desired set.

Once PROJECT.md B1.2 changed results.test_case_id from ondelete="CASCADE" to
"RESTRICT" (to stop deleting a test case from silently destroying result
history), that same DELETE started failing the moment ANY result existed:
on Postgres, a non-deferrable RESTRICT is checked per-statement, not at
commit, so `DELETE FROM test_cases` throws immediately if any row is still
referenced -- even though the code was about to re-insert an identical row
right after. SQLite's demo-only `defer_foreign_keys` pragma masked this,
which is exactly why it wasn't caught earlier.

Fix: only delete test_cases that are neither still desired by any profile
nor referenced by a result; upsert (update-in-place or insert) everything
still desired instead of blind delete+recreate.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid
import pytest
from sqlalchemy import select

from db.database import init_db, async_session
from db.orm_models import FileORM, ProfileORM, TestCaseORM, JobORM, JobTargetORM, ResultORM
from routers.profiles import _sync_normalized_test_tables


async def _seed_file(session) -> str:
    file_id = str(uuid.uuid4())
    session.add(FileORM(
        id=file_id, filename="stim.vcd", file_type="VCD",
        storage_path="uploads/VCD/stim.vcd", checksum_sha256=None, size_bytes=1,
    ))
    return file_id


@pytest.mark.asyncio
async def test_referenced_test_case_survives_removal_from_saved_data():
    await init_db()
    profile_id = f"profile-{uuid.uuid4().hex[:8]}"

    async with async_session() as session:
        file_id = await _seed_file(session)
        session.add(ProfileORM(id=profile_id, name="audit-test-profile", data={
            "savedTestCases": [{"id": "tc-keep", "name": "TC Keep", "vcdName": "stim.vcd"}],
        }))
        await session.commit()

        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()

        tc_row = (await session.execute(
            select(TestCaseORM).where(TestCaseORM.name == "TC Keep")
        )).scalars().first()
        assert tc_row is not None
        tc_id = tc_row.id

        # A completed job result now references this test case -- the case
        # a plain DELETE FROM test_cases would have collided with on Postgres.
        job_id = f"job-audit-{uuid.uuid4().hex[:8]}"
        session.add(JobORM(id=job_id, name="audit job", state="completed"))
        session.add(JobTargetORM(id=str(uuid.uuid4()), job_id=job_id,
                                  target_type="any", status="completed"))
        target_id = (await session.execute(
            select(JobTargetORM.id).where(JobTargetORM.job_id == job_id)
        )).scalar_one()
        session.add(ResultORM(
            id=str(uuid.uuid4())[:8], job_id=job_id, job_target_id=target_id,
            test_case_id=tc_id, status="completed",
        ))
        await session.commit()

    # User removes the test case from their saved list and saves again --
    # this used to try `DELETE FROM test_cases` unconditionally.
    async with async_session() as session:
        prof = (await session.execute(
            select(ProfileORM).where(ProfileORM.id == profile_id)
        )).scalar_one()
        prof.data = {"savedTestCases": []}
        await session.flush()

        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))  # must not raise
        await session.commit()

    async with async_session() as session:
        still_there = (await session.execute(
            select(TestCaseORM).where(TestCaseORM.id == tc_id)
        )).scalar_one_or_none()
        assert still_there is not None, "test case referenced by a result must survive the sync"


@pytest.mark.asyncio
async def test_still_desired_test_case_is_updated_in_place_not_duplicated():
    await init_db()
    profile_id = f"profile-{uuid.uuid4().hex[:8]}"

    async with async_session() as session:
        await _seed_file(session)
        session.add(ProfileORM(id=profile_id, name="audit-test-profile-2", data={
            "savedTestCases": [{"id": "tc-rename", "name": "Original Name", "vcdName": "stim.vcd"}],
        }))
        await session.commit()

        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()

        tc_id = (await session.execute(
            select(TestCaseORM.id).where(TestCaseORM.name == "Original Name")
        )).scalar_one()

    # Rename it and save again -- same stable id (same profile + tc id seed).
    async with async_session() as session:
        prof = (await session.execute(
            select(ProfileORM).where(ProfileORM.id == profile_id)
        )).scalar_one()
        prof.data = {"savedTestCases": [{"id": "tc-rename", "name": "Renamed", "vcdName": "stim.vcd"}]}
        await session.flush()

        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()

    async with async_session() as session:
        rows = (await session.execute(
            select(TestCaseORM).where(TestCaseORM.id == tc_id)
        )).scalars().all()
        assert len(rows) == 1, "renaming must update the existing row, not create a duplicate"
        assert rows[0].name == "Renamed"


@pytest.mark.asyncio
async def test_unreferenced_removed_test_case_is_still_cleaned_up():
    """The fix must not turn this into a permanent no-op GC -- a test case
    that's simply no longer wanted, and nothing references it, still goes."""
    await init_db()
    profile_id = f"profile-{uuid.uuid4().hex[:8]}"

    async with async_session() as session:
        await _seed_file(session)
        session.add(ProfileORM(id=profile_id, name="audit-test-profile-3", data={
            "savedTestCases": [{"id": "tc-throwaway", "name": "Throwaway", "vcdName": "stim.vcd"}],
        }))
        await session.commit()

        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()

        tc_id = (await session.execute(
            select(TestCaseORM.id).where(TestCaseORM.name == "Throwaway")
        )).scalar_one()

    async with async_session() as session:
        prof = (await session.execute(
            select(ProfileORM).where(ProfileORM.id == profile_id)
        )).scalar_one()
        prof.data = {"savedTestCases": []}
        await session.flush()

        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()

    async with async_session() as session:
        gone = (await session.execute(
            select(TestCaseORM).where(TestCaseORM.id == tc_id)
        )).scalar_one_or_none()
        assert gone is None, "an unreferenced, no-longer-desired test case must still be deleted"
