import os
os.environ["USE_SQLITE_DEMO"] = "1"
import uuid
import pytest
from datetime import datetime, timedelta

from db.database import init_db, async_session
from db.orm_models import JobORM, JobTargetORM, TestCaseORM, ResultORM, FileORM, FileType, BoardORM
from services.job_queue import job_queue_service
from services.file_store import file_store


@pytest.mark.asyncio
async def test_job_creation_skips_soft_deleted_file_with_same_name():
    """PROJECT.md B1.8 added FileORM.status/deleted_at for soft delete. Before this
    fix, _resolve_pair_reference's by-filename lookup did not filter status, so a
    freshly re-uploaded file could resolve back to an older row the user had just
    (soft-)deleted, if that archived row happened to still exist on disk and sort
    first by uploaded_at."""
    await init_db()

    job_id = f"job-softdel-{uuid.uuid4().hex[:6]}"
    target_id = str(uuid.uuid4())
    filename = "vector_softdel_test.ist"

    # Archived (soft-deleted) file, but its bytes are still on disk (grace period,
    # PROJECT.md B1.7 proposal / current soft-delete behavior) and it is the NEWER row.
    archived_rel = f"uploads/IST/2026/09/archived_{uuid.uuid4().hex[:6]}.ist"
    archived_abs = file_store.resolve_path(archived_rel)
    os.makedirs(os.path.dirname(archived_abs), exist_ok=True)
    with open(archived_abs, "wb") as f:
        f.write(b"OLD DELETED STIMULUS\n")

    # Live re-upload with the same filename, older uploaded_at, but the one that
    # should win because the other is archived.
    live_rel = f"uploads/IST/2026/09/live_{uuid.uuid4().hex[:6]}.ist"
    live_abs = file_store.resolve_path(live_rel)
    with open(live_abs, "wb") as f:
        f.write(b"LIVE STIMULUS\n")

    now = datetime.utcnow()
    archived_file_id = f"file-archived-{uuid.uuid4().hex[:6]}"
    live_file_id = f"file-live-{uuid.uuid4().hex[:6]}"

    async with async_session() as session:
        session.add(FileORM(
            id=archived_file_id,
            filename=filename,
            file_type=FileType.VCD,
            storage_path=archived_rel,
            size_bytes=100,
            checksum_sha256="sha-archived",
            uploaded_at=now,  # newer
            status="archived",
            deleted_at=now,
        ))
        session.add(FileORM(
            id=live_file_id,
            filename=filename,
            file_type=FileType.VCD,
            storage_path=live_rel,
            size_bytes=100,
            checksum_sha256="sha-live",
            uploaded_at=now - timedelta(minutes=5),  # older, but the live one
            status="active",
        ))

        job = JobORM(id=job_id, name="Soft-Delete Resolution Test Job", state="pending")
        session.add(job)
        board_id = f"kr260-test-{uuid.uuid4().hex[:6]}"
        session.add(BoardORM(id=board_id, name="KR260 Test Board"))
        target = JobTargetORM(id=target_id, job_id=job_id, requested_board_id=board_id, status="pending")
        session.add(target)
        await session.commit()

    pairs_data = [
        {
            "testCaseName": "Soft Delete Resolution TC",
            "vcdName": filename,
            "binName": "fw.bin",
        }
    ]

    async with async_session() as session:
        await job_queue_service._precreate_results_from_pairs(session, job_id, pairs_data)
        await session.commit()

    async with async_session() as session:
        from sqlalchemy import select
        res = (await session.execute(select(ResultORM).where(ResultORM.job_id == job_id))).scalar_one()
        assert res.snapshot_data.get("vcd_file_id") == live_file_id

        tc = (await session.execute(select(TestCaseORM).where(TestCaseORM.id == res.test_case_id))).scalar_one()
        assert tc.vcd_file_id == live_file_id

    for p in (archived_abs, live_abs):
        if os.path.exists(p):
            os.remove(p)
