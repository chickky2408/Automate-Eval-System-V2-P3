"""System health and status endpoints."""
from __future__ import annotations

from fastapi import APIRouter
from datetime import datetime
from typing import Optional
import os
import shutil

from services.board_manager import board_manager

router = APIRouter()


def _format_bytes(num_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    size = float(num_bytes)
    for unit in units:
        if size < 1024.0:
            return f"{size:.1f}{unit}"
        size /= 1024.0
    return f"{size:.1f}PB"


async def _get_storage_summary() -> dict:
    db_path = os.path.join(os.path.dirname(__file__), "..", "eval_system.db")
    disk_path = os.path.dirname(db_path)
    usage = shutil.disk_usage(disk_path)
    percentage = int((usage.used / usage.total) * 100) if usage.total else 0
    return {
        "usage": percentage,
        "total": _format_bytes(usage.total),
        "used": _format_bytes(usage.used),
        "percentage": percentage,
    }


def _seconds_since(dt: Optional[datetime]) -> Optional[float]:
    if dt is None:
        return None
    delta = datetime.utcnow() - dt
    return delta.total_seconds()


@router.get("/health")
async def get_system_health():
    boards = await board_manager.get_all_boards()
    total = len(boards)
    online = sum(1 for b in boards if b.status.state.value == "online")
    busy = sum(1 for b in boards if b.status.state.value == "busy")
    error = sum(1 for b in boards if b.status.state.value in {"error", "offline"})
    # Boards with no heartbeat in 60s (or never) = stale
    STALE_THRESHOLD_SEC = 60
    stale = sum(
        1
        for b in boards
        if _seconds_since(b.status.last_heartbeat) is None
        or _seconds_since(b.status.last_heartbeat) > STALE_THRESHOLD_SEC
    )
    storage = await _get_storage_summary()
    return {
        "totalBoards": total,
        "onlineBoards": online,
        "busyBoards": busy,
        "errorBoards": error,
        "staleBoards": stale,
        "storageUsage": storage["percentage"],
        "storageTotal": storage["total"],
        "storageUsed": storage["used"],
        "boardApiStatus": "online",
    }


@router.get("/storage")
async def get_storage_status():
    return await _get_storage_summary()


@router.get("/board-api/status")
async def get_board_api_status():
    return {
        "status": "online",
        "lastConnected": datetime.utcnow().isoformat() + "Z",
        "messageCount": 0,
    }
