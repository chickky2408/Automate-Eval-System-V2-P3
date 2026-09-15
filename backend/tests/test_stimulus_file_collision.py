import os
os.environ["USE_SQLITE_DEMO"] = "1"
import uuid
import pytest
from datetime import datetime, timedelta

from db.database import init_db, async_session
from db.orm_models import JobORM, JobTargetORM, TestCaseORM, ResultORM, FileORM, FileType
from services.job_queue import job_queue_service
from services.file_store import file_store


@pytest.mark.asyncio
async def test_stimulus_file_collision_prefers_real_disk_file():
    await init_db()

    job_id = f"job-collision-{uuid.uuid4().hex[:6]}"
    target_id = str(uuid.uuid4())
    filename = "vector_collision_test.ist"

    # Create real file on disk
    real_storage_rel = f"uploads/IST/2026/09/real_{uuid.uuid4().hex[:6]}.ist"
    real_storage_abs = file_store.resolve_path(real_storage_rel)
    os.makedirs(os.path.dirname(real_storage_abs), exist_ok=True)
    with open(real_storage_abs, "wb") as f:
        f.write(b"REAL STIMULUS DATA ON DISK\n")

    ghost_storage_rel = "uploads/IST/2026/09/ghost_non_existent.ist"
    ghost_storage_abs = file_store.resolve_path(ghost_storage_rel)
    if os.path.exists(ghost_storage_abs):
        os.remove(ghost_storage_abs)

    now = datetime.utcnow()
    real_file_id = f"file-real-{uuid.uuid4().hex[:6]}"
    ghost_file_id = f"file-ghost-{uuid.uuid4().hex[:6]}"

    async with async_session() as session:
        # Ghost file row is NEWER than real file row (uploaded 1 minute later)
        session.add(FileORM(
            id=real_file_id,
            filename=filename,
            file_type=FileType.VCD,
            storage_path=real_storage_rel,
            size_bytes=len(b"REAL STIMULUS DATA ON DISK\n"),
            checksum_sha256="sha-real",
            uploaded_at=now - timedelta(minutes=5)
        ))
        session.add(FileORM(
            id=ghost_file_id,
            filename=filename,
            file_type=FileType.VCD,
            storage_path=ghost_storage_rel,  # DOES NOT EXIST ON DISK
            size_bytes=100,
            checksum_sha256="sha-ghost",
            uploaded_at=now  # Newer!
        ))

        # Add Job and JobTarget
        job = JobORM(id=job_id, name="Collision Test Job", state="pending")
        session.add(job)
        target = JobTargetORM(id=target_id, job_id=job_id, requested_board_id="kr260-test", status="pending")
        session.add(target)
        await session.commit()

    # Precreate results with pairsData referencing filename
    pairs_data = [
        {
            "testCaseName": "Collision TC",
            "vcdName": filename,
            "binName": "fw.bin",
        }
    ]

    async with async_session() as session:
        await job_queue_service._precreate_results_from_pairs(session, job_id, pairs_data)
        await session.commit()

    # Verify that the created ResultORM and TestCaseORM bound to real_file_id, NOT ghost_file_id!
    async with async_session() as session:
        from sqlalchemy import select
        res = (await session.execute(select(ResultORM).where(ResultORM.job_id == job_id))).scalar_one()
        assert res.snapshot_data.get("vcd_file_id") == real_file_id

        tc = (await session.execute(select(TestCaseORM).where(TestCaseORM.id == res.test_case_id))).scalar_one()
        assert tc.vcd_file_id == real_file_id

    # Clean up file
    if os.path.exists(real_storage_abs):
        os.remove(real_storage_abs)


@pytest.mark.asyncio
async def test_stimulus_file_explicit_id_priority():
    await init_db()

    job_id = f"job-explicit-{uuid.uuid4().hex[:6]}"
    target_id = str(uuid.uuid4())
    explicit_file_id = f"file-explicit-{uuid.uuid4().hex[:6]}"

    async with async_session() as session:
        session.add(FileORM(
            id=explicit_file_id,
            filename="my_stimulus.ist",
            file_type=FileType.VCD,
            storage_path="uploads/IST/2026/09/dummy.ist",
            size_bytes=10,
            checksum_sha256="sha-explicit"
        ))
        job = JobORM(id=job_id, name="Explicit Test Job", state="pending")
        session.add(job)
        target = JobTargetORM(id=target_id, job_id=job_id, requested_board_id="kr260-test", status="pending")
        session.add(target)
        await session.commit()

    pairs_data = [
        {
            "testCaseName": "Explicit TC",
            "vcdName": "different_filename.ist",
            "vcdId": explicit_file_id,
        }
    ]

    async with async_session() as session:
        await job_queue_service._precreate_results_from_pairs(session, job_id, pairs_data)
        await session.commit()

    async with async_session() as session:
        from sqlalchemy import select
        res = (await session.execute(select(ResultORM).where(ResultORM.job_id == job_id))).scalar_one()
        assert res.snapshot_data.get("vcd_file_id") == explicit_file_id

        tc = (await session.execute(select(TestCaseORM).where(TestCaseORM.id == res.test_case_id))).scalar_one()
        assert tc.vcd_file_id == explicit_file_id
