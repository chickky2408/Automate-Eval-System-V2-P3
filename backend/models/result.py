"""Result-related Pydantic models."""
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class WaveformChannel(BaseModel):
    """Single waveform channel data."""
    name: str
    color: str
    data: List[Dict[str, Any]]  # [{time: float, value: int}, ...]


class WaveformData(BaseModel):
    """Waveform data for visualization."""
    channels: List[WaveformChannel]
    time_unit: str = "us"
    total_duration: float


class TestResult(BaseModel):
    """Test execution result."""
    id: str
    job_id: str
    job_name: str
    board_id: str
    board_name: str
    passed: bool
    started_at: datetime
    completed_at: datetime
    duration_seconds: float
    vcd_filename: str
    firmware_filename: Optional[str] = None
    error_message: Optional[str] = None
    packet_count: int = 0
    crc_errors: int = 0
    console_log: Optional[str] = None
    waveform_available: bool = False

    class Config:
        from_attributes = True
