"""
SQLAlchemy ORM Models for database tables (Redesigned).
"""
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Text, JSON, Enum as SAEnum, ForeignKey, BigInteger
from datetime import datetime
from db.database import Base
import enum
import uuid

class FileType(str, enum.Enum):
    VCD = "VCD"
    EROM = "EROM"
    ULP = "ULP"
    TXT = "TXT"
    FIRMWARE = "FIRMWARE"  # legacy compatibility
    SCRIPT = "SCRIPT"
    LOG = "LOG"
    WAVEFORM = "WAVEFORM"
    REPORT = "REPORT"
    OTHER = "OTHER"

class FileORM(Base):
    """File registry table."""
    __tablename__ = "files"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String(255), nullable=False)
    file_type = Column(SAEnum(FileType), nullable=False)
    storage_path = Column(String(512), nullable=False) # Store relative path under base_path
    checksum_sha256 = Column(String(64), nullable=True)
    size_bytes = Column(BigInteger, default=0)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    owner_id = Column(String(36), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True)
    result_id = Column(String(32), ForeignKey("results.id", ondelete="SET NULL"), nullable=True) # Non-null for output files

class DeletionCandidateORM(Base):
    """Table for staging orphaned or requested files for manual deletion by user."""
    __tablename__ = "deletion_candidates"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    file_id = Column(String(36), ForeignKey("files.id", ondelete="SET NULL"), nullable=True)
    filename = Column(String(255), nullable=False)
    storage_path = Column(String(512), nullable=False)
    checksum_sha256 = Column(String(64), nullable=True)
    size_bytes = Column(BigInteger, default=0)
    marked_at = Column(DateTime, default=datetime.utcnow)
    reason = Column(String(100), nullable=True)

