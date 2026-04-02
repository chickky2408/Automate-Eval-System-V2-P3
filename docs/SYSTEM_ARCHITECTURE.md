# Eval System V2 - System Architecture Plan

## Goal Description
This document outlines the architectural plan for the **Eval System V2**. The goal is to provide a robust, scalable, and user-friendly platform for managing semiconductor evaluation boards (Zybo), executing test jobs (vcd stream/firmware), and analyzing results.

## System Structure (โครงสร้างระบบ)

 The system follows a **Modern 3-Tier Architecture** extended with a **Hardware Interface Layer**.

### 1. **Presentation Layer (Frontend)**
- **Tech Stack**: React 18, Vite, TailwindCSS, Zustand.
- **Role**:
    - **Dashboard**: Real-time monitoring of board health and job progress.
    - **Job Manager**: Visual interface to create, schedule, and prioritize test jobs.
    - **Analysis**: Visualization of test results (plots, logs).
- **Communication**: REST API (HTTP) for actions, WebSocket for real-time updates.

### 2. **Application Layer (Backend API)**
- **Tech Stack**: Python (FastAPI), SQLAlchemy (Async), Alembic.
- **Role**:
    - **API Gateway**: Validates requests, handles authentication.
    - **Job Orchestrator (Queue)**: Manages the `First-In-First-Out` (FIFO) execution queue with priority support.
    - **Board Manager**: Maintains the "Source of Truth" for board status (Busy, Online, Offline).
    - **File Handler**: Manages firmware and VCD file storage.

### 3. **Data Persistence Layer**
- **Tech Stack**: SQLite (Dev) / PostgreSQL (Production).
- **Role**:
    - Persists Job History, Board Configurations, and User Settings.
    - Stores file metadata (paths to `uploads/`).

### 4. **Hardware Interface Layer (Private Network)**
- **Tech Stack**: Python Agent (FastAPI/Flask) running on Zybo + `dnsmasq` on Backend.
- **Topology**: **Option B (Private Network)**.
    - Backend acts as Gateway (Static IP `192.168.100.1`).
    - Zybo gets IP via DHCP (Sticky MAC) from Backend.
- **Role**:
    - **Phone Home**: Zybo registers itself on boot.
    - **Agent**: Listens for HTTP commands (`/execute_job`, `/update_firmware`).
    - **Stream Transfer**: Uploads binary results via HTTP Stream.

## Database Design (การออกแบบฐานข้อมูล)

### Technology Choice
- **Development**: **SQLite** (Current). simple, file-based, zero-config.
- **Production**: **PostgreSQL** (CONFIRMED).
    - **Reason**: Better concurrency control for the Queue mechanism (row-level locking).
    - **Reason**: Native support for JSONB (efficient for storing result waveforms or metadata).
    - **Reason**: More robust data integrity protection during power failures.

### Storage Strategy (Hybrid)
- **Metadata**: Stored in PostgreSQL (Job info, Pass/Fail, Metrics).
- **Waveform Data**: Stored as **HDF5 (.h5)** files on disk.
    - **Workflow**: Board sends Raw Binary -> Backend converts to HDF5 -> Saves to `storage/` -> Updates DB with file path.
    - **Preview**: Backend performs "Server-Side Slicing" to serve graph data to Frontend.

### Schema Entities

#### 1. Boards (`boards`)
Tracks status and configuration of all connected hardware.
- `id` (PK): Unique Board ID (e.g., `board-xyz`)
- `status`: Enum (ONLINE, OFFLINE, BUSY, ERROR)
- `ip_address`, `mac_address`: Network info
- `locked_by_job_id`: FK to `jobs.id` (Critical for locking mechanism)
- `last_heartbeat`: Timestamp for effective "Offline" detection.

