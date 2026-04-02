"""Board management API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from typing import List, Optional
from datetime import datetime
import uuid

from pydantic import BaseModel

from models.board import BoardInfo, BoardStatus, BoardState
from services.board_manager import board_manager

router = APIRouter()


class BatchActionRequest(BaseModel):
    boardIds: List[str]
    action: str
    firmwareVersion: Optional[str] = None


class BoardCreateRequest(BaseModel):
    name: str
    status: Optional[str] = "online"
    ip: Optional[str] = ""
    mac: Optional[str] = None
    firmware: Optional[str] = None
    model: Optional[str] = None
    tag: Optional[str] = None
    connections: Optional[List[str]] = None


class BoardUpdateRequest(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    ip: Optional[str] = None
    mac: Optional[str] = None
    firmware: Optional[str] = None
    model: Optional[str] = None
    tag: Optional[str] = None
    connections: Optional[List[str]] = None


def _map_board_state(state: BoardState) -> str:
    if state == BoardState.ONLINE:
        return "online"
    if state == BoardState.BUSY:
        return "busy"
    return "error"


def _parse_board_state(status: Optional[str]) -> BoardState:
    if status == "online":
        return BoardState.ONLINE
    if status == "busy":
        return BoardState.BUSY
    if status == "error":
        return BoardState.ERROR
    return BoardState.OFFLINE


def _board_to_fe(board: BoardInfo) -> dict:
    status = _map_board_state(board.status.state)
    last_hb = board.status.last_heartbeat
    last_heartbeat_iso = last_hb.isoformat() + "Z" if last_hb else None
    return {
        "id": board.id,
        "name": board.name,
        "status": status,
        "ip": board.ip_address,
        "mac": board.mac_address,
        "firmware": board.firmware_version,
        "model": board.model or "Zybo",
        "voltage": 3.3,
        "signal": -45 if status != "error" else -80,
        "temp": board.status.cpu_temp,
        "currentJob": f"Batch #{board.status.current_job_id}" if board.status.current_job_id else None,
        "tag": board.tag,
        "connections": board.connections or [],
        "fpgaStatus": board.status.fpga_status or "unknown",
        "armStatus": board.status.arm_status or (status if status in ("online", "busy", "error") else "unknown"),
        "lastHeartbeat": last_heartbeat_iso,
    }


@router.get("")
async def list_boards(
    status: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    firmware: Optional[str] = Query(None),
):
    """Get all registered boards and their status."""
    boards = await board_manager.get_all_boards()
    payload = [_board_to_fe(b) for b in boards]
    if status:
        payload = [b for b in payload if b["status"] == status]
    if model:
        payload = [b for b in payload if (b["model"] or "").lower() == model.lower()]
    if firmware:
        payload = [b for b in payload if (b["firmware"] or "").lower() == firmware.lower()]
    return payload


@router.post("")
async def create_board(payload: BoardCreateRequest):
    board_id = f"board-{uuid.uuid4().hex[:8]}"
    state = _parse_board_state(payload.status)
    board = await board_manager.create_board(
        board_id=board_id,
        name=payload.name or board_id,
        ip_address=payload.ip or "",
        mac_address=payload.mac,
        firmware_version=payload.firmware,
        model=payload.model,
        tag=payload.tag,
        connections=payload.connections or [],
        state=state,
    )
    return _board_to_fe(board)


@router.get("/{board_id}")
async def get_board(board_id: str):
    """Get a specific board's information."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    return _board_to_fe(board)


