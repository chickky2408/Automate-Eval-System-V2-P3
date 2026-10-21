"""
Waveform Sessions Router.

Manages Surfer WASM waveform inspection sessions.
Backed by SurferSessionManager — stateless, no process spawning.
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from services.surfer_session_manager import surfer_session_manager

router = APIRouter(prefix="/api/v1/waveform/sessions", tags=["Waveform Sessions"])


class CreateSessionRequest(BaseModel):
    result_id: str
    mode: str = "actual_only"  # "actual_only" | "dual_golden"
    dump_path: Optional[str] = None
    golden_path: Optional[str] = None
    digital_channels: Optional[List[str]] = None
    analog_channels: Optional[List[Dict[str, Any]]] = None


class SessionResponse(BaseModel):
    session_id: str
    result_id: str
    port: int
    display_num: int
    status: str
    embed_url: str
    fst_url: Optional[str] = None
    surfer_direct_url: Optional[str] = None


@router.post("", response_model=SessionResponse)
def create_session(req: CreateSessionRequest):
    dump_path = req.dump_path or f"/storage/waveforms/{req.result_id}.fst"
    try:
        session = surfer_session_manager.create_session(
            result_id=req.result_id,
            dump_path=dump_path,
            golden_path=req.golden_path,
            digital_channels=req.digital_channels,
            analog_channels=req.analog_channels,
            mode=req.mode,
        )
        return SessionResponse(
            session_id=session.session_id,
            result_id=session.result_id,
            port=session.port,
            display_num=session.display_num,
            status=session.status,
            embed_url=session.embed_url,
            fst_url=session.fst_url,
            surfer_direct_url=session.surfer_direct_url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/status")
def get_session_status(session_id: str):
    session = surfer_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    surfer_session_manager.heartbeat(session_id)
    return {
        "session_id": session.session_id,
        "result_id": session.result_id,
        "status": session.status,
        "port": session.port,
        "embed_url": session.embed_url,
        "fst_url": session.fst_url,
        "surfer_direct_url": session.surfer_direct_url,
    }


@router.delete("/{session_id}")
def delete_session(session_id: str):
    success = surfer_session_manager.terminate_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "session_id": session_id}


@router.get("/{session_id}/embed")
def embed_session(session_id: str):
    """
    Redirect browser to Surfer WASM app with the FST file URL pre-loaded.
    The Surfer WASM is served from /surfer/ (static files mounted in main.py).
    """
    session = surfer_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    surfer_session_manager.heartbeat(session_id)
    # 302 redirect → browser loads Surfer WASM directly
    return RedirectResponse(url=session.surfer_direct_url, status_code=302)

