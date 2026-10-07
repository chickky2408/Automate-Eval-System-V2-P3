"""
Waveform Sessions Router.

Manages Broadway GTKWave interactive waveform inspection sessions.
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from services.broadway_session_manager import broadway_session_manager

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


@router.post("", response_model=SessionResponse)
def create_session(req: CreateSessionRequest):
    dump_path = req.dump_path or f"/storage/waveforms/{req.result_id}.fst"
    try:
        session = broadway_session_manager.create_session(
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
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/status")
def get_session_status(session_id: str):
    session = broadway_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    broadway_session_manager.heartbeat(session_id)
    return {
        "session_id": session.session_id,
        "result_id": session.result_id,
        "status": session.status,
        "port": session.port,
        "embed_url": session.embed_url,
    }


@router.delete("/{session_id}")
def delete_session(session_id: str):
    success = broadway_session_manager.terminate_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "session_id": session_id}


@router.get("/{session_id}/embed", response_class=HTMLResponse)
def embed_session(session_id: str):
    session = broadway_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # HTML template embedding Broadway HTML5 client or iframe
    html = f"""<!DOCTYPE html>
<html>
<head>
    <title>GTKWave Broadway - {session.result_id}</title>
    <style>
        body, html, iframe {{ margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #111; }}
    </style>
</head>
<body>
    <iframe src="http://localhost:{session.port}" frameborder="0"></iframe>
</body>
</html>"""
    return HTMLResponse(content=html)
