# 01. System Overview (Eval System V2)

## 1. Goal Description
The **Eval System V2** is a robust, scalable platform designed to manage semiconductor evaluation boards (Zybo), execute test jobs (streaming VCD vectors, firmware flashing), and analyze results. It replaces the legacy V1 PC-centric manual testing with an automated, centralized "Test Farm".

## 2. Evolution: V1 vs V2
The content below highlights the shift from a tethered UART architecture to a standalone distributed network.

| Feature | V1 (Legacy) | V2 (New Architecture) |
| :--- | :--- | :--- |
| **Compute Location** | **PC Host** (Python Scripts) | **ARM + FPGA** (Distributed Edge) |
| **Connectivity** | USB-UART (Serial) | **Ethernet (Private Network)** |
| **Protocol Generation** | PC generates frames (`vcd2protocol`) | ARM Board generates on-the-fly |
| **Process** | Serial, Single-tasking | Parallel, Queued execution |
| **Data Storage** | Local SQLite files | **Central PostgreSQL + HDF5** |

## 3. System Architecture (3-Tier + Hardware)

The system follows a Modern 3-Tier Architecture extended with a Hardware Interface Layer.

```
[ User (Browser) ]
       |
       v (HTTP/WS)
[ Frontend (React) ] <------> [ Backend (FastAPI) ] <------> [ Database (Postgres) ]
                                      ^
                                      | (Private Network / HTTP Stream)
                                      v
                               [ Hardware Layer (Zybo Farm) ]
```

### 3.1 Presentation Layer (Frontend)
- **Tech Stack**: React 18, Vite, TailwindCSS, Zustand.
- **Key Features**:
    - **Dashboard**: Real-time health monitoring of all 50+ boards.
    - **Job Manager**: Kanban-style or List view of test queues.
    - **Analysis**: Interactive waveform viewer (Downsampled from Server).

### 3.2 Application Layer (Backend API)
- **Tech Stack**: Python (FastAPI), SQLAlchemy (Async).
- **Key Roles**:
    - **Gateway**: Single entry point for all API calls.
    - **Job Orchestrator**: FIFO Queue with Priority (Urgent Jobs) to manage board contention. Supports **Distributed Execution** (Multi-board).
    - **Test Manager**: Manages Test Cases and Test Sets with tagging support.
    - **Stream Processor**: Handles raw binary upload -> HDF5 conversion on the fly.

### 3.3 Data Persistence Layer
- **Tech Stack**: PostgreSQL (Production) / SQLite (Dev).
- **Key Roles**:
    - **Metadata**: Stores Jobs, Boards, Results, and File Indexes.
    - **Waveform Storage**: Uses **HDF5** on disk for high-performance time-series storage (Waveforms).

### 3.4 Hardware Interface Layer (Private Network)
- **Topology**: Backend acts as Gateway (Static IP `192.168.100.1`).
- **Discovery**: Boards use "Phone Home" protocol to register on boot.
- **Communication**: Light HTTP Agent running on Zybo boards.

## 4. Key Design Decisions

### A. Hybrid Storage Strategy
- **Why?**: Waveform data (Raw Binary) ranges from 100MB to GBs. Storing blobs in SQL is inefficient.
- **Decision**: 
    - **SQL**: Stores "pointers" (file paths) and metadata (voltage metrics, pass/fail).
    - **Disk (HDF5)**: Stores actual waveform data. HDF5 allows fast slicing for frontend preview.

### B. Concurrency Control (Locking)
- **Problem**: Multiple users running tests on the same specific board.
- **Decision**: Database-level locking. When a Job starts, the Board state moves to `BUSY`. Any other Job targeting this Board stays `PENDING`.

### C. Private Network Isolation
- **Why?**: To prevent corporate network traffic from interfering with sensitive test streams, and to simplify IP management.
- **Decision**: A dedicated generic Switch connects all Zybos to a 2nd NIC on the Server. Server runs DHCP (`dnsmasq`) to hand out Static Leases based on MAC address.

## 5. Technology Stack Summary

| Component | Technology | Reasoning |
| :--- | :--- | :--- |
| **Frontend** | React + Vite | Fast dev cycle, rich ecosystem. |
| **State** | Zustand | Simpler than Redux, sufficient for complexity. |
| **Backend** | Python FastAPI | High perf (Async), native easy integration with Data Science libs (HDF5/Pandas). |
| **DB** | PostgreSQL | Robust locking, JSONB support for flexible metrics. |
| **Agent** | Python (FastAPI) | Lightweight, shares language with Backend. |
| **Waveforms**| HDF5 | Industry standard for scientific data, supports partial IO. |


