"""
Seed default demo boards when the boards table is empty (local dev / first run).
Idempotent: skips entirely if at least one board already exists.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select

from db.database import async_session
from db.orm_models import BoardORM

# Aligns with Fleet Manager mockup: mixed online / busy / error / offline
_DEFAULT_BOARDS: list[dict] = [
    {
        "id": "BOARD-1",
        "name": "#BOARD-1",
        "ip_address": "192.168.0.10",
        "mac_address": "00:11:22:33:44:01",
        "firmware_version": "v1.0.0",
        "model": "Zybo",
        "tag": "paused",
        "connections": [],
        "state": "online",
        "cpu_temp": 41.2,
        "cpu_load": 12.0,
        "ram_usage": 38.0,
        "current_job_id": None,
        "fpga_status": "unknown",
        "arm_status": "online",
    },
    {
        "id": "BOARD-2",
        "name": "#BOARD-2",
        "ip_address": "192.168.0.11",
        "mac_address": "00:11:22:33:44:02",
        "firmware_version": "v1.0.0",
        "model": "Zybo",
        "tag": "line-a",
        "connections": [],
        "state": "online",
        "cpu_temp": 39.5,
        "cpu_load": 8.0,
        "ram_usage": 35.0,
        "current_job_id": None,
        "fpga_status": "active",
        "arm_status": "online",
    },
    {
        "id": "BOARD-3",
        "name": "#BOARD-3",
        "ip_address": "192.168.0.12",
        "mac_address": "00:11:22:33:44:03",
        "firmware_version": "v1.1.0",
        "model": "Zybo",
        "tag": "burn-in",
        "connections": [],
        "state": "busy",
        "cpu_temp": 48.0,
        "cpu_load": 72.0,
        "ram_usage": 61.0,
        "current_job_id": "123",
        "fpga_status": "active",
        "arm_status": "busy",
    },
    {
        "id": "BOARD-4",
        "name": "#BOARD-4",
        "ip_address": "192.168.0.13",
        "mac_address": "00:11:22:33:44:04",
        "firmware_version": "v1.1.0",
        "model": "Zybo",
        "tag": "running",
        "connections": [],
        "state": "busy",
        "cpu_temp": 46.3,
        "cpu_load": 65.0,
        "ram_usage": 58.0,
        "current_job_id": "set-02",
        "fpga_status": "active",
        "arm_status": "busy",
    },
    {
        "id": "BOARD-ERR",
        "name": "#BOARD-ERR",
        "ip_address": "192.168.0.14",
        "mac_address": "00:11:22:33:44:05",
        "firmware_version": "v1.0.0",
        "model": "Zybo",
        "tag": "error",
        "connections": [],
        "state": "error",
        "cpu_temp": None,
        "cpu_load": None,
        "ram_usage": None,
        "current_job_id": None,
        "fpga_status": "error",
        "arm_status": "offline",
    },
    {
        "id": "BOARD-OFF",
        "name": "#BOARD-OFF",
        "ip_address": "192.168.0.15",
        "mac_address": "00:11:22:33:44:06",
        "firmware_version": "v1.0.0",
        "model": "Zybo",
        "tag": "maintenance",
        "connections": [],
        "state": "offline",
        "cpu_temp": None,
        "cpu_load": None,
        "ram_usage": None,
        "current_job_id": None,
        "fpga_status": "idle",
        "arm_status": "offline",
    },
]


async def seed_demo_boards_if_empty() -> int:
    """Insert default boards when the table has no rows. Returns number of rows inserted."""
    async with async_session() as session:
        result = await session.execute(select(func.count()).select_from(BoardORM))
        count = int(result.scalar_one() or 0)
        if count > 0:
            return 0

        now = datetime.utcnow()
        for row in _DEFAULT_BOARDS:
            session.add(
                BoardORM(
                    id=row["id"],
                    name=row["name"],
                    ip_address=row["ip_address"],
                    mac_address=row["mac_address"],
                    firmware_version=row["firmware_version"],
                    model=row["model"],
                    tag=row["tag"],
                    connections=row["connections"],
                    state=row["state"],
                    cpu_temp=row["cpu_temp"],
                    cpu_load=row["cpu_load"],
                    ram_usage=row["ram_usage"],
                    current_job_id=row["current_job_id"],
                    last_heartbeat=now if row["state"] in ("online", "busy") else None,
                    fpga_status=row["fpga_status"],
                    arm_status=row["arm_status"],
                )
            )
        await session.commit()
        return len(_DEFAULT_BOARDS)
