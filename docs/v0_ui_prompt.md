# Prompt for v0.dev: Evaluation System V2 Web Interface

**Context**: You are building a modern, professional web interface for an industrial "Evaluation System V2". This system runs on an ARM embedded device connected to an FPGA and controls hardware test sequences for microchips.

**Goal**: Create a comprehensive Dashboard and Control Panel that replaces an old desktop GUI. It needs to look high-tech, reliable, and engineering-focused (Dark Mode preferred).

**Tech Stack**: React, Tailwind CSS, Lucide React Icons, Shadcn UI.

---

## Core Requirements & Layout

1.  **App Shell**:
    *   **Sidebar Navigation**: Fixed left sidebar with items: "Dashboard", "Job Queue", "Results & Viewer", "Hardware Topology", "Settings/OTA".
    *   **Header**:
        *   System Name: "EvalSys V2 // ARM-Standalone".
        *   Global Status Badges: "ARM: Online" (Green dot), "FPGA: Active" (Green dot), "Server: Connected" (Blue dot).
        *   Connection IP display (e.g., "host: 192.168.1.105").

2.  **Page: Dashboard (Overview)**:
    *   **Status Cards**: 3-4 cards showing system vitals (CPU Temp, RAM Usage, Uptime, Last Test Status).
    *   **Quick Actions**: Large buttons for "New Batch Run", "Emergency Stop".
    *   **Live Metrics**: A small line chart showing "Core Logic Voltage" over time (simulated).

3.  **Page: Job Queue (Advanced Automation)**:
    *   **Queue Management**: A list of pending test runs.
        *   Columns: Priority (High/Normal), Test Name (VCD File), Config Profile, Est. Duration, Status (Pending, Running, Done).
    *   **Controls**:
        *   "Add Job": Modal to upload VCD/MEM files and set parameters.
        *   "Reorder": Drag handle to change execution order.
        *   "Loop Mode": Toggle switch to repeat the queue indefinitely.
    *   **Active Job Highlight**: The top item should be expanded showing a progress bar and "Current Step: Uploading Stream...".

4.  **Page: Results & Viewer (Waveform Analysis)**:
    *   **Run History**: Sidebar list of completed tests (filterable by date/status).
    *   **Main View (Waveform)**:
        *   A large chart area mimicking a Logic Analyzer (Digital Signals).
        *   Channels: `CLK`, `MOSI`, `MISO`, `IRQ`, `GPIO_1`.
        *   Interactive: Zoom/Pan controls (just UI mockups).
    *   **Data Summary**: A tab below the chart showing "Packet Statistics" (Total Packets, CRC Errors, Throughput).
    *   **Export**: Buttons for "Download CSV", "Download Raw Dump".

## Design Aesthetic
*   **Theme**: Dark mode by default. Deep grays (`bg-zinc-950`), subtle borders (`border-zinc-800`).
*   **Accents**: Use electric blue or cyan for waveforms and active states.
*   **Typography**: Monospace font (like JetBrains Mono) for numerical data and logs.

## Specific Functionality to Mock
*   **Queue Simulation**: Show one job as "Running" with a pulsating status badge.
*   **Chart**: Use a dummy SVG or a library placeholder to render a cool-looking digital waveform.

---

**Please generate the React code for this complete dashboard shell. Prioritize the "Job Queue" and "Results Viewer" views.**