@router.patch("/{board_id}")
async def update_board(board_id: str, payload: BoardUpdateRequest):
    updates = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.ip is not None:
        updates["ip_address"] = payload.ip
    if payload.mac is not None:
        updates["mac_address"] = payload.mac
    if payload.firmware is not None:
        updates["firmware_version"] = payload.firmware
    if payload.model is not None:
        updates["model"] = payload.model
    if payload.tag is not None:
        updates["tag"] = payload.tag
    if payload.connections is not None:
        updates["connections"] = payload.connections
    if payload.status is not None:
        updates["state"] = _parse_board_state(payload.status).value

    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    updated = await board_manager.update_board(board_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    return _board_to_fe(updated)


@router.get("/{board_id}/status", response_model=BoardStatus)
async def get_board_status(board_id: str):
    """Get real-time status of a board."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    return board.status


@router.get("/{board_id}/telemetry")
async def get_board_telemetry(board_id: str):
    """Get board telemetry data."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    return {
        "voltage": 3.3,
        "signal": -45,
        "temp": board.status.cpu_temp or 0.0,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.post("/{board_id}/reboot")
async def reboot_board(board_id: str):
    """Request a board reboot."""
    success = await board_manager.reboot_board(board_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to reboot board")
    return {"success": True, "message": "Board reboot initiated"}


@router.post("/{board_id}/firmware")
async def update_firmware(
    board_id: str,
    firmwareVersion: str = Form(...),
    firmwareFile: UploadFile = File(...),
):
    """Update board firmware (mock)."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    await board_manager.update_board(board_id, {"firmware_version": firmwareVersion})
    if firmwareFile:
        await firmwareFile.read()
    return {"success": True, "message": "Firmware update initiated"}


@router.post("/{board_id}/self-test")
async def self_test(board_id: str):
    """Run self-test on board (mock)."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    return {
        "success": True,
        "results": {"voltage": "pass", "signal": "pass", "temperature": "pass"},
    }


@router.post("/batch")
async def batch_action(request: BatchActionRequest):
    results = []
    for board_id in request.boardIds:
        if request.action == "reboot":
            success = await board_manager.reboot_board(board_id)
        elif request.action == "updateFirmware":
            board = await board_manager.get_board(board_id)
            success = board is not None
            if board and request.firmwareVersion:
                board.firmware_version = request.firmwareVersion
        elif request.action == "selfTest":
            success = True
        elif request.action == "delete":
            success = await board_manager.delete_board(board_id)
        else:
            success = False
        results.append({"boardId": board_id, "success": bool(success)})
    return {"success": True, "results": results}


@router.post("/{board_id}/pause-queue")
async def pause_board_queue(board_id: str):
    """Pause queue for a specific board."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    
    # Set board to a "paused" state (or use tag)
    updated = await board_manager.update_board(board_id, {"tag": "paused"})
    if not updated:
        raise HTTPException(status_code=400, detail="Failed to pause board queue")
    
    return {"success": True, "message": f"Queue paused for board {board_id}"}


@router.post("/{board_id}/resume-queue")
async def resume_board_queue(board_id: str):
    """Resume queue for a specific board."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    
    # Remove "paused" tag
    updated = await board_manager.update_board(board_id, {"tag": None})
    if not updated:
        raise HTTPException(status_code=400, detail="Failed to resume board queue")
    
    return {"success": True, "message": f"Queue resumed for board {board_id}"}


@router.post("/{board_id}/shutdown")
async def shutdown_board(board_id: str):
    """Shutdown a board."""
    success = await board_manager.reboot_board(board_id)  # Use reboot for now
    if not success:
        raise HTTPException(status_code=400, detail="Failed to shutdown board")
    
    return {"success": True, "message": f"Board {board_id} shutdown initiated"}


@router.delete("/{board_id}")
async def delete_board(board_id: str):
    success = await board_manager.delete_board(board_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    return {"success": True}


@router.post("/{board_id}/ping")
async def ping_board(board_id: str):
    """Ping a board to check connectivity."""
    result = await board_manager.ping_board(board_id)
    return {"board_id": board_id, "reachable": result}


@router.websocket("/{board_id}/ssh/connect")
async def board_ssh_connect(websocket: WebSocket, board_id: str):
    await websocket.accept()
    await websocket.send_text(f"Connected to {board_id}")
    try:
        while True:
            message = await websocket.receive_text()
            await websocket.send_text(f"echo: {message}")
    except WebSocketDisconnect:
        return
