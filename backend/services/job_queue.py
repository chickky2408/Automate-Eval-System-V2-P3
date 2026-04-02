"""
Job Queue Service with PostgreSQL persistence.
Manages the test job queue and execution scheduling.
"""
from typing import List, Optional, Dict
from datetime import datetime
import asyncio
import uuid
import os

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from models.job import Job, JobCreate, JobStatus, JobState
from services.board_manager import board_manager
from services.file_store import file_store
from services.result_store import result_store
from services.fe_job_store import fe_job_store
from services.job_file_store import job_file_store
from models.result import TestResult, WaveformData
from db.database import async_session
from db.orm_models import JobORM

class JobQueueService:
    """Manages the job queue and execution with SQLite persistence."""

    def __init__(self):
        self._running: bool = False
        self._current_task: Optional[asyncio.Task] = None
        self._loop_mode: bool = False

    async def initialize(self):
        """Initialize the service (called on app startup)."""
        print("[JobQueue] Service initialized with PostgreSQL persistence")
        # Auto-restart queue if needed, or just leave it modifying

    async def shutdown(self):
        """Shutdown the service (called on app shutdown)."""
        if self._current_task:
            self._current_task.cancel()
        print("[JobQueue] Service shutdown")

    def _orm_to_model(self, orm: JobORM) -> Job:
        """Convert ORM object to Pydantic model."""
        return Job(
            id=orm.id,
            name=orm.name,
            vcd_filename=orm.vcd_filename, # Legacy support
            firmware_filename=orm.firmware_filename, # Legacy support
            vcd_file_id=orm.vcd_file_id, # File ID
            firmware_file_id=orm.firmware_file_id, # File ID
            target_board_id=orm.target_board_id,
            target_board_ids=orm.target_board_ids,  # For broadcast mode
            assigned_board_id=orm.assigned_board_id,
            priority=orm.priority,
            timeout_seconds=orm.timeout_seconds,
            retries=orm.retries,
            enable_picoscope=orm.enable_picoscope,
            save_to_db=orm.save_to_db,
            status=JobStatus(
                state=JobState(orm.state),
                progress=orm.progress,
                current_step=orm.current_step,
                error_message=orm.error_message,
            ),
            created_at=orm.created_at,
            started_at=orm.started_at,
            completed_at=orm.completed_at,
            tag=orm.tag,  # Frontend metadata
            tag_color=getattr(orm, "tag_color", None),
            client_id=orm.client_id,  # Frontend metadata
            profile_id=getattr(orm, "profile_id", None),
            profile_display_name=getattr(orm, "profile_display_name", None),
            config_name=orm.config_name,  # Frontend metadata
            pairs_data=orm.pairs_data,  # Frontend metadata
        )

    async def _resolve_file_id(self, filename: Optional[str]) -> Optional[str]:
        """Resolve file ID from filename."""
        if not filename:
            return None
        from services.file_store import file_store
        files = await file_store.list_files()
        for f in files:
            if f["name"] == filename:
                return f["id"]
        return None

    async def get_all_jobs(self) -> List[Job]:
        """Get all jobs in queue order."""
        async with async_session() as session:
            result = await session.execute(
                select(JobORM).order_by(JobORM.priority.desc(), JobORM.queue_position)
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
        """Add a new job to the queue."""
        job_id = str(uuid.uuid4())[:8]
        
        # Resolve file IDs
        vcd_file_id = await self._resolve_file_id(job_data.vcd_filename)
        firmware_file_id = await self._resolve_file_id(job_data.firmware_filename)
        
        async with async_session() as session:
            # Get max queue position
            result = await session.execute(
                select(JobORM.queue_position).order_by(JobORM.queue_position.desc()).limit(1)
            )
            max_pos = result.scalar() or 0
            
            orm = JobORM(
                id=job_id,
                name=job_data.name,
                vcd_file_id=vcd_file_id,  # Use file ID
                firmware_file_id=firmware_file_id,  # Use file ID
                vcd_filename=job_data.vcd_filename,  # Keep for backward compatibility
                firmware_filename=job_data.firmware_filename,  # Keep for backward compatibility
                target_board_id=job_data.target_board_id,
                target_board_ids=job_data.target_board_ids,  # For broadcast mode
                priority=job_data.priority,
                queue_position=max_pos + 1,
                timeout_seconds=job_data.timeout_seconds,
                retries=job_data.retries,
                enable_picoscope=job_data.enable_picoscope,
                save_to_db=job_data.save_to_db,
                state="pending",
                progress=0,
                # Frontend metadata
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
            await session.commit()
            await session.refresh(orm)
            return self._orm_to_model(orm)

    async def remove_job(self, job_id: str) -> bool:
        """Remove a job from the queue and related persisted data (results, job_files, FE cache, boards)."""
        await result_store.delete_results_for_job(job_id)
        await job_file_store.delete_job_files(job_id)
        await board_manager.release_boards_holding_job(job_id)
        fe_job_store.remove_job(job_id)
        async with async_session() as session:
            result = await session.execute(
                delete(JobORM).where(JobORM.id == job_id)
            )
            await session.commit()
            return result.rowcount > 0

    async def reorder_job(self, job_id: str, new_position: int) -> bool:
        """Move a job to a new position (0-based index). Reassigns queue_position for all jobs."""
        async with async_session() as session:
            result = await session.execute(
                select(JobORM).order_by(JobORM.priority.desc(), JobORM.queue_position)
            )
            jobs = list(result.scalars().all())
            idx = next((i for i, j in enumerate(jobs) if j.id == job_id), -1)
            if idx < 0 or new_position < 0 or new_position >= len(jobs):
                return False
            moved = jobs.pop(idx)
            jobs.insert(new_position, moved)
            for i, orm in enumerate(jobs):
                orm.queue_position = i
            await session.commit()
            return True

    async def update_job_meta(
        self, job_id: str, *, name: Optional[str] = None,
        vcd_filename: Optional[str] = None, firmware_filename: Optional[str] = None,
        pairs_data: Optional[dict] = None,
        client_id: Optional[str] = None,
        profile_id: Optional[str] = None,
        profile_display_name: Optional[str] = None,
    ) -> bool:
        """Update job metadata. Only for pending jobs."""
        async with async_session() as session:
            values = {}
            if name is not None:
                values["name"] = name
            if vcd_filename is not None:
                values["vcd_filename"] = vcd_filename
            if firmware_filename is not None:
                values["firmware_filename"] = firmware_filename
            if pairs_data is not None:
                values["pairs_data"] = pairs_data
            if client_id is not None:
                values["client_id"] = client_id
            if profile_id is not None:
                values["profile_id"] = profile_id
            if profile_display_name is not None:
                values["profile_display_name"] = profile_display_name.strip() or None
            if not values:
                return True
            result = await session.execute(
                update(JobORM).where(JobORM.id == job_id).values(**values)
            )
            await session.commit()
            return result.rowcount > 0

    async def update_job_tag_fields(self, job_id: str, fields: Dict[str, Optional[str]]) -> bool:
        """Patch tag and/or tag_color on the job row. Keys: tag, tag_color."""
        if not fields:
            return True
        async with async_session() as session:
            result = await session.execute(select(JobORM).where(JobORM.id == job_id))
            orm = result.scalar_one_or_none()
            if not orm:
                return False
            if "tag" in fields:
                orm.tag = fields["tag"]
            if "tag_color" in fields:
                orm.tag_color = fields["tag_color"]
            await session.commit()
            return True

    async def update_job_status(
        self, 
        job_id: str, 
        state: JobState, 
        progress: int = 0, 
        current_step: Optional[str] = None,
        error_message: Optional[str] = None,
        assigned_board_id: Optional[str] = None,
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
    ):
        """Update job status in database."""
        async with async_session() as session:
            values = {
                "state": state.value,
                "progress": progress,
                "current_step": current_step,
                "error_message": error_message,
            }
            if assigned_board_id:
                values["assigned_board_id"] = assigned_board_id
            if started_at:
                values["started_at"] = started_at
            if completed_at:
                values["completed_at"] = completed_at
                
            await session.execute(
                update(JobORM).where(JobORM.id == job_id).values(**values)
            )
            await session.commit()
            
            # Broadcast via WebSocket (if WS service provided)
            # await ws_manager.broadcast("job_update", {...})

    async def start(self):
        """Start queue processing."""
        if self._running:
            return
        self._running = True
        self._current_task = asyncio.create_task(self._process_queue())
        print("[JobQueue] Started processing")

    async def stop(self):
        """Stop queue processing."""
        self._running = False
        if self._current_task:
            self._current_task.cancel()
            self._current_task = None
        print("[JobQueue] Stopped processing")

    async def _process_queue(self):
        """Main queue processing loop."""
        while self._running:
            try:
                # Find next pending job
                async with async_session() as session:
                    result = await session.execute(
                        select(JobORM)
                        .where(JobORM.state == "pending")
                        .order_by(JobORM.priority.desc(), JobORM.queue_position)
                        .limit(1)
                    )
                    pending_orm = result.scalar_one_or_none()
                    # Detach from session to avoid expiration
                    if pending_orm:
                        pending_job = self._orm_to_model(pending_orm)
                    else:
                        pending_job = None
                        
                if pending_job:
                    await self._execute_job(pending_job)
                else:
                    await asyncio.sleep(1)
            except Exception as e:
                print(f"[JobQueue] Loop Error: {e}")
                await asyncio.sleep(1)

    async def _execute_job_on_board(self, job: Job, board_id: str, board_name: str):
        """Execute a job on a specific board."""
        print(f"[JobQueue] Executing job {job.id} on board {board_id}")

        try:
            # 1. Start Execution
            await self.update_job_status(
                job.id, JobState.CONFIGURING, 10, "Initializing board...",
                assigned_board_id=board_id, started_at=datetime.utcnow()
            )

            # TODO: Resolve file paths from DB if passing ID
            # vcd_path = ...
            
            # 2. Flash Firmware (if needed)
            if job.firmware_filename:
                await self.update_job_status(job.id, JobState.FLASHING, 30, "Programming EROM...")
                # await board_manager.flash_firmware(board_id, job.firmware_filename)

            # 3. Run Test
            await self.update_job_status(job.id, JobState.RUNNING, 50, "Executing test...")
            
            # NOTE: For now still simulating the Agent Call until Agent API is fully integrated
            await asyncio.sleep(2)
            
            # 4. Save Result (Mock Result for now)
            result = TestResult(
                id=uuid.uuid4().hex,
                job_id=job.id,
                job_name=job.name,
                board_id=board_id,
                board_name=board_name,
                passed=True,
                started_at=datetime.utcnow(),
                completed_at=datetime.utcnow(),
                duration_seconds=5.0,
                vcd_filename=job.vcd_filename,
                firmware_filename=job.firmware_filename,
                packet_count=1000,
                crc_errors=0
            )
            await result_store.add_result(result)

            # 5. Complete
            await self.update_job_status(
                job.id, JobState.COMPLETED, 100, "Done",
                completed_at=datetime.utcnow()
            )
            print(f"[JobQueue] Job {job.id} on board {board_id} completed successfully")

        except Exception as e:
            await self.update_job_status(
                job.id, JobState.FAILED, 0, None, str(e),
                completed_at=datetime.utcnow()
            )
            print(f"[JobQueue] Job {job.id} on board {board_id} failed: {e}")

    async def _execute_job(self, job: Job):
        """Execute a job (supports broadcast mode)."""
        print(f"[JobQueue] Executing job: {job.name}")

        # Check for broadcast mode (multiple boards)
        if job.target_board_ids and len(job.target_board_ids) > 0:
            print(f"[JobQueue] Broadcast mode: executing on {len(job.target_board_ids)} boards")
            
            # Execute on all specified boards in parallel
            tasks = []
            for board_id in job.target_board_ids:
                # Get available board info (checks if board is online)
                board = await board_manager.get_available_board(target_board_id=board_id)
                if not board:
                    print(f"[JobQueue] Board {board_id} not available, skipping")
                    continue
                
                # Lock board
                await board_manager.set_board_busy(board.id, job.id)
                
                # Create task for this board
                task = self._execute_job_on_board(job, board.id, board.name)
                tasks.append((task, board.id))
            
            if not tasks:
                print(f"[JobQueue] No available boards for broadcast job {job.id}")
                await asyncio.sleep(5)  # Wait before retrying logic or skipping
                return
            
            # Execute all tasks and handle cleanup
            try:
                await asyncio.gather(*[task for task, _ in tasks])
            finally:
                # Release all boards
                for _, board_id in tasks:
                    await board_manager.set_board_idle(board_id)
            
            return

        # Single board mode (targeted or auto-assign)
        # 1. Find available board
        if job.target_board_id:
            board = await board_manager.get_available_board(target_board_id=job.target_board_id)
        else:
            board = await board_manager.get_available_board()

        if not board:
            print(f"[JobQueue] No available board for job {job.id}")
            await asyncio.sleep(5) # Wait before retrying logic or skipping
            return

        # 2. Lock Board
        await board_manager.set_board_busy(board.id, job.id)

        try:
            # 3. Execute on the board
            await self._execute_job_on_board(job, board.id, board.name)

        finally:
            await board_manager.set_board_idle(board.id)

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


# Singleton instance
job_queue_service = JobQueueService()
