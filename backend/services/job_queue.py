"""
Job Queue Service with relative path storage, target board assignment, and unified results execution loop.
"""
from typing import List, Optional, Dict
from datetime import datetime
import asyncio
import uuid
import os

from sqlalchemy import select, update, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.job import Job, JobCreate, JobStatus, JobState
from services.board_manager import board_manager
from services.file_store import file_store
from services.result_store import result_store
from services.fe_job_store import fe_job_store
from services.job_file_store import job_file_store
from models.result import TestResult
from db.database import async_session
from db.orm_models import JobORM, JobTargetORM, ResultORM, TestCaseORM, RunSetORM, FileORM

class JobQueueService:
    """Manages the job queue and execution schedule using redesigned ORM tables."""

    def __init__(self):
        self._running: bool = False
        self._current_task: Optional[asyncio.Task] = None
        self._loop_mode: bool = False

    async def initialize(self):
        """Initialize the service on startup."""
        print("[JobQueue] Service initialized with Redesigned ORM tables")

    async def shutdown(self):
        """Shutdown the service."""
        if self._current_task:
            self._current_task.cancel()
        print("[JobQueue] Service shutdown")

    def _orm_to_model(self, orm: JobORM) -> Job:
        """Convert ORM object to Pydantic model."""
        return Job(
            id=orm.id,
            name=orm.name,
            vcd_filename="",
            firmware_filename=None,
            vcd_file_id=None,
            firmware_file_id=None,
            target_board_id=None,
            target_board_ids=None,
            assigned_board_id=None,
            priority=orm.priority,
            timeout_seconds=orm.timeout_seconds,
            retries=0,
            enable_picoscope=orm.enable_picoscope,
            save_to_db=True,
            status=JobStatus(
                state=JobState(orm.state),
                progress=orm.progress,
                current_step=orm.current_step,
                error_message=orm.error_message,
            ),
            created_at=orm.created_at,
            started_at=orm.started_at,
            completed_at=orm.completed_at,
            tag=orm.tag,
            tag_color=orm.tag_color,
            client_id=orm.client_id,
            profile_id=orm.profile_id,
            profile_display_name=orm.profile_display_name,
            config_name=orm.config_name,
            pairs_data=orm.pairs_data,
        )

    async def get_all_jobs(self) -> List[Job]:
        """Get all jobs in queue order."""
        async with async_session() as session:
            result = await session.execute(
                select(JobORM).order_by(JobORM.priority.desc(), JobORM.created_at.asc())
            )
            jobs = result.scalars().all()
            return [self._orm_to_model(j) for j in jobs]

    async def get_job(self, job_id: str) -> Optional[Job]:
        """Get a specific job."""
        async with async_session() as session:
            result = await session.execute(
                select(JobORM).where(JobORM.id == job_id)
            )
            orm = result.scalar_one_or_none()
            return self._orm_to_model(orm) if orm else None

    async def add_job(self, job_data: JobCreate) -> Job:
        """Add a new job to the queue and initialize target boards."""
        job_id = str(uuid.uuid4())[:8]
        
        async with async_session() as session:
            # 1. Create JobORM record (default state is draft if specified, else pending)
            state = "draft" if job_data.save_to_db is False else "pending"
            orm = JobORM(
                id=job_id,
                name=job_data.name,
                state=state,
                progress=0,
                priority=job_data.priority,
                timeout_seconds=job_data.timeout_seconds,
                enable_picoscope=job_data.enable_picoscope,
                tag=getattr(job_data, 'tag', None),
                tag_color=getattr(job_data, 'tag_color', None),
                client_id=getattr(job_data, 'client_id', None),
                profile_id=getattr(job_data, 'profile_id', None),
                profile_display_name=getattr(job_data, 'profile_display_name', None),
                config_name=getattr(job_data, 'config_name', None),
                pairs_data=getattr(job_data, 'pairs_data', None),
                created_at=datetime.utcnow(),
            )
            session.add(orm)

            # 2. Map Target Boards (JobTargetORM)
            if job_data.target_board_ids and len(job_data.target_board_ids) > 0:
                for b_id in job_data.target_board_ids:
                    target = JobTargetORM(
                        id=str(uuid.uuid4()),
                        job_id=job_id,
                        target_type="specific",
                        requested_board_id=b_id,
                        status="pending"
                    )
                    session.add(target)
            elif job_data.target_board_id:
                target = JobTargetORM(
                    id=str(uuid.uuid4()),
                    job_id=job_id,
                    target_type="specific",
                    requested_board_id=job_data.target_board_id,
                    status="pending"
                )
                session.add(target)
            else:
                target = JobTargetORM(
                    id=str(uuid.uuid4()),
                    job_id=job_id,
                    target_type="any",
                    requested_board_id=None,
                    status="pending"
                )
                session.add(target)

            await session.commit()
            await session.refresh(orm)

            # If pairs_data is provided (from UI layout), we can pre-create ResultORM rows (acting as job files queue)
            if job_data.pairs_data:
                await self._precreate_results_from_pairs(session, job_id, job_data.pairs_data)
                await session.commit()

            return self._orm_to_model(orm)

    async def _precreate_results_from_pairs(self, session: AsyncSession, job_id: str, pairs_data: list):
        """Pre-populate ResultORM rows for each target board when job is created."""
        # Load all target boards created for this job
        t_res = await session.execute(select(JobTargetORM).where(JobTargetORM.job_id == job_id))
        targets = t_res.scalars().all()

        for idx, pair in enumerate(pairs_data):
            # Resolve test_case_id from name or use default/created
            tc_name = pair.get("testCaseName") or f"TC_{idx+1}"
            vcd_name = pair.get("vcdName")
            
            # Find TestCaseORM
            tc_id = None
            if vcd_name:
                from db.orm_models import FileORM
                f_res = await session.execute(
                    select(FileORM.id)
                    .where(FileORM.filename == vcd_name)
                    .order_by(FileORM.uploaded_at.desc())
                )
                vcd_id = f_res.scalars().first()
                if vcd_id:
                    tc_q = (
                        select(TestCaseORM.id)
                        .where(TestCaseORM.vcd_file_id == vcd_id)
                        .order_by(TestCaseORM.created_at.desc())
                    )
                    tc_id = (await session.execute(tc_q)).scalars().first()

            if not tc_id:
                # Mock a test case
                tc_id = str(uuid.uuid4())
                mock_tc = TestCaseORM(
                    id=tc_id,
                    name=tc_name,
                    vcd_file_id=str(uuid.uuid4())
                )
                session.add(mock_tc)
                await session.flush()

            # Create a pending ResultORM row for each board target
            for target in targets:
                res_id = str(uuid.uuid4())[:8] # Keep ID short for compatibility
                orm_res = ResultORM(
                    id=res_id,
                    job_id=job_id,
                    job_target_id=target.id,
                    test_case_id=tc_id,
                    status="pending",
                    execution_order=(idx + 1) * 10,
                    try_count=0,
                    passed=None,
                    snapshot_data={
                        "test_case_name": tc_name,
                        "vcd_filename": vcd_name,
                        "firmware_filename": pair.get("binName"),
                        "ulp_filename": pair.get("linName"),
                    },
                    created_at=datetime.utcnow()
                )
                session.add(orm_res)
        await session.flush()

    async def remove_job(self, job_id: str) -> bool:
        """Remove a job and its targets and results from the database."""
        await result_store.delete_results_for_job(job_id)
        await job_file_store.delete_job_files(job_id)
        await board_manager.release_boards_holding_job(job_id)
        fe_job_store.remove_job(job_id)
        
        async with async_session() as session:
            # Delete job targets
            await session.execute(delete(JobTargetORM).where(JobTargetORM.job_id == job_id))
            # Delete job record
            result = await session.execute(
                delete(JobORM).where(JobORM.id == job_id)
            )
            await session.commit()
            return result.rowcount > 0

    async def update_job_status(
        self,
        job_id: str,
        state: JobState,
        progress: int = 0,
        current_step: Optional[str] = None,
        error_message: Optional[str] = None,
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
        assigned_board_id: Optional[str] = None,
    ):
        """Update job status in database.

        ``assigned_board_id`` (optional) records which board the job was assigned to;
        it is stored on the job's targets (JobORM has no board column) so callers that
        start a job with a chosen board do not fail.
        """
        async with async_session() as session:
            values = {
                "state": state.value,
                "progress": progress,
                "current_step": current_step,
                "error_message": error_message,
            }
            if started_at:
                values["started_at"] = started_at
            if completed_at:
                values["completed_at"] = completed_at

            await session.execute(
                update(JobORM).where(JobORM.id == job_id).values(**values)
            )
            if assigned_board_id:
                await session.execute(
                    update(JobTargetORM)
                    .where(JobTargetORM.job_id == job_id)
                    .values(actual_board_id=assigned_board_id)
                )
            await session.commit()

    async def start(self):
        """Start queue processing."""
        if self._running:
            return
        self._running = True
        self._current_task = asyncio.create_task(self._process_queue())
        print("[JobQueue] Started processing loop")

    async def stop(self):
        """Stop queue processing."""
        self._running = False
        if self._current_task:
            self._current_task.cancel()
            self._current_task = None
        print("[JobQueue] Stopped processing loop")

    async def _process_queue(self):
        """Main queue loop processing pending job targets."""
        while self._running:
            try:
                async with async_session() as session:
                    # 1. Fetch next pending job target
                    q = (
                        select(JobTargetORM)
                        .where(JobTargetORM.status == "pending")
                        .join(JobORM, JobORM.id == JobTargetORM.job_id)
                        .where(JobORM.state == "pending")
                        .order_by(JobORM.priority.desc(), JobORM.created_at.asc())
                        .limit(1)
                    )
                    res = await session.execute(q)
                    target = res.scalar_one_or_none()
                    
                    if target:
                        # 2. Lock board and execute target
                        await self._execute_target(target.id)
                    else:
                        await asyncio.sleep(1)
            except Exception as e:
                print(f"[JobQueue] Loop Error: {e}")
                await asyncio.sleep(1)

    async def _execute_target(self, target_id: str):
        """Assign board and run all test items (ResultORM queue) for a job target."""
        async with async_session() as session:
            target = (await session.execute(select(JobTargetORM).where(JobTargetORM.id == target_id))).scalar_one()
            job = (await session.execute(select(JobORM).where(JobORM.id == target.job_id))).scalar_one()
            
            # Lock status to running
            target.status = "running"
            target.started_at = datetime.utcnow()
            job.state = "configuring"
            job.started_at = datetime.utcnow()
            await session.commit()

        # 1. Find available board matching user intent
        board = None
        if target.target_type == "specific":
            board = await board_manager.get_available_board(target_board_id=target.requested_board_id)
        else:
            board = await board_manager.get_available_board()

        if not board:
            # Revert target status to pending to retry board allocation next loop
            async with async_session() as session:
                target = (await session.execute(select(JobTargetORM).where(JobTargetORM.id == target_id))).scalar_one()
                target.status = "pending"
                await session.commit()
            print(f"[JobQueue] Target {target_id} pending: board not available")
            await asyncio.sleep(2)
            return

        # Lock board
        await board_manager.set_board_busy(board.id, target.job_id)
        
        async with async_session() as session:
            target = (await session.execute(select(JobTargetORM).where(JobTargetORM.id == target_id))).scalar_one()
            target.actual_board_id = board.id
            target.board_assigned_at = datetime.utcnow()
            await session.commit()

        try:
            # 2. Load run sequence (ResultORM rows in pending state)
            async with async_session() as session:
                r_res = await session.execute(
                    select(ResultORM)
                    .where(and_(ResultORM.job_target_id == target_id, ResultORM.status == "pending"))
                    .order_by(ResultORM.execution_order.asc())
                )
                test_runs = list(r_res.scalars().all())

            if not test_runs:
                # No tests to run, mark target as completed
                async with async_session() as session:
                    target = (await session.execute(select(JobTargetORM).where(JobTargetORM.id == target_id))).scalar_one()
                    target.status = "completed"
                    target.completed_at = datetime.utcnow()
                    
                    job_orm = (await session.execute(select(JobORM).where(JobORM.id == target.job_id))).scalar_one()
                    job_orm.state = "completed"
                    job_orm.progress = 100
                    job_orm.current_step = "No test cases to execute"
                    job_orm.completed_at = datetime.utcnow()
                    await session.commit()
                return

            print(f"[JobQueue] Executing {len(test_runs)} test cases on board {board.name}")
            total_tests = len(test_runs)

            for idx, run in enumerate(test_runs):
                async with async_session() as session:
                    # Refresh run object in this session
                    run_orm = (await session.execute(select(ResultORM).where(ResultORM.id == run.id))).scalar_one()
                    run_orm.status = "running"
                    run_orm.started_at = datetime.utcnow()
                    
                    # Update job step
                    job_orm = (await session.execute(select(JobORM).where(JobORM.id == target.job_id))).scalar_one()
                    job_orm.state = "running"
                    job_orm.current_step = f"Running test case {idx+1}/{total_tests}: {run_orm.snapshot_data.get('test_case_name')}"
                    job_orm.progress = int((idx / total_tests) * 100)
                    await session.commit()

                # Load TestCase details
                async with async_session() as session:
                    tc = (await session.execute(select(TestCaseORM).where(TestCaseORM.id == run.test_case_id))).scalar_one()
                    lin_file_id = tc.lin_file_id

                # Point 10: Skip ULP flashing/checking if ULP file ID (lin_file_id) is NULL
                if not lin_file_id:
                    print(f"[JobQueue] Test Case {tc.name} has no ULP stimulus. Skipping board ULP configuration step.")
                    # log skip in job current step
                    async with async_session() as session:
                        job_orm = (await session.execute(select(JobORM).where(JobORM.id == target.job_id))).scalar_one()
                        job_orm.current_step += " (Skipped ULP)"
                        await session.commit()

                # Real execution with try/retry logic.
                # Point 11: Retry count is configured at test case item level
                try_limit = 1
                # Retrieve configured try count from RunSet if defined
                async with async_session() as session:
                    rs_q = (
                        select(RunSetORM.test_case_ids)
                        .join(JobORM, JobORM.config_name == RunSetORM.name)
                        .where(JobORM.id == target.job_id)
                        .order_by(RunSetORM.created_at.desc())
                    )
                    rs_item = (await session.execute(rs_q)).scalars().first()
                    if rs_item:
                        for item in rs_item:
                            if item.get("test_case_id") == run.test_case_id:
                                try_limit = item.get("try_count", 1)

                # Assets the agent will download: bin_file_id = EROM firmware (flashed),
                # vcd_file_id = stimulus. Agent resolves them against its own backend base.
                fw_file_id = tc.bin_file_id
                binary_file_id = tc.vcd_file_id
                params = dict(tc.config_options or {})
                if "col_offset" not in params:
                    params["col_offset"] = 12
                if "clear_ram_mb" not in params:
                    params["clear_ram_mb"] = 100
                if "sample_rate_hz" not in params:
                    params["sample_rate_hz"] = 100000000.0

                # Calculate dynamic execution timeout: explicit job/params setting or VCD stimulus file size base
                timeout_seconds = job.timeout_seconds or (params.get("timeout_seconds") if isinstance(params, dict) else None)
                if not timeout_seconds or timeout_seconds <= 0:
                    vcd_size_mb = 0
                    if binary_file_id:
                        async with async_session() as session:
                            f_size = (await session.execute(select(FileORM.size_bytes).where(FileORM.id == binary_file_id))).scalar_one_or_none()
                            if f_size:
                                vcd_size_mb = f_size / (1024 * 1024)
                    # Dynamic base: 120s minimum + 60s per MB of VCD stimulus file
                    timeout_seconds = max(120.0, 120.0 + (vcd_size_mb * 60.0))

                actual_tries = 0
                success = False
                error_msg = None

                while actual_tries < try_limit and not success:
                    actual_tries += 1
                    print(f"[JobQueue] Dispatching test {run.id} attempt {actual_tries}/{try_limit} to board {board.name}")

                    async with async_session() as session:
                        run_orm = (await session.execute(select(ResultORM).where(ResultORM.id == run.id))).scalar_one()
                        run_orm.status = "running"
                        if run_orm.started_at is None:
                            run_orm.started_at = datetime.utcnow()
                        await session.commit()

                    dispatched = await board_manager.execute_job(
                        board.id,
                        job_id=target.job_id,
                        result_id=run.id,
                        fw_file_id=fw_file_id,
                        binary_file_id=binary_file_id,
                        params=params,
                    )
                    if not dispatched:
                        error_msg = "Failed to dispatch job to board agent"
                        print(f"[JobQueue] {error_msg} (attempt {actual_tries})")
                        await asyncio.sleep(1)
                        continue

                    # The agent runs asynchronously and reports completion via
                    # POST /api/boards/{id}/measurements, which flips ResultORM.status.
                    final_status, error_msg = await self._wait_for_result(run.id, timeout_seconds)
                    if final_status == "completed":
                        success = True
                    elif final_status == "timeout":
                        error_msg = error_msg or "Timed out waiting for board result"
                        print(f"[JobQueue] Test {run.id} timed out (attempt {actual_tries})")
                    else:
                        print(f"[JobQueue] Test {run.id} reported error (attempt {actual_tries}): {error_msg}")

                # Finalize the result row. On success the agent's measurement call
                # already set status/passed/metrics; here we only stamp retries and
                # record failures the agent could not report (dispatch/timeout).
                async with async_session() as session:
                    run_orm = (await session.execute(select(ResultORM).where(ResultORM.id == run.id))).scalar_one()
                    run_orm.try_count = actual_tries
                    if not success:
                        run_orm.status = "error"
                        run_orm.passed = False
                        run_orm.error_message = error_msg
                        if run_orm.completed_at is None:
                            run_orm.completed_at = datetime.utcnow()
                        if run_orm.duration_seconds is None and run_orm.started_at is not None:
                            run_orm.duration_seconds = (datetime.utcnow() - run_orm.started_at).total_seconds()
                    await session.commit()

            # Mark target as completed
            async with async_session() as session:
                target = (await session.execute(select(JobTargetORM).where(JobTargetORM.id == target_id))).scalar_one()
                target.status = "completed"
                target.completed_at = datetime.utcnow()
                
                # Update Job progress and status
                job_orm = (await session.execute(select(JobORM).where(JobORM.id == target.job_id))).scalar_one()
                job_orm.state = "completed"
                job_orm.progress = 100
                job_orm.current_step = "Done"
                job_orm.completed_at = datetime.utcnow()
                await session.commit()
                print(f"[JobQueue] Completed target {target_id} successfully")

        except Exception as e:
            async with async_session() as session:
                target = (await session.execute(select(JobTargetORM).where(JobTargetORM.id == target_id))).scalar_one()
                target.status = "failed"
                target.completed_at = datetime.utcnow()
                
                job_orm = (await session.execute(select(JobORM).where(JobORM.id == target.job_id))).scalar_one()
                job_orm.state = "failed"
                job_orm.error_message = str(e)
                job_orm.completed_at = datetime.utcnow()
                await session.commit()
            print(f"[JobQueue] Failed executing target {target_id}: {e}")
            
        finally:
            await board_manager.set_board_idle(board.id)

    async def _wait_for_result(self, result_id: str, timeout_seconds: float) -> tuple[str, Optional[str]]:
        """Poll a ResultORM row until the board agent marks it completed/error.

        Returns (status, error_message) where status is 'completed', 'error', or
        'timeout'. The agent flips the row via POST /api/boards/{id}/measurements.
        """
        deadline = asyncio.get_event_loop().time() + max(5.0, float(timeout_seconds))
        while asyncio.get_event_loop().time() < deadline:
            async with async_session() as session:
                row = (
                    await session.execute(
                        select(ResultORM.status, ResultORM.error_message).where(ResultORM.id == result_id)
                    )
                ).first()
            if row and row[0] in ("completed", "error"):
                return row[0], row[1]
            await asyncio.sleep(1.0)
        return "timeout", None

    async def get_status(self) -> dict:
        """Get queue status summary."""
        async with async_session() as session:
            result = await session.execute(select(JobORM))
            jobs = result.scalars().all()
            
        states = {}
        for job in jobs:
            states[job.state] = states.get(job.state, 0) + 1

        return {
            "running": self._running,
            "loop_mode": self._loop_mode,
            "total_jobs": len(jobs),
            "jobs_by_state": states,
        }

job_queue_service = JobQueueService()
