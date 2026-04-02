# Zybo Board Software Specification (The Agent)

## 1. Overview
To support the Eval System V2, the Zybo board must run a lightweight "Agent" software. This agent acts as the bridge between the Backend (Commander) and the FPGA/Hardware (Worker).

## 2. Required Features

### 2.1 Auto-Discovery (Phone Home)
- **Problem**: Backend doesn't know when a board is plugged in or what IP it got.
- **Solution**: Upon boot, the Agent MUST send a registration request to the Gateway.
- **Mechanism**: `POST http://<GATEWAY_IP>:8000/api/boards/register` with MAC, Version, and Capability info.

### 2.2 Job Execution Engine
- **Role**: Receive a test job, execute it, and return results.
- **Steps**:
    1.  **Prepare**: Download Firmware (`.bit`) and Test Vector (`.vcd`) not present in local cache.
    2.  **Flash**: Program the FPGA (using `openocd` or Xilinx tools).
    3.  **Run**: Execute the test vector against the DUT.
    4.  **Capture**: Record the output waveform (Raw Binary) from the logic analyzer buffer.

### 2.3 Streamed Result Upload
- **Problem**: Result files (Waveforms) can be 100MB+. Storing them fully in RAM before upload is risky.
- **Solution**: **Stream Upload**.
- **Mechanism**: The Agent reads the binary buffer in chunks (e.g., 4KB) and streams it via HTTP PUT to the Backend.

### 2.4 Health Monitoring & Telemetry
- **Role**: Report board health to prevent overheating or crashes.
- **Metrics**: 
    - CPU Temperature (`/sys/class/thermal/...`)
    - CPU Load
    - RAM Usage
    - Valid Voltage Rails (if sensors available)
- **Interval**: Push every 30 seconds via `/api/boards/heartbeat`.

### 2.5 Self-Update
- **Role**: Allow the Agent software to be updated remotely without re-imaging the SD card.
- **Mechanism**: `POST /agent/update` -> Downloads `.whl` or `git pull` -> Restarts service.

---

## 3. Agent Architecture

```
[ Hardware Layer (FPGA / Drivers) ]
            ^
            | (/dev/mem, /dev/xdevcfg)
            v
[ Python Agent Service (FastAPI) ]
  - PORT: 8000
  - Service: `eval-agent.service` (Systemd)
            ^
            | (HTTP JSON / Binary Stream)
            v
[ Backend Server (Gateway) ]
```

## 4. API Endpoints (Listening on Zybo)

The Agent MUST implement these endpoints:

### `POST /execute`
Start a test job.
**Payload**:
```json
{
  "job_id": "job-123",
  "firmware_url": "...",
  "vcd_url": "...",
  "config": { "timeout": 60 }
}
```

### `GET /status`
Return current state (`IDLE`, `RUNNING`, `ERROR`) and progress.

### `POST /cancel`
Force stop the current job.

### `POST /restart`
Reboot the Linux OS.

## 5. Implementation Requirements
- **Language**: Python 3.8+ (Compatible with Pynq/Xilinx Linux).
- **Dependencies**: `fastapi`, `uvicorn`, `requests`, `psutil`.
- **Startup**: Must run as a systemd service enabled on boot.
- **Resilience**: Must auto-restart if crashed.