class ProfileORM(Base):
    """Profile table (Option B1: no login)."""
    __tablename__ = "profiles"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    data = Column(JSON, nullable=True)  # Legacy profile data, kept for compatibility
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class BoardORM(Base):
    """Board static inventory."""
    __tablename__ = "boards"

    id = Column(String(64), primary_key=True) # MAC address as permanent ID (format: AA:BB:CC:DD:EE:FF)
    name = Column(String(255), nullable=False)
    ip_address = Column(String(64), default="")
    mac_address = Column(String(64), nullable=True)
    firmware_version = Column(String(128), nullable=True)
    model = Column(String(128), nullable=True)
    tag = Column(String(255), nullable=True)
    connections = Column(JSON, nullable=True) # Array of protocols supported e.g. ["REST API", "SSH"]
    state = Column(String(32), default="offline")
    cpu_temp = Column(Float, nullable=True)
    cpu_load = Column(Float, nullable=True)
    ram_usage = Column(Float, nullable=True)
    current_job_id = Column(String(32), nullable=True)
    last_heartbeat = Column(DateTime, nullable=True)
    fpga_status = Column(String(32), nullable=True)
    arm_status = Column(String(32), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class BoardTelemetryLogORM(Base):
    """Historical board telemetry for graphing."""
    __tablename__ = "board_telemetry_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    board_id = Column(String(64), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    cpu_temp = Column(Float, nullable=True)
    cpu_load = Column(Float, nullable=True)
    ram_usage = Column(Float, nullable=True)
    fpga_status = Column(String(32), nullable=True)
    arm_status = Column(String(32), nullable=True)
    recorded_at = Column(DateTime, default=datetime.utcnow)

class BoardStatusORM(Base):
    """Dynamic board telemetry/status (1-to-1 with boards)."""
    __tablename__ = "board_status"

    board_id = Column(String(64), ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True)
    state = Column(String(32), default="offline") # online, offline, busy, error
    cpu_temp = Column(Float, nullable=True)
    cpu_load = Column(Float, nullable=True)
    ram_usage = Column(Float, nullable=True)
    current_job_id = Column(String(32), nullable=True)
    last_heartbeat = Column(DateTime, nullable=True)
    fpga_status = Column(String(32), nullable=True)
    arm_status = Column(String(32), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class TestCaseORM(Base):
    """Immutable Test Case definitions."""
    __tablename__ = "test_cases"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    vcd_file_id = Column(String(36), ForeignKey("files.id"), nullable=False)
    bin_file_id = Column(String(36), ForeignKey("files.id", ondelete="SET NULL"), nullable=True) # EROM firmware binary
    lin_file_id = Column(String(36), ForeignKey("files.id", ondelete="SET NULL"), nullable=True) # ULP logic file (Nullable)
    mdi_file_id = Column(String(36), ForeignKey("files.id", ondelete="SET NULL"), nullable=True) # TXT command file
    owner_id = Column(String(36), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True)
    config_options = Column(JSON, nullable=True) # sampling_rate, voltage_limit, channels, etc.
    created_at = Column(DateTime, default=datetime.utcnow)

class RunSetORM(Base):
    """Run set (previously Test Suite) containing execution sequence."""
    __tablename__ = "run_sets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    owner_id = Column(String(36), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True)
    test_case_ids = Column(JSON, nullable=True) # [{"test_case_id": "...", "try_count": 3, "execution_order": 10}]
    created_at = Column(DateTime, default=datetime.utcnow)

class JobORM(Base):
    """Job queue container."""
    __tablename__ = "jobs"

    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    state = Column(String(32), default="draft") # draft, pending, running, completed, cancelled, failed
    progress = Column(Integer, default=0)
    priority = Column(Integer, default=0)
    timeout_seconds = Column(Integer, default=60)
    enable_picoscope = Column(Boolean, default=False)
    current_step = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    profile_id = Column(String(36), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True)
    config_name = Column(String(255), nullable=True)
    
    # UI Metadata snapshots
    tag = Column(String(255), nullable=True)
    tag_color = Column(String(32), nullable=True)
    client_id = Column(String(128), nullable=True)
    profile_display_name = Column(String(255), nullable=True)
    pairs_data = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

class JobTargetORM(Base):
    """Target board assignment for a job (Multi-board support)."""
    __tablename__ = "job_targets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id = Column(String(32), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    target_type = Column(String(32), default="any") # specific, any
    requested_board_id = Column(String(64), ForeignKey("boards.id", ondelete="SET NULL"), nullable=True)
    actual_board_id = Column(String(64), ForeignKey("boards.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(32), default="pending") # pending, running, completed, failed, board_lost, timed_out, retrying, cancelled
    board_assigned_at = Column(DateTime, nullable=True)
    board_lost_at = Column(DateTime, nullable=True)
    retry_count = Column(Integer, default=0)
    retry_reason = Column(String(64), nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

class ResultORM(Base):
    """Test result (also serving as minor execution queue items after job_items merged)."""
    __tablename__ = "results"

    id = Column(String(32), primary_key=True)
    job_id = Column(String(32), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    job_target_id = Column(String(36), ForeignKey("job_targets.id", ondelete="CASCADE"), nullable=False)
    test_case_id = Column(String(36), ForeignKey("test_cases.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(32), default="pending") # pending, running, completed, stopped, error
    execution_order = Column(Integer, nullable=False, default=0)
    try_count = Column(Integer, default=0)
    passed = Column(Boolean, nullable=True) # Null until test runs
    duration_seconds = Column(Float, nullable=True)
    error_message = Column(Text, nullable=True)
    metrics_json = Column(JSON, nullable=True) # CRC, packet_count, etc.
    snapshot_data = Column(JSON, nullable=True) # Snapshot of test_case details on execution
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class TagORM(Base):
    """Tag definitions."""
    __tablename__ = "tags"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), unique=True, nullable=False)
    tag_color = Column(String(16), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class TagMapORM(Base):
    """Polymorphic Tag mappings."""
    __tablename__ = "tags_map"

    tag_id = Column(String(36), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)
    entity_id = Column(String(64), primary_key=True)
    entity_type = Column(String(32), primary_key=True) # FILE, TEST_CASE, RUN_SET, JOB, RESULT, BOARD
    created_at = Column(DateTime, default=datetime.utcnow)

class NotificationORM(Base):
    """User notifications."""
    __tablename__ = "notifications"

    id = Column(String(32), primary_key=True)
    user_id = Column(String(128), nullable=True)
    type = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    data = Column(JSON, nullable=True)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class TestCommandORM(Base):
    """User test commands."""
    __tablename__ = "test_commands"

    id = Column(String(32), primary_key=True)
    user_id = Column(String(128), nullable=True)
    name = Column(String(255), nullable=False)
    command = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class FileTagORM(Base):
    """Legacy File tags (kept for compatibility during transition)."""
    __tablename__ = "file_tags"

    id = Column(String(32), primary_key=True)
    user_id = Column(String(128), nullable=True)
    tag = Column(String(100), nullable=False)
    color = Column(String(7), default="#000000")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
