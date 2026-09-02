"""
Board Manager Service
Handles discovery, status tracking, and control of boards.
Communicates with Zybo Agent via HTTP.
"""
from typing import List, Optional
import os
import asyncio
import httpx
from datetime import datetime, timedelta

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from models.board import BoardInfo, BoardStatus, BoardState
from db.database import async_session
from db.orm_models import BoardORM, BoardStatusORM, BoardTelemetryLogORM

class BoardManager:
    """Manages the fleet of Zybo boards."""

    def __init__(self):
        # Port the board agent listens on. Same on every board in production;
        # overridable for local testing where backend + agent share a host.
        self.agent_port = int(os.getenv("AGENT_PORT", "8000"))
        self.http_client = httpx.AsyncClient(timeout=5.0)
        # Store board_id -> timestamp when reboot was initiated to ignore racing final heartbeats
        self._rebooting_boards = {}

    def _orm_to_model(self, orm: BoardORM, status_orm: Optional[BoardStatusORM] = None) -> BoardInfo:
        """Convert ORM object to BoardInfo."""
        s = status_orm
        state_raw = (s.state if s else orm.state) or BoardState.OFFLINE.value
        try:
            state = BoardState(state_raw)
        except ValueError:
            state = BoardState.OFFLINE

        return BoardInfo(
            id=orm.id,
            name=orm.name,
            ip_address=orm.ip_address,
            mac_address=orm.mac_address,
            firmware_version=orm.firmware_version,
            model=orm.model,
            tag=orm.tag,
            connections=orm.connections or [],
            status=BoardStatus(
                state=state,
                cpu_temp=s.cpu_temp if s else orm.cpu_temp,
                cpu_load=s.cpu_load if s else orm.cpu_load,
                ram_usage=s.ram_usage if s else orm.ram_usage,
                current_job_id=s.current_job_id if s else orm.current_job_id,
                last_heartbeat=s.last_heartbeat if s else orm.last_heartbeat,
                fpga_status=(s.fpga_status if s else getattr(orm, 'fpga_status', None)),
                arm_status=(s.arm_status if s else getattr(orm, 'arm_status', None)),
            ),
        )

    async def get_all_boards(self) -> List[BoardInfo]:
        """Get all registered boards."""
        async with async_session() as session:
            result = await session.execute(select(BoardORM))
            boards = result.scalars().all()
            status_rows = (await session.execute(select(BoardStatusORM))).scalars().all()
            status_by_id = {s.board_id: s for s in status_rows}
            return [self._orm_to_model(b, status_by_id.get(b.id)) for b in boards]

    async def get_board(self, board_id: str) -> Optional[BoardInfo]:
        """Get a specific board by ID."""
        async with async_session() as session:
            result = await session.execute(select(BoardORM).where(BoardORM.id == board_id))
            board = result.scalar_one_or_none()
            if not board:
                return None
            s = (await session.execute(select(BoardStatusORM).where(BoardStatusORM.board_id == board_id))).scalar_one_or_none()
            return self._orm_to_model(board, s)

    async def create_board(
        self,
        *,
        board_id: str,
        name: str,
        ip_address: str,
        mac_address: Optional[str],
        firmware_version: Optional[str],
        model: Optional[str],
        tag: Optional[str],
        connections: Optional[list],
        state: BoardState,
    ) -> tuple[BoardInfo, bool]:
        async with async_session() as session:
            # Check if exists by board_id or mac_address
            existing = None
            if board_id:
                existing = (await session.execute(select(BoardORM).where(BoardORM.id == board_id))).scalar_one_or_none()
            if not existing and mac_address:
                existing = (await session.execute(select(BoardORM).where(BoardORM.mac_address == mac_address))).scalar_one_or_none()

            if existing:
                # Update existing board (e.g. IP updated via DHCP)
                target_id = existing.id
                await self.update_board(target_id, {
                    "ip_address": ip_address,
                    "mac_address": mac_address or existing.mac_address,
                    "state": state.value,
                    "last_heartbeat": datetime.utcnow()
                })
                board_info = await self.get_board(target_id)
                return board_info, False

            orm = BoardORM(
                id=board_id,
                name=name,
                ip_address=ip_address,
                mac_address=mac_address,
                firmware_version=firmware_version,
                model=model,
                tag=tag,
                connections=connections or [],
                state=state.value,
                last_heartbeat=datetime.utcnow()
            )
            session.add(orm)
            session.add(
                BoardStatusORM(
                    board_id=board_id,
                    state=state.value,
                    last_heartbeat=datetime.utcnow(),
                    cpu_temp=None,
                    cpu_load=None,
                    ram_usage=None,
                    current_job_id=None,
                )
            )
            await session.commit()
            status_orm = (await session.execute(select(BoardStatusORM).where(BoardStatusORM.board_id == board_id))).scalar_one_or_none()
            return self._orm_to_model(orm, status_orm), True

    async def update_board(self, board_id: str, updates: dict) -> Optional[BoardInfo]:
        async with async_session() as session:
            board_row = (await session.execute(select(BoardORM).where(BoardORM.id == board_id))).scalar_one_or_none()
            if not board_row:
                return None
            status_keys = {"state", "cpu_temp", "cpu_load", "ram_usage", "current_job_id", "last_heartbeat", "fpga_status", "arm_status"}
            board_updates = {k: v for k, v in updates.items() if k not in status_keys}
            status_updates = {k: v for k, v in updates.items() if k in status_keys}

            result = None
            if board_updates:
                result = await session.execute(
                    update(BoardORM).where(BoardORM.id == board_id).values(**board_updates)
                )
            if status_updates:
                status_row = (await session.execute(select(BoardStatusORM).where(BoardStatusORM.board_id == board_id))).scalar_one_or_none()
                if status_row:
                    await session.execute(update(BoardStatusORM).where(BoardStatusORM.board_id == board_id).values(**status_updates))
                else:
                    session.add(
                        BoardStatusORM(
                            board_id=board_id,
                            state=status_updates.get("state", board_row.state or BoardState.OFFLINE.value),
                            cpu_temp=status_updates.get("cpu_temp"),
                            cpu_load=status_updates.get("cpu_load"),
                            ram_usage=status_updates.get("ram_usage"),
                            current_job_id=status_updates.get("current_job_id"),
                            last_heartbeat=status_updates.get("last_heartbeat"),
                            fpga_status=status_updates.get("fpga_status"),
                            arm_status=status_updates.get("arm_status"),
                        )
                    )
            await session.commit()
            refreshed = await session.execute(select(BoardORM).where(BoardORM.id == board_id))
            orm = refreshed.scalar_one_or_none()
            s = (await session.execute(select(BoardStatusORM).where(BoardStatusORM.board_id == board_id))).scalar_one_or_none()
            return self._orm_to_model(orm, s) if orm else None

    async def delete_board(self, board_id: str) -> bool:
        """Delete a board and all its associated telemetry/status records."""
        async with async_session() as session:
            await session.execute(delete(BoardTelemetryLogORM).where(BoardTelemetryLogORM.board_id == board_id))
            await session.execute(delete(BoardStatusORM).where(BoardStatusORM.board_id == board_id))
            result = await session.execute(delete(BoardORM).where(BoardORM.id == board_id))
            await session.commit()
            return result.rowcount > 0

    async def delete_boards_bulk(self, board_ids: List[str]) -> int:
        """Delete multiple boards by ID list."""
        if not board_ids:
            return 0
        async with async_session() as session:
            await session.execute(delete(BoardTelemetryLogORM).where(BoardTelemetryLogORM.board_id.in_(board_ids)))
            await session.execute(delete(BoardStatusORM).where(BoardStatusORM.board_id.in_(board_ids)))
            result = await session.execute(delete(BoardORM).where(BoardORM.id.in_(board_ids)))
            await session.commit()
            return result.rowcount

    async def get_available_board(self, target_board_id: Optional[str] = None) -> Optional[BoardInfo]:
        """Get a free board. If target_board_id is specified, check if it's free."""
        boards = await self.get_all_boards()
        for b in boards:
            if target_board_id and b.id != target_board_id:
                continue
            if b.status.state == BoardState.ONLINE:
                return b
        return None

    async def update_heartbeat(
        self,
        board_id: str,
        ip: str,
        temp: float,
        cpu_load: Optional[float] = None,
        ram_usage: Optional[float] = None,
        fpga_status: Optional[str] = None,
        arm_status: Optional[str] = None,
    ) -> bool:
        """Process heartbeat from board."""
        import time
        # If the board was recently requested to reboot, ignore heartbeats for 35 seconds
        reboot_time = self._rebooting_boards.get(board_id)
        if reboot_time and (time.time() - reboot_time < 35):
            # Return True so the agent thinks it succeeded, but do not update status back to online in DB
            return True
            
        # Clear rebooting flag if we've passed the cooldown
        if board_id in self._rebooting_boards:
            del self._rebooting_boards[board_id]
            
        async with async_session() as session:
            values = {
                "ip_address": ip,
                "state": BoardState.ONLINE.value,
            }
            status_values = {
                "cpu_temp": temp,
                "last_heartbeat": datetime.utcnow(),
                "state": BoardState.ONLINE.value,
            }
            if cpu_load is not None:
                status_values["cpu_load"] = cpu_load
            if ram_usage is not None:
                status_values["ram_usage"] = ram_usage
            if fpga_status is not None:
                status_values["fpga_status"] = fpga_status
            if arm_status is not None:
                status_values["arm_status"] = arm_status
            result = await session.execute(
                update(BoardORM).where(BoardORM.id == board_id).values(**values)
            )
            status_row = (await session.execute(select(BoardStatusORM).where(BoardStatusORM.board_id == board_id))).scalar_one_or_none()
            if status_row:
                await session.execute(update(BoardStatusORM).where(BoardStatusORM.board_id == board_id).values(**status_values))
            else:
                session.add(BoardStatusORM(board_id=board_id, **status_values))
                
            # Log telemetry history
            log_entry = BoardTelemetryLogORM(
                board_id=board_id,
                cpu_temp=temp,
                cpu_load=cpu_load,
                ram_usage=ram_usage,
                fpga_status=fpga_status,
                arm_status=arm_status,
                recorded_at=datetime.utcnow()
            )
            session.add(log_entry)
            
            # Prune telemetry log: keep last 100 records
            # Find the recorded_at timestamp of the 100th record
            cutoff_q = (
                select(BoardTelemetryLogORM.recorded_at)
                .where(BoardTelemetryLogORM.board_id == board_id)
                .order_by(BoardTelemetryLogORM.recorded_at.desc())
                .offset(100)
                .limit(1)
            )
            cutoff_res = await session.execute(cutoff_q)
            cutoff = cutoff_res.scalar()
            if cutoff:
                await session.execute(
                    delete(BoardTelemetryLogORM)
                    .where(BoardTelemetryLogORM.board_id == board_id)
                    .where(BoardTelemetryLogORM.recorded_at <= cutoff)
                )
                
            await session.commit()
            return result.rowcount > 0


    async def set_board_busy(self, board_id: str, job_id: str) -> bool:
        """Mark a board as busy."""
        return await self.update_board(board_id, {
            "state": BoardState.BUSY.value,
            "current_job_id": job_id
        }) is not None

    async def set_board_idle(self, board_id: str) -> bool:
        """Mark a board as idle."""
        return await self.update_board(board_id, {
            "state": BoardState.ONLINE.value,
            "current_job_id": None
        }) is not None

    async def release_boards_holding_job(self, job_id: str) -> int:
        """Clear current_job_id for any board still tied to this job (e.g. after job delete)."""
        async with async_session() as session:
            result = await session.execute(
                update(BoardORM)
                .where(BoardORM.current_job_id == job_id)
                .values(state=BoardState.ONLINE.value, current_job_id=None)
            )
            await session.commit()
            return result.rowcount

    async def execute_job(
        self,
        board_id: str,
        *,
        job_id: str,
        result_id: str,
        fw_file_id: Optional[str],
        binary_file_id: Optional[str] = None,
        params: Optional[dict] = None,
    ) -> bool:
        """Dispatch a single test run to the board agent's /execute endpoint.

        The agent resolves the file IDs against its own backend base URL and runs
        download -> flash -> capture -> upload asynchronously, reporting completion
        back via POST /api/boards/{id}/measurements and the result upload.
        """
        board = await self.get_board(board_id)
        if not board or not board.ip_address:
            return False

        url = f"http://{board.ip_address}:{self.agent_port}/execute"
        body = {
            "job_id": job_id,
            "result_id": result_id,
            "fw_file_id": fw_file_id,
            "binary_file_id": binary_file_id,
            "params": params or {},
        }
        try:
            resp = await self.http_client.post(url, json=body)
            if resp.status_code not in (200, 202):
                print(f"Dispatch to {board_id} returned {resp.status_code}: {resp.text}")
                return False
            return bool(resp.json().get("accepted", False))
        except httpx.RequestError as e:
            print(f"Failed to dispatch job to {board_id}: {e}")
            return False

    async def reboot_board(self, board_id: str) -> bool:
        """Send reboot command to Agent via HTTP."""
        board = await self.get_board(board_id)
        if not board or not board.ip_address:
            return False
            
        url = f"http://{board.ip_address}:{self.agent_port}/system/reboot"
        try:
            resp = await self.http_client.post(url)
            if resp.status_code == 200:
                import time
                self._rebooting_boards[board_id] = time.time()
                return True
            return False
        except httpx.RequestError as e:
            print(f"Failed to reboot {board_id}: {e}")
            return False

    async def ping_board(self, board_id: str) -> bool:
        """Check direct connectivity to Agent."""
        board = await self.get_board(board_id)
        if not board or not board.ip_address:
            return False
            
        url = f"http://{board.ip_address}:{self.agent_port}/health"
        try:
            resp = await self.http_client.get(url)
            return resp.status_code == 200
        except httpx.RequestError:
            return False

    async def mark_stale_boards_offline(
        self,
        timeout_seconds: int = 60,
    ) -> int:
        """
        Background watchdog: mark boards offline if no heartbeat within timeout.

        Called periodically (every 30 s) from main.py lifespan.
        Only flips boards that are currently 'online' or 'busy' — avoids
        repeatedly touching boards already marked 'offline' or 'error'.

        Returns the number of boards flipped to offline.
        """
        cutoff = datetime.utcnow() - timedelta(seconds=timeout_seconds)
        async with async_session() as session:
            # Find board_status rows where state is online/busy AND last_heartbeat
            # is older than cutoff (or NULL which means never heard from).
            stale = (await session.execute(
                select(BoardStatusORM).where(
                    BoardStatusORM.state.in_(["online", "busy"]),
                    (BoardStatusORM.last_heartbeat == None) |  # noqa: E711
                    (BoardStatusORM.last_heartbeat < cutoff),
                )
            )).scalars().all()

            if not stale:
                return 0

            stale_ids = [row.board_id for row in stale]
            now = datetime.utcnow()

            # Update board_status table — also clear telemetry so stale
            # sensor values don't show alongside an "offline" state badge.
            await session.execute(
                update(BoardStatusORM)
                .where(BoardStatusORM.board_id.in_(stale_ids))
                .values(
                    state=BoardState.OFFLINE.value,
                    last_heartbeat=now,
                    cpu_temp=None,
                    cpu_load=None,
                    ram_usage=None,
                    fpga_status=None,
                    arm_status=None,
                )
            )
            # Keep boards table in sync
            await session.execute(
                update(BoardORM)
                .where(BoardORM.id.in_(stale_ids))
                .values(state=BoardState.OFFLINE.value)
            )
            await session.commit()

            for board_id in stale_ids:
                print(f"[watchdog] Board {board_id} marked offline (no heartbeat for >{timeout_seconds}s)")

            return len(stale_ids)

board_manager = BoardManager()
