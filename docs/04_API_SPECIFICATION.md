# 04. API Specification

> [!NOTE]
> **Implementation Status (Last Updated: 2026-01-29)**
> - **Files API**: Fully Implemented (PostgreSQL + Disk)
> - **Results API**: Fully Implemented (PostgreSQL + HDF5)
> - **Agent API**: Implemented (`/api/agent/register`, `/api/agent/heartbeat`)
> - **Board Control**: Implemented (HTTP Calls to Agent)

This document describes the REST API endpoints provided by the Backend.
It is divided into two main sections:
1.  **Backend APIs**: Consumed by the **Frontend Application** (React).
2.  **Board APIs**: Consumed/ Provided by the **ARM Board Agent** (Python).

## Base URL
- **Dev**: `http://localhost:3000/api`
- **Prod**: `http://<SERVER_IP>:3000/api`

## Authentication
`Authorization: Bearer <jwt_token>`

---

# 1. Backend APIs (Frontend Interactions)

## 1.1 System
Endpoints for global system status.

-   `GET /api/system/health`: System health summary (boards, storage, active jobs).
    ```json
    {
      "totalBoards": 52,
      "onlineBoards": 45,
      "busyBoards": 5,
      "errorBoards": 2,
      "storageUsage": 68,
      "boardApiStatus": "online"
    }
    ```
-   `GET /api/system/storage`: Detailed storage statistics.
-   `GET /api/system/board-api/status`: Status of the internal board gateway service.

## 1.2 Boards
Endpoints to manage the hardware inventory.

-   `GET /api/boards`: List all boards (supports filtering by `status`, `model`).
    ```json
    [
      {
        "id": "board-01",
        "name": "Zybo Rack 1",
        "status": "ONLINE",
        "ip": "192.168.100.101",
        "mac": "00:1B:44:11:3A:B7",
        "firmware": "v2.3.1",
        "stats": { "temp": 42.5 }
      }
    ]
    ```
-   `GET /api/boards/{id}`: Get details of a specific board.
-   `GET /api/boards/{id}/telemetry`: Get real-time sensor data (Voltage, Temp).
-   `POST /api/boards/{id}/reboot`: Trigger remote reboot.
-   `POST /api/boards/{id}/firmware`: Update Agent firmware (Multipart upload).
-   `POST /api/boards/batch`: Execute actions on multiple boards (e.g., mass reboot).

## 1.3 Test Manager
Manage Test Cases and Test Sets.

-   `POST /api/tests/cases`: Create a new test case.
-   `GET /api/tests/cases`: List test cases.
-   `POST /api/tests/sets`: Create a test set.
-   `GET /api/tests/sets`: List test sets.

## 1.4 Jobs
The core execution queue management.

-   `GET /api/jobs`: List jobs in the queue.
-   `POST /api/jobs`: Enqueue a new test job.
    ```json
    {
      "name": "Distributed Run 1",
      "urgent": true, // Priority=100
      "execution_mode": "distributed", // or "broadcast"
      "boards": ["board-01", "board-02"],
      "tags": ["nightly", "release"],
      "test_set_id": "ts-001"
    }
    ```
-   `GET /api/jobs/{id}`: Get full job details and logs.
-   `POST /api/jobs/{id}/start`: Manually start a job (if paused).
-   `POST /api/jobs/{id}/stop`: Cancel/Kill a running job.
-   `POST /api/jobs/stop-all`: Emergency stop for all jobs.
-   `GET /api/jobs/{id}/export`: Download job report as JSON.
-   `POST /api/jobs/{id}/reorder`: Move job position in the queue.
-   `PATCH /api/jobs/{id}`: Update tags (`{"tags": ["new"]}`).

## 1.4 Results
Access historical test outcomes and waveform data.

-   `GET /api/results`: List all past results.
-   `GET /api/results/{id}`: Get specific result metadata.
-   `GET /api/results/{id}/waveform`: Get downsampled waveform data for visualization.
    ```json
    {
      "time_scale": "1ns",
      "signals": [
        { "name": "CLK", "data": [0, 1, 0, 1, ...] },
        { "name": "DATA", "data": [0, 0, 1, 1, ...] }
      ]
    }
    ```
-   `GET /api/results/{id}/log`: Get raw console logs.

## 1.5 Files
Manage uploaded assets (VCDs, Firmware).

-   `POST /api/files/upload`: Upload file (Multipart).
    ```json
    {
      "id": "uuid-file-123",
      "name": "test_pattern.vcd",
      "type": "VCD",
      "size": 2516582
    }
    ```
-   `GET /api/files`: List all files.
-   `DELETE /api/files/{id}`: Remove a file from storage.

## 1.6 Notifications
System alerts and user notifications.

-   `GET /api/notifications`: List unread notifications.
-   `POST /api/notifications/{id}/read`: Mark as read.
-   `POST /api/notifications/read-all`: Mark all as read.

## 1.7 WebSocket (Real-time)
-   `/ws/system`: System health updates.
-   `/ws/boards`: Board status changes (`BOARD_UPDATE`).
-   `/ws/jobs`: Job progress updates (`JOB_PROGRESS`).

---

# 2. Board APIs (Backend ↔ ARM Interactions)

These endpoints define the protocol between the Central Server and the Zybo Agent.

## 2.1 Backend -> ARM (Agent Listening)
The Agent runs a FastAPI server on port 8000.

-   `POST /api/v1/jobs`: Receive a new job assignment.
    ```json
    {
      "job_id": "job-001",
      "vcd_url": "http://192.168.100.1/files/...",
      "firmware_url": "http://192.168.100.1/files/..."
    }
    ```
-   `POST /api/v1/runs`: Trigger execution of the loaded job.
-   `POST /api/v1/runs/{run_id}/stop`: Abort execution.
-   `GET /api/v1/health`: Report detailed health (CPU/RAM/DISK).
    ```json
    {
      "cpu_load": 12.5,
      "temp": 45.2,
      "state": "IDLE"
    }
    ```

## 2.2 ARM -> Backend (Server Listening)
The Agent calls these on the Server.

-   `POST /api/boards/hello`: Registration on boot (Phone Home).
    ```json
    {
      "mac": "AA:BB:CC:DD:EE:01",
      "ip": "192.168.100.101",
      "firmware": "1.0.0"
    }
    ```
-   `POST /api/boards/heartbeat`: Periodic keep-alive (every 30s).
-   `POST /api/boards/{id}/measurements`: Notify that new result data is ready to stream.
