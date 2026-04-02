"""WebSocket endpoints for real-time updates."""
from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from datetime import datetime
import asyncio

from services.board_manager import board_manager
from services.job_queue import job_queue_service
from routers.jobs import _build_fe_job

router = APIRouter()

# --- Waveform: Node (Pico) ส่งข้อมูลมา → Backend broadcast ไปยัง frontend ---
# Frontend clients ที่เชื่อมต่อ /ws/waveform จะได้รับ chunk ที่ Node POST มา
_waveform_ws_clients: list[WebSocket] = []


class WaveformChannel(BaseModel):
    """Single waveform channel in a chunk."""
    id: str
    samples: list[float]


class WaveformChunkBody(BaseModel):
    """
    Body ที่ Node (Pico) ส่งมา POST /api/waveform/chunk

    เพื่อรองรับทั้ง single-channel (ของเดิม) และ multi-channel:
    - ถ้ามี channels → ใช้ตามนั้น
    - ถ้ามี samples อย่างเดียว → map เป็น channels=[{"id": "CH1", "samples": samples}]
    """
    samples: list[float] | None = None
    channels: list[WaveformChannel] | None = None
    fs: int = 4000
    freq_hz: int = 125_000
    index: int | None = None


@router.websocket("/ws/system")
async def ws_system(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            boards = await board_manager.get_all_boards()
            payload = {
                "type": "system_health",
                "data": {
                    "totalBoards": len(boards),
                    "onlineBoards": sum(1 for b in boards if b.status.state.value == "online"),
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                },
            }
            await websocket.send_json(payload)
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        return


@router.websocket("/ws/boards")
async def ws_boards(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            boards = await board_manager.get_all_boards()
            for board in boards:
                await websocket.send_json(
                    {
                        "type": "board_update",
                        "data": {
                            "id": board.id,
                            "status": board.status.state.value,
                            "voltage": 3.3,
                        },
                    }
                )
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        return


@router.websocket("/ws/jobs")
async def ws_jobs(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            jobs = await job_queue_service.get_all_jobs()
            for job in jobs:
                fe_job = await _build_fe_job(job)
                await websocket.send_json(
                    {
                        "type": "job_progress",
                        "data": {
                            "jobId": fe_job["id"],
                            "progress": fe_job["progress"],
                            "completedFiles": fe_job["completedFiles"],
                        },
                    }
                )
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        return


@router.post("/api/waveform/chunk")
async def waveform_chunk(body: WaveformChunkBody):



    """
    Node  ส่ง chunk waveform มาที่ endpoint นี้ Backend จะ broadcast ไปยัง frontend
    ทุก client ที่เชื่อมต่อ /ws/waveform จะได้รับข้อมูล realtime
    """


    # Normalize to a list of WaveformChannel objects
    channels: list[WaveformChannel]
    if body.channels:
        channels = body.channels
    elif body.samples is not None:
        channels = [WaveformChannel(id="CH1", samples=body.samples)]
    else:
        channels = []

    payload = {
        "type": "waveform",
        "data": {
            "channels": [ch.dict() for ch in channels],
            "fs": body.fs,
            "freq_hz": body.freq_hz,
            "index": body.index,
        },
    }

    # print(payload["data"]["index"])


    dead = []
    for ws in _waveform_ws_clients:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in _waveform_ws_clients:
            _waveform_ws_clients.remove(ws)
    return {"ok": True, "clients": len(_waveform_ws_clients)}



@router.websocket("/ws/waveform")
async def ws_waveform(websocket: WebSocket):


    """
    Frontend เชื่อมต่อเพื่อรับ waveform realtime ที่ Node ส่งมา
    Flow: Node POST /api/waveform/chunk → Backend broadcast →  frontend รับที่นี่
    """


    await websocket.accept()
    _waveform_ws_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in _waveform_ws_clients:
            _waveform_ws_clients.remove(websocket)