#### 2. Jobs (`jobs`)
The core queue entity.
- `id` (PK): Job UUID
- `priority`: Int (Higher = executed first)
- `state`: Enum (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED)
- `vcd_file_id`, `firmware_file_id`: FK to `files` table.
- `target_board_id`: Optional (if user requested specific board)
- `assigned_board_id`: The board actually used.
- `logs`: Text/JSON (Execution logs)

#### 3. Test Results (`results`)
Historical record of completed tests.
- `id` (PK): Result UUID
- `job_id`: Link to original job.
- `waveform_data`: JSONB (Compressed waveform data/summary)
- `metrics`: JSONB (Voltage drops, timing violations)
- `passed`: Boolean

#### 4. Files (`files`) &lt;-- *[NEW Requirement]*
Manage uploaded assets instead of just checking file paths.
- `id` (PK): UUID
- `filename`: logical name (e.g., `test_pattern_v1.vcd`)
- `file_path`: physical path on disk.
- `file_type`: Enum (VCD, FIRMWARE, SCRIPT)
- `checksum`: SHA256 (Ensure integrity)
- `uploaded_at`: Timestamp

---

## Key Concerns & Solutions (ข้อกังวลและวิธีแก้ไข)

We must address these critical areas to ensure system stability.

### 1. **Concurrency & Resource Locking (การแย่งกันใช้บอร์ด)**
- **Concern**: Two users trying to use the same board simultaneously, or a job starting on a board that is already busy.
- **Solution**: **Centralized Job Queue & locking mechanism**.
    - The `JobQueueService` must be the *single point of entry* for running tests.
    - Implement a `mutex` (lock) on each Board ID in the database.
    - If a board is `BUSY`, new jobs for that board stay `PENDING`.

### 2. **Hardware Reliability (ความเสถียรของฮาร์ดแวร์)**
- **Concern**: Boards may hang, disconnect, or fail to respond to SSH commands, causing the Job Queue to "stuck" indefinitely.
- **Solution**: **Timeouts & Heartbeats**.
    - **Job Timeout**: Every job MUST have a hard `timeout_seconds`. If a job runs longer than expected, the backend forcefully cancels it and marks the board as `ERROR` or attempts a `Reboot`.
    - **Health Check Loop**: A background process should ping boards every 10-30s. If a board ping fails, mark as `OFFLINE` automatically.

### 3. **Large File Handling (การจัดการไฟล์ขนาดใหญ่)**
- **Concern**: VCD files and Firmware binaries can be large. Transferring them securely and verifying integrity is crucial.
- **Solution**: **Checksums & Stream Optimization**.
    - Store files with SHA256 checksums to detect corruption.
    - When transferring to the board, use `rsync` or streamed `scp` to avoid out-of-memory errors on the board (if RAM is limited).
    - **Cleanup**: Auto-delete temporary files on the board after the job finishes.

### 4. **Real-time Feedback (การตอบสนองแบบเรียลไทม์)**
- **Concern**: Users waiting 5-10 minutes for a test to finish without knowing if it's actually running or hung.
- **Solution**: **WebSocket Progress Updates**.
    - The Backend should push "Step started: Flashing...", "Step started: Streaming..." events via WebSocket.
    - Frontend calculates estimated time remaining based on historical data.

---

## Proposed Roadmap

### Phase 1: Core Stability (Current Focus)
- [ ] Stabilize `JobQueueService` (Ensure no jobs get lost).
- [ ] Implement robust `SSH` wrapper with retry/timeout logic.
- [ ] Complete `e2e` flow: Upload -> Queue -> Run -> Result.

### Phase 2: Monitoring & Recovery
- [ ] Add `Watchdog` service to monitor Board Health.
- [ ] Implement `Auto-Reboot` triggering for stuck boards.
- [ ] Add `Log Rotation` for server logs.

### Phase 3: Advanced Features
- [ ] **Data Analytics**: Compare results across different Firmware versions.
- [ ] **Scheduling**: Run nightly regression tests.
- [ ] **Multi-node**: If scaling beyond 1 server, move Queue to Redis/Celery.
