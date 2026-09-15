"""Result-related Pydantic models."""
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class WaveformChannel(BaseModel):
    """Single waveform channel data."""
    name: str
    color: str
    data: List[Any]  # [float, ...] or [{time: float, value: int}, ...]


class WaveformData(BaseModel):
    """Waveform data for visualization."""
    channels: List[WaveformChannel]
    time_unit: str = "us"
    total_duration: float
    sample_rate_hz: Optional[float] = 4000.0


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
    vcd_file_id: Optional[str] = None
    firmware_file_id: Optional[str] = None
    vcd_filename: str
    firmware_filename: Optional[str] = None
    error_message: Optional[str] = None
    packet_count: int = 0
    crc_errors: int = 0
    console_log: Optional[str] = None
    waveform_available: bool = False
    waveform_filename: Optional[str] = None
    f1_score: Optional[float] = None
    sample_xor_score: Optional[float] = None
    majority_score: Optional[float] = None
    verification_status: Optional[str] = None

    class Config:
        from_attributes = True
