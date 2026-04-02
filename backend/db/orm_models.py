"""
SQLAlchemy ORM Models for database tables.
"""
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Text, JSON, Enum as SAEnum, ForeignKey, BigInteger
from datetime import datetime
from db.database import Base
import enum
import uuid

class FileType(str, enum.Enum):
    VCD = "VCD"
    FIRMWARE = "FIRMWARE"
    SCRIPT = "SCRIPT"
    OTHER = "OTHER"

class FileORM(Base):
    """File registry table. set_id is null for main library; non-null for files stored with a Set."""
    __tablename__ = "files"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String(255), nullable=False)
    file_type = Column(SAEnum(FileType), nullable=False)
    storage_path = Column(String(512), nullable=False)
    checksum_sha256 = Column(String(64), nullable=True)
    size_bytes = Column(BigInteger, default=0)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    set_id = Column(String(128), nullable=True)  # null = main library; set id = stored with that set
    owner_id = Column(String(128), nullable=True)  # client_id or profile_id of uploader
    owner_display_name = Column(String(255), nullable=True)  # snapshot of profile name at upload (any owner_id)
    visibility = Column(String(32), default="public")  # 'private' | 'team' | 'public'
    library_tags = Column(Text, nullable=True)  # comma-separated; shared across all clients/profiles
    tag_color = Column(String(32), nullable=True)  # palette key, see file_store.allowed + frontend tagPalette.js


class JobORM(Base):
    """Job table for persisting job queue."""
    __tablename__ = "jobs"

    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    
    # Linked Files
    vcd_file_id = Column(String(36), ForeignKey("files.id"), nullable=True) # Needs to be optional for "Run Command" jobs
    firmware_file_id = Column(String(36), ForeignKey("files.id"), nullable=True)
    
    # Legacy fields (kept for compatibility or simple display)
    vcd_filename = Column(String(255), nullable=True)
    firmware_filename = Column(String(255), nullable=True)

    target_board_id = Column(String(32), nullable=True)
    target_board_ids = Column(JSON, nullable=True)  # For broadcast mode
    assigned_board_id = Column(String(32), nullable=True)
    priority = Column(Integer, default=0)
    queue_position = Column(Integer, default=0)
    timeout_seconds = Column(Integer, default=60)
    retries = Column(Integer, default=0)
    enable_picoscope = Column(Boolean, default=False)
    save_to_db = Column(Boolean, default=True)
    
    # Status fields
    state = Column(String(32), default="pending")
    progress = Column(Integer, default=0)
    current_step = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Frontend metadata columns
    tag = Column(String(255), nullable=True)
    tag_color = Column(String(32), nullable=True)  # palette key; see frontend tagPalette.js
    client_id = Column(String(128), nullable=True)
    profile_id = Column(String(128), nullable=True)  # active profile id when job was created
    profile_display_name = Column(String(255), nullable=True)  # snapshot of profile name at create time (any profile id)
    config_name = Column(String(255), nullable=True)
    pairs_data = Column(JSON, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)


class ResultORM(Base):
    """Result table for persisting test results."""
    __tablename__ = "results"

    id = Column(String(32), primary_key=True)
    job_id = Column(String(32), ForeignKey("jobs.id"), nullable=False)
    job_name = Column(String(255), nullable=False)
    board_id = Column(String(32), ForeignKey("boards.id"), nullable=False)
    board_name = Column(String(255), nullable=False)
    passed = Column(Boolean, nullable=False)
    
    # Timing
    started_at = Column(DateTime, nullable=False)
    completed_at = Column(DateTime, nullable=False)
    duration_seconds = Column(Float, nullable=False)
    
    # Test details
    vcd_filename = Column(String(255), nullable=False)
    firmware_filename = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    packet_count = Column(Integer, default=0)
    crc_errors = Column(Integer, default=0)
    console_log = Column(Text, nullable=True)
    
    # Hybrid Storage: HDF5 Path instead of JSON blob
    waveform_hdf5_path = Column(String(512), nullable=True) 
    metrics = Column(JSON, nullable=True)


