# 03. Database Schema & Storage

This document defines the data model for the Eval System V2, utilizing a **Hybrid Storage Strategy** (PostgreSQL + HDF5).

## 1. Storage Strategy

### 1.1 Relational Database (PostgreSQL)
Used for structured metadata where relational integrity and atomic transactions are required.
- **Entities**: Jobs, Boards, Users, Configurations.
- **Why Postgres?**: To support **Row-Level Locking** (`SELECT FOR UPDATE`) required for the Job Queue to prevent race conditions on boards.

### 1.2 File System (HDF5)
Used for high-volume, structural time-series data (Waveforms).
- **Format**: Hierarchical Data Format version 5 (`.h5`).
- **Path**: `/var/lib/eval_system/storage/waveforms/<YYYY>/<date>/<job_id>.h5`
- **Why?**: Queries on SQL for 1GB binary blobs are slow. HDF5 allows fast slicing (`data[0:1000]`) without reading the whole file.

## 2. SQL Schema Definitions

### A. Boards Table (`boards`)
Inventory of physical hardware.
```sql
CREATE TABLE boards (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(20) DEFAULT 'OFFLINE', -- ONLINE, BUSY, ERROR
    ip_address VARCHAR(45),
    mac_address VARCHAR(17),
    locked_by_job_id VARCHAR(32), -- For Mutex Locking
    last_heartbeat TIMESTAMP
);
```

### B. Files Table (`files`)
Central asset registry.
```sql
CREATE TABLE files (
    id UUID PRIMARY KEY,
    filename VARCHAR(255),
    file_type VARCHAR(20), -- FIRMWARE, VCD, SCRIPT
    storage_path TEXT,
    checksum_sha256 VARCHAR(64),
    uploaded_at TIMESTAMP DEFAULT NOW()
);
```

### C. Test Management Tables
New hierarchy for organizing tests.

#### 1. Test Cases (`test_cases`)
Atomic test definitions.
```sql
CREATE TABLE test_cases (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    vcd_file_id UUID REFERENCES files(id),
    firmware_filename VARCHAR(255),
    tags VARCHAR(255), -- Comma-separated tags
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### 2. Test Sets (`test_sets`)
Groups of test cases (Suites).
```sql
CREATE TABLE test_sets (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    tags VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### 3. Test Set Items (`test_set_items`)
Link table for Test Sets -> Test Cases (Ordered).
```sql
CREATE TABLE test_set_items (
    id VARCHAR(32) PRIMARY KEY,
    test_set_id VARCHAR(32) REFERENCES test_sets(id),
    test_case_id VARCHAR(32) REFERENCES test_cases(id),
    execution_order INT
);
```

### D. Jobs Table (`jobs`)
The execution queue (Updated for V2).
```sql
CREATE TABLE jobs (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255),
    priority INT DEFAULT 0, -- 0=Normal, 100=Urgent
    state VARCHAR(20), -- PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
    
    -- Execution Mode
    execution_mode VARCHAR(20) DEFAULT 'distributed', -- distributed, broadcast
    target_board_ids JSONB, -- List of target boards
    
    -- Legacy / Single Job Support
    target_board_id VARCHAR(32) REFERENCES boards(id),
    assigned_board_id VARCHAR(32) REFERENCES boards(id),
    
    test_set_id VARCHAR(32) REFERENCES test_sets(id),
    
    tags VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);
```

### E. Job Items (`job_items`)
Individual test case executions within a Job.
```sql
CREATE TABLE job_items (
    id VARCHAR(32) PRIMARY KEY,
    job_id VARCHAR(32) REFERENCES jobs(id),
    test_case_id VARCHAR(32) REFERENCES test_cases(id),
    status VARCHAR(20),
    result VARCHAR(20), -- PASS, FAIL
    execution_order INT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);
```

### D. Results Table (`results`)
Test outcomes.
```sql
CREATE TABLE results (
    id UUID PRIMARY KEY,
    job_id UUID REFERENCES jobs(id),
    passed BOOLEAN,
    waveform_hdf5_path TEXT, -- Link to HDF5 file
    metrics JSONB -- Flexible stats e.g. {"v_drop": 0.1, "temp": 40}
);
```

## 3. Data Flow Example

1. **Job Creation**: Frontend inserts `Job` linked to `vcd_file_id`.
2. **Execution**: Backend locks `Board`, runs test.
3. **Capture**: Zybo streams Raw Binary to Backend -> Backend saves to `temp.bin`.
4. **Conversion**: Backend converts `temp.bin` -> `<id>.h5`.
5. **Completion**: Backend updates `Results` table with `waveform_hdf5_path = '...'`.
