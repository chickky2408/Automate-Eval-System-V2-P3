"""
Agent API Router
Endpoints for Zybo Boards to communicate with the Backend.
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel
from typing import Optional, List
from services.board_manager import board_manager
from models.board import BoardState

router = APIRouter()

class BoardRegisterRequest(BaseModel):
    board_id: str
    name: Optional[str] = None
    mac_address: Optional[str] = None
    firmware_version: Optional[str] = None
    model: Optional[str] = None
    tag: Optional[str] = None
    
class HeartbeatRequest(BaseModel):
    board_id: str
    cpu_temp: float
    cpu_load: float
    ram_usage: float
    status: str  # "IDLE", "BUSY", "ERROR"
    fpga_status: Optional[str] = None  # "active" | "idle" | "error" | "unknown"
    arm_status: Optional[str] = None   # "online" | "busy" | "error" | "unknown"


@router.post("/register")
async def register_board(payload: BoardRegisterRequest, request: Request):
    """
    Called by Agent on boot.
    Registers the board and captures its IP address from the request.
    """
    client_ip = request.client.host
    
    board = await board_manager.create_board(
        board_id=payload.board_id,
        name=payload.name or payload.board_id,
        ip_address=client_ip,
        mac_address=payload.mac_address,
        firmware_version=payload.firmware_version,
        model=payload.model,
        tag=payload.tag,
        connections=[],
        state=BoardState.ONLINE
    )
    return {"status": "registered", "ip": client_ip}

@router.post("/heartbeat")
async def heartbeat(payload: HeartbeatRequest, request: Request):
    """
    Periodic heartbeat from Agent.
    Updates status and IP (in case of DHCP change).
    """
    client_ip = request.client.host
    
    success = await board_manager.update_heartbeat(
        board_id=payload.board_id,
        ip=client_ip,
        temp=payload.cpu_temp,
        fpga_status=payload.fpga_status,
        arm_status=payload.arm_status,
    )
    
    if not success:
        # Auto-register if not found? Or return 404 to force re-register
        raise HTTPException(status_code=404, detail="Board not registered")
        
    return {"status": "ok"}