class ProfileORM(Base):
    """Profile table (Option B1: no login). id is the share key; data = { savedTestCases, savedTestCaseSets }."""
    __tablename__ = "profiles"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    data = Column(JSON, nullable=True)  # { savedTestCases: [], savedTestCaseSets: [] }
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BoardORM(Base):
    """Board inventory and status table."""
    __tablename__ = "boards"

    id = Column(String(64), primary_key=True)
    name = Column(String(255), nullable=False)
    ip_address = Column(String(64), default="")
    mac_address = Column(String(64), nullable=True)
    firmware_version = Column(String(128), nullable=True)
    model = Column(String(128), nullable=True)
    tag = Column(String(128), nullable=True)
    connections = Column(JSON, nullable=True)

    # Status fields
    state = Column(String(32), default="offline")
    cpu_temp = Column(Float, nullable=True)
    cpu_load = Column(Float, nullable=True)
    ram_usage = Column(Float, nullable=True)
    current_job_id = Column(String(32), nullable=True)
    last_heartbeat = Column(DateTime, nullable=True)
    fpga_status = Column(String(32), nullable=True)  # 'active' | 'idle' | 'error' | 'unknown'
    arm_status = Column(String(32), nullable=True)   # 'online' | 'busy' | 'error' | 'unknown'

    created_at = Column(DateTime, default=datetime.utcnow)


class TestCaseORM(Base):
    """Test case definitions."""
    __tablename__ = "test_cases"

    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    vcd_file_id = Column(String(36), ForeignKey("files.id"), nullable=True)
    firmware_filename = Column(String(255), nullable=True)
    tags = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TestSetORM(Base):
    """Test sets (suites)."""
    __tablename__ = "test_sets"

    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    tags = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TestSetItemORM(Base):
    """Link table for Test Sets → Test Cases."""
    __tablename__ = "test_set_items"

    id = Column(String(32), primary_key=True)
    test_set_id = Column(String(32), ForeignKey("test_sets.id"), nullable=False)
    test_case_id = Column(String(32), ForeignKey("test_cases.id"), nullable=False)
    execution_order = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class NotificationORM(Base):
    """User notifications."""
    __tablename__ = "notifications"

    id = Column(String(32), primary_key=True)
    user_id = Column(String(128), nullable=True)  # null = broadcast to all
    type = Column(String(50), nullable=False)  # job_completed, error, etc.
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    data = Column(JSON, nullable=True)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class TestCommandORM(Base):
    """User test commands."""
    __tablename__ = "test_commands"

    id = Column(String(32), primary_key=True)
    user_id = Column(String(128), nullable=True)  # null = shared commands
    name = Column(String(255), nullable=False)
    command = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FileTagORM(Base):
    """File tags for categorization."""
    __tablename__ = "file_tags"

    id = Column(String(32), primary_key=True)
    user_id = Column(String(128), nullable=True)  # null = shared tags
    tag = Column(String(100), nullable=False)
    color = Column(String(7), default="#000000")  # Hex color code
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class JobFileORM(Base):
    """Job files - files within a job."""
    __tablename__ = "job_files"

    id = Column(String(32), primary_key=True)
    job_id = Column(String(32), ForeignKey("jobs.id"), nullable=False)
    name = Column(String(255), nullable=False)
    status = Column(String(32), default="pending")
    result = Column(String(32), nullable=True)  # pass, fail, stopped
    order = Column(Integer, nullable=False)
    vcd = Column(String(255), nullable=True)  # VCD file name
    erom = Column(String(255), nullable=True)  # ERoM (BIN) file name
    ulp = Column(String(255), nullable=True)  # ULP (LIN) file name
    try_count = Column(Integer, nullable=True)  # Number of test rounds
    test_case_name = Column(String(255), nullable=True)  # Display name (e.g. from set)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
