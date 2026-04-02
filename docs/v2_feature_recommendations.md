# Recommended Features for Evaluation System V2

Based on the analysis of the current V1 Python GUI (`GUI_uart_send.py`) and the proposed V2 "Standalone" architecture, here are recommended features to ensure feature parity and improve usability.

## 1. Advanced Job Queue & Automation (Parity with V1 Schedule)
The V1 GUI allows users to queue multiple VCD files with specific configurations. V2 should elevate this to a robust **Job Queue System**.
*   **Feature**: "Batch Execution Mode".
*   **Description**: Users can upload a batch of 10-20 VCD files. The system processes them sequentially.
*   **Enhancement**:
    *   **Priority Queue**: Ability to "Push to Top" an urgent test.
    *   **Auto-Retry**: Configurable retry logic for failed tests (already in V1, but make it smarter).
    *   **Scheduing**: "Run this batch at 2:00 AM".

## 2. Interactive Waveform & Result Viewer (Replacing `GUI_db_view.py`)
V1 requires a separate desktop app to view results. V2 should have this built-in.
*   **Feature**: "Web-Based Waveform Viewer".
*   **Description**: After a test run, click "View Results" to see a chart rendering the logic signals (from the DB/PicoScope).
*   **Tech**: Use libraries like `Recharts` or `Vis.js` in the React frontend.
*   **Benefits**: Instant feedback without transferring large log files to the PC.

## 3. Remote Hardware "Twin" (enhanced Debugging)
Since the user isn't physically connected via USB-UART, they lose the "feel" of what's connected.
*   **Feature**: "Live Hardware Topology Map".
*   **Description**: A visual diagram on the dashboard showing exactly which boards are detected (Logic, PWR, LF) and their status.
*   **Actionable**: Click a board in the diagram to "Ping" it or "Reset" it individually.

## 4. File Asset Manager
In V1, files are just on the PC's disk. In V2 (ARM), they need to be uploaded.
*   **Feature**: "Test Asset Repository".
*   **Description**: A dedicated File Manager view.
    *   **Categories**: `Simulations (.vcd)`, `Firmware (.mem)`, `Sequences (.flow)`.
    *   **Version Control**: Simple tagging (e.g., "Stable_v1", "Experimental").

## 5. "Direct Mode" Terminal
For debugging `vcd2protocol` or hardware issues.
*   **Feature**: "Web Console / REPL".
*   **Description**: A terminal-like interface in the browser that pipes commands directly to the underlying Python service.
*   **Usage**: Type `probe_ports` or `read_status` manually to check system health without running a full test.

## 6. Notification System (Webhook/Email)
*   **Feature**: "Remote Alerts".
*   **Description**: Since tests might take hours, send a notification (Slack/Email/Line) when a Batch is complete or if a critical error occurs (e.g., "Overheating" or "Device Unresponsive").

---

### Update to Prompt?
If you agree with these, I can update the `v0_ui_prompt.md` to explicitly request:
*   [ ] A **"Queue Manager"** side panel.
*   [ ] A **"Results"** tab with a placeholder for charts.
*   [ ] A **"File Manager"** view.



