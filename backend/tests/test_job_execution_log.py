"""
Test Job Execution Log Ingestion & Retrieval (Ticket 01).
Verifies that post_measurements with console_log saves the raw log to disk
under uploads/LOG/{year}/{month}/{result_id}.log, records it in FileORM,
and serves it via GET /api/results/{result_id}/log.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"
import uuid
from datetime import datetime
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from main import app
from db.database import init_db, async_session
from db.orm_models import JobORM, JobTargetORM, TestCaseORM, ResultORM, FileORM, FileType


@pytest.mark.asyncio
async def test_post_measurements_ingests_console_log():
    await init_db()

    job_id = f"job-{uuid.uuid4().hex[:6]}"
    target_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())
    res_id = f"res-{uuid.uuid4().hex[:6]}"
    board_id = "test-kr260-board"

    # Seed DB with Job, Target, TestCase, Result
    async with async_session() as session:
        job = JobORM(id=job_id, name="Log Test Job", state="running")
        session.add(job)
        target = JobTargetORM(id=target_id, job_id=job_id, requested_board_id=board_id, actual_board_id=board_id, status="running")
        session.add(target)
        tc = TestCaseORM(id=tc_id, name="Test Case 1", vcd_file_id="dummy-vcd")
        session.add(tc)
        res = ResultORM(
            id=res_id,
            job_id=job_id,
            job_target_id=target_id,
            test_case_id=tc_id,
            status="running",
            execution_order=1,
        )
        session.add(res)
        await session.commit()

    sample_log = (
        "[KR260 Boot] Initializing PL bitstream...\n"
        "[DMA] Starting transfer: 1024 beats\n"
        "[DMA] Transfer complete. CRC verified: 0xDEADBEEF\n"
        "[Agent] Execution finished with code 0.\n"
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Post measurements with console_log
        resp = await client.post(
            f"/api/boards/{board_id}/measurements",
            json={
                "job_id": job_id,
                "result_id": res_id,
                "passed": True,
                "duration_seconds": 1.25,
                "console_log": sample_log,
            },
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "ok"
        assert data["result_id"] == res_id

        # 2. Verify FileORM record exists
        async with async_session() as session:
            file_record = (
                await session.execute(
                    select(FileORM).where(
                        FileORM.result_id == res_id,
                        FileORM.file_type == FileType.LOG,
                    )
                )
            ).scalar_one_or_none()
            assert file_record is not None
            assert f"{res_id}.log" in file_record.storage_path

        # 3. Verify GET /api/results/{result_id}/log returns the log text
        log_resp = await client.get(f"/api/results/{res_id}/log")
        assert log_resp.status_code == 200
        assert log_resp.json() == {"log": sample_log}
