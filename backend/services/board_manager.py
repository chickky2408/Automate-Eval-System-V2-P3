"""
Board Manager Service
Handles discovery, status tracking, and control of boards.
Communicates with Zybo Agent via HTTP.
"""
from typing import List, Optional
import asyncio
import httpx
from datetime import datetime

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from models.board import BoardInfo, BoardStatus, BoardState
from db.database import async_session
from db.orm_models import BoardORM

class BoardManager:
    """Manages the fleet of Zybo boards."""

    def __init__(self):
        self.agent_port = 8000
        self.http_client = httpx.AsyncClient(timeout=5.0)

    def _orm_to_model(self, orm: BoardORM) -> BoardInfo:
        """Convert ORM object to BoardInfo."""
        try:
            state = BoardState(orm.state)
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
                cpu_temp=orm.cpu_temp,
                cpu_load=orm.cpu_load,
                ram_usage=orm.ram_usage,
                current_job_id=orm.current_job_id,
                last_heartbeat=orm.last_heartbeat,
                fpga_status=getattr(orm, 'fpga_status', None),
                arm_status=getattr(orm, 'arm_status', None),
            ),
        )

    async def get_all_boards(self) -> List[BoardInfo]:
        """Get all registered boards."""
        async with async_session() as session:
            result = await session.execute(select(BoardORM))
            boards = result.scalars().all()
            return [self._orm_to_model(b) for b in boards]

    async def get_board(self, board_id: str) -> Optional[BoardInfo]:
        """Get a specific board by ID."""
        async with async_session() as session:
            result = await session.execute(select(BoardORM).where(BoardORM.id == board_id))
            board = result.scalar_one_or_none()
            return self._orm_to_model(board) if board else None

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
    ) -> BoardInfo:
        async with async_session() as session:
            # Check if exists
            existing = await session.execute(select(BoardORM).where(BoardORM.id == board_id))
            if existing.scalar_one_or_none():
                # Update existing
                await self.update_board(board_id, {
                    "ip_address": ip_address,
                    "mac_address": mac_address,
                    "state": state.value,
                    "last_heartbeat": datetime.utcnow()
                })
                return await self.get_board(board_id)

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
            await session.commit()
            return self._orm_to_model(orm)

    async def update_board(self, board_id: str, updates: dict) -> Optional[BoardInfo]:
        async with async_session() as session:
            result = await session.execute(
                update(BoardORM).where(BoardORM.id == board_id).values(**updates)
            )
            await session.commit()
            if result.rowcount <= 0:
                return None
            refreshed = await session.execute(select(BoardORM).where(BoardORM.id == board_id))
            orm = refreshed.scalar_one_or_none()
            return self._orm_to_model(orm) if orm else None

    async def delete_board(self, board_id: str) -> bool:
        async with async_session() as session:
            result = await session.execute(delete(BoardORM).where(BoardORM.id == board_id))
            await session.commit()
            return result.rowcount > 0

    async def get_available_board(self, target_board_id: Optional[str] = None) -> Optional[BoardInfo]:
        """Get a free board. If target_board_id is specified, check if it's free."""
        async with async_session() as session:
            query = select(BoardORM).where(BoardORM.state == BoardState.ONLINE.value)
            
            if target_board_id:
                query = query.where(BoardORM.id == target_board_id)
            
            result = await session.execute(query.limit(1))
            board = result.scalar_one_or_none()
            return self._orm_to_model(board) if board else None

    async def update_heartbeat(
        self,
        board_id: str,
        ip: str,
        temp: float,
        fpga_status: Optional[str] = None,
        arm_status: Optional[str] = None,
    ) -> bool:
        """Process heartbeat from board."""
        async with async_session() as session:
            values = {
                "ip_address": ip,
                "cpu_temp": temp,
                "last_heartbeat": datetime.utcnow(),
                "state": BoardState.ONLINE.value,
            }
            if fpga_status is not None:
                values["fpga_status"] = fpga_status
            if arm_status is not None:
                values["arm_status"] = arm_status
            result = await session.execute(
                update(BoardORM).where(BoardORM.id == board_id).values(**values)
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

    async def reboot_board(self, board_id: str) -> bool:
        """Send reboot command to Agent via HTTP."""
        board = await self.get_board(board_id)
        if not board or not board.ip_address:
            return False
            
        url = f"http://{board.ip_address}:{self.agent_port}/system/reboot"
        try:
            resp = await self.http_client.post(url)
            return resp.status_code == 200
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

board_manager = BoardManager()
