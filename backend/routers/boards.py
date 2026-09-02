"""Board management API endpoints."""
from __future__ import annotations

import asyncio
import json
import os
import paramiko
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from typing import List, Optional
from datetime import datetime
import uuid

from pydantic import BaseModel

from sqlalchemy import select

from models.board import BoardInfo, BoardStatus, BoardState
from services.board_manager import board_manager
from db.database import async_session
from db.orm_models import ResultORM, BoardTelemetryLogORM

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
    if state == BoardState.OFFLINE:
        return "offline"
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
    is_degraded = status in ("error", "offline")
    is_offline  = status == "offline"
    return {
        "id": board.id,
        "name": board.name,
        "status": status,
        "ip": board.ip_address,
        "mac": board.mac_address,
        "firmware": board.firmware_version,
        "model": board.model or "Zybo",
        "voltage": 3.3,
        "signal": -80 if is_degraded else -45,
        "temp": board.status.cpu_temp,
        "currentJob": f"Batch #{board.status.current_job_id}" if board.status.current_job_id else None,
        "tag": board.tag,
        "connections": board.connections or [],
        # When offline: always show 'unknown'/'offline' — never show stale cached sensor values
        "fpgaStatus": "unknown" if is_offline else (board.status.fpga_status or "unknown"),
        "armStatus":  "offline" if is_offline else (board.status.arm_status or (status if status in ("online", "busy", "error") else "offline")),
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
    

@router.get("/{board_id}/telemetry")
async def get_board_telemetry(board_id: str):
    """Retrieve historical telemetry logs for a board."""
    async with async_session() as session:
        res = await session.execute(
            select(BoardTelemetryLogORM)
            .where(BoardTelemetryLogORM.board_id == board_id)
            .order_by(BoardTelemetryLogORM.recorded_at.asc())
        )
        logs = res.scalars().all()
        return [
            {
                "recorded_at": log.recorded_at.isoformat() + "Z" if log.recorded_at else None,
                "cpu_temp": log.cpu_temp,
                "cpu_load": log.cpu_load,
                "ram_usage": log.ram_usage,
                "fpga_status": log.fpga_status,
                "arm_status": log.arm_status,
            }
            for log in logs
        ]


@router.patch("/{board_id}")
@router.put("/{board_id}")
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


@router.delete("/{board_id}")
async def delete_board(board_id: str):
    """Delete a board from the fleet."""
    success = await board_manager.delete_board(board_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    return {"success": True, "message": f"Board {board_id} deleted"}


@router.get("/{board_id}/status", response_model=BoardStatus)
async def get_board_status(board_id: str):
    """Get real-time status of a board."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    return board.status


@router.post("/{board_id}/reboot")
async def reboot_board(board_id: str):
    """Request a board reboot."""
    success = await board_manager.reboot_board(board_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to reboot board")
        
    # Immediately mark the board as offline in the DB so the FE status changes instantly
    await board_manager.update_board(board_id, {
        "state": BoardState.OFFLINE.value,
        "cpu_temp": None,
        "cpu_load": None,
        "ram_usage": None,
        "fpga_status": None,
        "arm_status": "offline"
    })
    
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


class MeasurementsRequest(BaseModel):
    job_id: str
    result_id: str
    passed: bool = False
    error_message: Optional[str] = None
    duration_seconds: Optional[float] = None
    result_bytes: Optional[int] = None
    capture_source: Optional[str] = None
    metrics: Optional[dict] = None


@router.post("/{board_id}/measurements")
async def post_measurements(board_id: str, payload: MeasurementsRequest):
    """Called by the board agent when a test run finishes.

    Updates the matching ResultORM row (by result_id) so the job queue's waiter
    sees the run complete. The waveform file itself is uploaded separately via
    the chunked result receiver.
    """
    async with async_session() as session:
        run = (
            await session.execute(select(ResultORM).where(ResultORM.id == payload.result_id))
        ).scalar_one_or_none()
        if not run:
            raise HTTPException(status_code=404, detail=f"Result {payload.result_id} not found")

        run.status = "completed" if payload.passed else "error"
        run.passed = payload.passed
        run.error_message = payload.error_message
        if payload.duration_seconds is not None:
            run.duration_seconds = payload.duration_seconds
        metrics = dict(run.metrics_json or {})
        if payload.metrics:
            metrics.update(payload.metrics)
        if payload.result_bytes is not None:
            metrics["result_bytes"] = payload.result_bytes
        if payload.capture_source is not None:
            metrics["capture_source"] = payload.capture_source
        run.metrics_json = metrics
        run.completed_at = datetime.utcnow()
        await session.commit()

    return {"status": "ok", "result_id": payload.result_id}


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
    
    board = await board_manager.get_board(board_id)
    if not board:
        await websocket.send_text(f"\r\n[Error] Board {board_id} not found in database.\r\n")
        await websocket.close()
        return
        
    ip = board.ip_address
    if not ip:
        await websocket.send_text("\r\n[Error] Board IP address is not configured.\r\n")
        await websocket.close()
        return
        
    username = os.getenv("SSH_USERNAME", "petalinux")
    password = os.getenv("SSH_PASSWORD", "Sic1219!")
    port = int(os.getenv("SSH_PORT", "22"))
    
    await websocket.send_text(f"Connecting to SSH daemon at {ip}:{port} as user '{username}'...\r\n")
    
    ssh_client = paramiko.SSHClient()
    ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    channel = None
    
    try:
        # Run blocking connect in a threadpool
        await asyncio.to_thread(
            ssh_client.connect,
            hostname=ip,
            port=port,
            username=username,
            password=password,
            timeout=10
        )
        
        # Configure keepalive every 10 seconds to maintain stable tunnel
        transport = ssh_client.get_transport()
        if transport:
            transport.set_keepalive(10)
            
        # Invoke an interactive shell session (default terminal size is 80x24)
        channel = ssh_client.invoke_shell(term="xterm", width=80, height=24)
    except Exception as e:
        await websocket.send_text(f"\r\n[Error] Failed to connect to board via SSH: {e}\r\n")
        ssh_client.close()
        try:
            await websocket.close()
        except Exception:
            pass
        return

    # Task to forward WS input -> SSH channel
    async def ws_to_ssh_loop():
        try:
            while True:
                message = await websocket.receive_text()
                try:
                    payload = json.loads(message)
                    if isinstance(payload, dict):
                        action = payload.get("action")
                        if action == "resize":
                            cols = int(payload.get("cols", 80))
                            rows = int(payload.get("rows", 24))
                            channel.resize_pty(width=cols, height=rows)
                            continue
                        elif action == "data":
                            data = payload.get("data", "")
                            if data:
                                b_data = data.encode("utf-8") if isinstance(data, str) else data
                                channel.sendall(b_data)
                            continue
                except (json.JSONDecodeError, ValueError):
                    pass
                
                # Raw fallback
                b_msg = message.encode("utf-8") if isinstance(message, str) else message
                channel.sendall(b_msg)
        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[SSH Proxy] Error in WS->SSH loop: {e}")
        finally:
            if channel:
                channel.close()

    ws_task = asyncio.create_task(ws_to_ssh_loop())
    
    # Incremental UTF-8 decoder to prevent cutting off multi-byte characters (Thai/ANSI escape codes)
    import codecs
    decoder = codecs.getincrementaldecoder('utf-8')(errors='ignore')
    
    try:
        # Read from SSH channel and send to WebSocket
        while True:
            # channel.recv blocks, so run it in a threadpool
            data = await asyncio.to_thread(channel.recv, 4096)
            if not data:
                # Channel closed
                break
            text = decoder.decode(data)
            if text:
                await websocket.send_text(text)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[SSH Proxy] Error in SSH->WS loop: {e}")
    finally:
        ws_task.cancel()
        if channel:
            channel.close()
        ssh_client.close()
        try:
            await websocket.close()
        except Exception:
            pass
