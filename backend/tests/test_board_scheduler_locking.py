import os
os.environ["USE_SQLITE_DEMO"] = "1"
import uuid
import pytest
from datetime import datetime, timedelta
from sqlalchemy import select

from db.database import init_db, async_session
from db.orm_models import JobORM, JobTargetORM, ResultORM, BoardORM, BoardStatusORM, TestCaseORM
from services.board_manager import board_manager
from services.job_queue import job_queue_service


@pytest.mark.asyncio
async def test_mark_stale_boards_offline_fails_running_targets():
    await init_db()

    board_id = f"board-stale-{uuid.uuid4().hex[:6]}"
    job_id = f"job-stale-{uuid.uuid4().hex[:6]}"
    target_id = str(uuid.uuid4())
    res_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())

    stale_time = datetime.utcnow() - timedelta(seconds=120)

    async with async_session() as session:
        session.add(BoardORM(
            id=board_id,
            name="Stale Board",
            ip_address="192.168.1.200",
            state="busy",
            current_job_id=job_id,
            last_heartbeat=stale_time
        ))
        session.add(BoardStatusORM(
            board_id=board_id,
            state="busy",
            last_heartbeat=stale_time
        ))
        session.add(JobORM(
            id=job_id,
            name="Stale Watchdog Job",
            state="running"
        ))
        session.add(JobTargetORM(
            id=target_id,
            job_id=job_id,
            target_type="specific",
            requested_board_id=board_id,
            actual_board_id=board_id,
            status="running"
        ))
        session.add(TestCaseORM(id=tc_id, name="TC Stale", vcd_file_id="dummy"))
        session.add(ResultORM(
            id=res_id,
            job_id=job_id,
            job_target_id=target_id,
            test_case_id=tc_id,
            status="running"
        ))
        await session.commit()

    # Run watchdog sweep (timeout 30s)
    flipped = await board_manager.mark_stale_boards_offline(timeout_seconds=30)
    assert flipped >= 1

    # Verify board is offline and lock cleared
    async with async_session() as session:
        b_orm = (await session.execute(select(BoardORM).where(BoardORM.id == board_id))).scalar_one()
        assert b_orm.state == "offline"
        assert b_orm.current_job_id is None

        # Verify target is marked failed
        tgt = (await session.execute(select(JobTargetORM).where(JobTargetORM.id == target_id))).scalar_one()
        assert tgt.status == "failed"

        # Verify result is marked error
        res = (await session.execute(select(ResultORM).where(ResultORM.id == res_id))).scalar_one()
        assert res.status == "error"
        assert res.passed is False

        # Verify job is marked failed
        job = (await session.execute(select(JobORM).where(JobORM.id == job_id))).scalar_one()
        assert job.state == "failed"


@pytest.mark.asyncio
async def test_startup_reconciliation_cleans_interrupted_jobs():
    await init_db()

    board_id = f"board-reconcile-{uuid.uuid4().hex[:6]}"
    job_id = f"job-reconcile-{uuid.uuid4().hex[:6]}"
    target_id = str(uuid.uuid4())
    res_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())

    async with async_session() as session:
        session.add(BoardORM(
            id=board_id,
            name="Reconcile Board",
            ip_address="192.168.1.201",
            state="busy",
            current_job_id=job_id
        ))
        session.add(BoardStatusORM(
            board_id=board_id,
            state="busy"
        ))
        session.add(JobORM(
            id=job_id,
            name="Interrupted Job",
            state="running"
        ))
        session.add(JobTargetORM(
            id=target_id,
            job_id=job_id,
            actual_board_id=board_id,
            status="running"
        ))
        session.add(TestCaseORM(id=tc_id, name="TC Reconcile", vcd_file_id="dummy"))
        session.add(ResultORM(
            id=res_id,
            job_id=job_id,
            job_target_id=target_id,
            test_case_id=tc_id,
            status="running"
        ))
        await session.commit()

    # Run initialize (simulating backend boot)
    await job_queue_service.initialize()

    async with async_session() as session:
        # Job, target, result should be failed
        job = (await session.execute(select(JobORM).where(JobORM.id == job_id))).scalar_one()
        assert job.state == "failed"
        assert "server restart" in job.current_step.lower()

        tgt = (await session.execute(select(JobTargetORM).where(JobTargetORM.id == target_id))).scalar_one()
        assert tgt.status == "failed"

        res = (await session.execute(select(ResultORM).where(ResultORM.id == res_id))).scalar_one()
        assert res.status == "error"

        # Board should be reset to online and lock cleared
        b_orm = (await session.execute(select(BoardORM).where(BoardORM.id == board_id))).scalar_one()
        assert b_orm.state == "online"
        assert b_orm.current_job_id is None

        b_status = (await session.execute(select(BoardStatusORM).where(BoardStatusORM.board_id == board_id))).scalar_one()
        assert b_status.state == "online"
