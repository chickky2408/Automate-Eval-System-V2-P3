"""
Agent API Router
Endpoints for Zybo Boards to communicate with the Backend.
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel
from typing import Optional, List
from services.board_manager import board_manager
from services.pending_job_dispatcher import pending_job_dispatcher
from services.notification_store import notification_store
from models.board import BoardState

router = APIRouter()

class BoardRegisterRequest(BaseModel):
    board_id: str
    name: Optional[str] = None
    mac_address: Optional[str] = None
    firmware_version: Optional[str] = None
    model: Optional[str] = None
    tag: Optional[str] = None
    ip_address: Optional[str] = None
    
class HeartbeatRequest(BaseModel):
    board_id: str
    cpu_temp: float
    cpu_load: float
    ram_usage: float
    status: str  # "IDLE", "BUSY", "ERROR"
    fpga_status: Optional[str] = None  # "active" | "idle" | "error" | "unknown"
    arm_status: Optional[str] = None   # "online" | "busy" | "error" | "unknown"
    ip_address: Optional[str] = None


@router.post("/register")
async def register_board(payload: BoardRegisterRequest, request: Request):
    """
    Called by Agent on boot.
    Registers the board, saves notification and captures its IP address from the request.
    """
    client_ip = payload.ip_address or request.client.host
    board_name = payload.name or payload.board_id
    
    board, is_new = await board_manager.create_board(
        board_id=payload.board_id,
        name=board_name,
        ip_address=client_ip,
        mac_address=payload.mac_address,
        firmware_version=payload.firmware_version,
        model=payload.model,
        tag=payload.tag,
        connections=[],
        state=BoardState.ONLINE
    )
    
    if is_new:
        try:
            await notification_store.add_notification(
                title="New Board Registered",
                message=f"FPGA Board '{board_name}' ({client_ip}) registered and is now Online.",
                notif_type="success"
            )
        except Exception as exc:
            pass

    return {"status": "registered", "ip": client_ip, "is_new": is_new}

@router.post("/heartbeat")
async def heartbeat(payload: HeartbeatRequest, request: Request, background_tasks: BackgroundTasks):
    """
    Periodic heartbeat from Agent.
    Updates status and IP (in case of DHCP change).
    When board reports IDLE status, trigger pending_job_dispatcher immediately
    so waiting jobs don't have to wait for the next poll cycle.
    """
    client_ip = payload.ip_address or request.client.host
    
    success = await board_manager.update_heartbeat(
        board_id=payload.board_id,
        ip=client_ip,
        temp=payload.cpu_temp,
        cpu_load=payload.cpu_load,
        ram_usage=payload.ram_usage,
        fpga_status=payload.fpga_status,
        arm_status=payload.arm_status,
    )
    
    if not success:
        # Auto-register board on heartbeat if not registered yet (Zero-Config Plug & Play)
        await board_manager.create_board(
            board_id=payload.board_id,
            name=payload.board_id,
            ip_address=client_ip,
            mac_address=None,
            firmware_version="v2.1.0",
            model="KR260",
            tag=None,
            connections=["REST API", "SSH"],
            state=BoardState.ONLINE
        )
        await board_manager.update_heartbeat(
            board_id=payload.board_id,
            ip=client_ip,
            temp=payload.cpu_temp,
            cpu_load=payload.cpu_load,
            ram_usage=payload.ram_usage,
            fpga_status=payload.fpga_status,
            arm_status=payload.arm_status,
        )

    # เมื่อบอร์ดรายงานตัวว่าว่าง (IDLE) → ให้ dispatcher ตรวจ pending jobs ทันที
    # ใช้ background_tasks เพื่อไม่บล็อก response ให้ agent
    if (payload.status or "").upper() in {"IDLE", "ONLINE", "OK"}:
        background_tasks.add_task(pending_job_dispatcher.trigger_now)
        
    return {"status": "ok"}
