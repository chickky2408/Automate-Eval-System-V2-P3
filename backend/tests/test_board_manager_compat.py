import unittest
from datetime import datetime

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import services.board_manager as board_manager_module
from db.database import Base
from db.orm_models import BoardORM, BoardStatusORM
from services.board_manager import BoardManager


class BoardManagerCompatTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)
        self.original_session = board_manager_module.async_session
        board_manager_module.async_session = self.sessionmaker
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self):
        board_manager_module.async_session = self.original_session
        await self.engine.dispose()

    async def test_get_all_boards_maps_legacy_board_metadata_without_attribute_errors(self):
        async with self.sessionmaker() as session:
            session.add(
                BoardORM(
                    id="board-1",
                    name="Board 1",
                    ip_address="192.168.1.10",
                    mac_address="AA:BB:CC:DD:EE:FF",
                    firmware_version="1.0",
                    model="Zybo",
                    tag="lab-a",
                    connections=["REST API"],
                    state="online",
                    last_heartbeat=datetime.utcnow(),
                )
            )
            session.add(
                BoardStatusORM(
                    board_id="board-1",
                    state="online",
                    cpu_temp=42.0,
                    cpu_load=0.2,
                    ram_usage=0.3,
                    last_heartbeat=datetime.utcnow(),
                )
            )
            await session.commit()

        boards = await BoardManager().get_all_boards()

        self.assertEqual(len(boards), 1)
        self.assertEqual(boards[0].tag, "lab-a")
        self.assertEqual(boards[0].status.cpu_temp, 42.0)
