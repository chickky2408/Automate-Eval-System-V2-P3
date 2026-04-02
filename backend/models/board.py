"""Board-related Pydantic models."""
from pydantic import BaseModel
from enum import Enum
from typing import Optional, List
from datetime import datetime


class BoardState(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    BUSY = "busy"
    ERROR = "error"


class BoardStatus(BaseModel):
    """Real-time status of a board."""
    state: BoardState
    cpu_temp: Optional[float] = None
    cpu_load: Optional[float] = None
    ram_usage: Optional[float] = None
    current_job_id: Optional[str] = None
    last_heartbeat: Optional[datetime] = None
    fpga_status: Optional[str] = None  # 'active' | 'idle' | 'error' | 'unknown'
    arm_status: Optional[str] = None    # 'online' | 'busy' | 'error' | 'unknown'


class BoardInfo(BaseModel):
    """Full board information."""
    id: str
    name: str
    ip_address: str
    mac_address: Optional[str] = None
    firmware_version: Optional[str] = None
    model: Optional[str] = None
    tag: Optional[str] = None
    connections: Optional[List[str]] = None
    status: BoardStatus

    class Config:
        from_attributes = True
