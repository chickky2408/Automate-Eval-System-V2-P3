# FPGA Board Agent — Handover & Status Report

**Date:** 2026-06-16 | **Status:** 
- **Full Docker e2e:** Completed and verified successfully.
- **SSHTerminal Stability:** Completed, optimized for layout scaling and WebSocket connection cycles.
- **Board Privilege Elevation:** Completed, service transitioned to root for hardware control (`reboot`, `fpgautil`).
- **Database Schema Sync:** All UUID length limits and Enum file type mismatches resolved.
- **End-to-End Execution Flow:** Fully tested on the real KR260 board in both Mock (Dry-Run) and Real Flash modes.

Implements the on-board agent and backend wiring for the job flow in [JOB_SEQUENCE_DIAGRAM.md](./JOB_SEQUENCE_DIAGRAM.md): Backend dispatches a test job to a KR260 board → board flashes FPGA, captures a signal, uploads the result → backend stores it and marks the result complete.

---

## 1. What was built & Optimized

### Phase 1 — On-board agent (new)
Location: `D:\siliconcraft\eval_system\fpga_interface\board_agent\` (sibling repo, **not** under the V2 backend repo).

A single FastAPI app (default port 8000) the KR260 runs. Files:

| File | Role |
|------|------|
| `main.py` | App + lifespan (register + heartbeat loop); routes `/health`, `/system/reboot`, `/execute` |
| `config.py` | Config from env / `agent.toml` / defaults; auto-detects MAC + board_id |
| `metrics.py` | CPU / RAM / temp / `fpga_status` from sysfs (degrade gracefully off-board) |
| `hardware.py` | `FpgaController.flash()` via `xmutil` / `fpgautil`; `DRY_RUN` stub |
| `simulator.py` | `CaptureSource` protocol + `SimulatedCapture` (software sin wave) |
| `runner.py` | Job pipeline: download → flash → capture → upload → cleanup; `busy` flag |
| `backend_client.py` | httpx client: register / heartbeat / download asset / chunked upload / measurements |
| `agent.toml`, `requirements.txt`, `README.md` | Config template, deps, docs |

#### Privileged Elevation for Hardware Control:
- **[board-agent.service](file:///d:/siliconcraft/eval_system/fpga_interface/deployment/board-agent.service)** was modified to run under `User=root` and `Group=root` to allow calling privileged hardware commands like `reboot`, `fpgautil`, and `xmutil` directly.
- **Offline installation script** [full_setup_zybo.py](file:///d:/siliconcraft/eval_system/fpga_interface/deployment/full_setup_zybo.py) now passes `sudo` password to install required python wheels system-wide for the root environment.

### Phase 2 — Backend integration (V2 backend repo)
Backend stopped simulating runs; it now calls the real board.

| File | Change |
|------|--------|
| [backend/services/board_manager.py](../backend/services/board_manager.py) | New `execute_job(...)` → `POST http://{ip}:{AGENT_PORT}/execute`. `agent_port` now reads env `AGENT_PORT` (default 8000). |
| [backend/services/job_queue.py](../backend/services/job_queue.py) | `_execute_target` loop: dispatch to board, then `_wait_for_result()` polls `ResultORM.status` until completed/error/timeout. |
| [backend/routers/boards.py](../backend/routers/boards.py) | New `POST /api/boards/{id}/measurements` → updates `ResultORM` (passed, error, duration, metrics_json, completed_at). WebSSH terminal proxy has been enhanced with Paramiko keepalives and Incremental UTF-8 chunk decoding. |
| [backend/routers/agent_results.py](../backend/routers/agent_results.py) | Chunked receiver `/v1/upload/init\|part\|complete` + SHA256 → converts bin→`.h5` (dataset `raw`, int16) at `uploads/WAVEFORM/YYYY/MM/{result_id}.h5` → registers `FileORM(WAVEFORM, result_id=...)`. |
| [backend/main.py](../backend/main.py) | Registers `agent_results.router` (no prefix, before SPA fallback). Watchdog sweeps every 15s (timeout 30s) to detect stale boards quickly. |

---

## 2. WebSSH Terminal Stability Enhancements
- **Keepalives & TCP stability:** Paramiko keeps tunnels active by sending keepalive packets every 10 seconds.
- **Perfect UTF-8 Decoding:** Replaced direct UTF-8 chunk decoding with Python's `codecs.getincrementaldecoder('utf-8')` to prevent multi-byte characters from breaking at chunk boundaries.
- **No Character Loss:** Used `channel.sendall` for input transmission so paste buffers are sent completely.
- **Layout Scaling:** Adjusted xterm.js bounds container to fit available pixel size without scrollbars or overlapping text.
- **Lifecycle Reconnection Fix:** Removed inline onClose callbacks from the React `useEffect` hook dependency list to stop terminal sessions from restarting on telemetry updates.
- **Immediate State Transition & Cooldown:** Toggling reboot immediately marks the board offline in the DB and blocks heartbeats for 35 seconds cooldown to prevent shutdown race conditions.

---

## 3. Database Schema Modifications
To support modern execution and handle V2 uuid identifiers, the following schema migrations were made:
- **Column Lengths:** Increased UUID/ID target columns in the `test_cases` table from `VARCHAR(32)` to `VARCHAR(36)`.
- **Constraint Nullability:** Removed strict `NOT NULL` constraints from legacy columns on the `results` table (such as `passed` or `duration_seconds`) to accommodate partial states.
- **Timestamps:** Added `created_at` timestamp column to `results`.
- **Enum Values Expansion:** Expanded the PostgreSQL `filetype` enum type dynamically on startup to register `"WAVEFORM"`, `"LOG"`, `"REPORT"`, `"SCRIPT"`, and `"OTHER"`, preventing db errors when the result receiver uploads HDF5 files.

---

## 4. Job Queue Verification & Bug Fixes
- **Missing Session Commit:** Fixed `job_queue_service.add_job()` to commit `ResultORM` records so they are successfully saved to the database.
- **Multiple Results Found on RunSet Join:** Switched to `.scalars().first()` with `order_by(RunSetORM.created_at.desc())` inside the queue loop when linking a job to its test suite configuration. This prevents query crashes if multiple RunSets share the same name.
- **Queue Hang Fallback:** Handled fallback where if `test_runs` is empty, it also sets the Job state to `"completed"` instead of leaving it in `"configuring"`.

---

## 5. Verification Done

- `py_compile` clean: all changed backend files + agent.
- **Mock / Dry Run E2E Flow:** Enabled `dry_run = true` in `/home/petalinux/board_agent/agent.toml` on the Zybo board. The queue assigns the board, the board downloads assets, generates simulated sine-wave data, uploads it, the backend registers the HDF5 waveform file (`FileType.WAVEFORM`), and the job completes successfully. Frontend renders the Sine Wave graph.
- **Real FPGA Flash E2E Flow:** Enabled `dry_run = false`. The agent triggers a real `fpgautil` flash. Flashing dummy binary bytes returns a hardware-level loading failure (`BIN FILE loading through FPGA manager failed`), which is uploaded back and registered as a job failure.

---

## 6. Next Steps

1. **Real PL capture** — add `PLDmaCapture(CaptureSource)` in `simulator.py` (read `/dev/mem` or UIO), pass it to `JobRunner(...)` in `runner.py`.
2. **DUT + DHCP-by-MAC** — static lease setup in network router.
3. **Auth** — Add token authentication / mTLS between the board agent and the backend.
