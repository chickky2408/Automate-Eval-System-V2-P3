# Evaluation System V2: User Interface Specification

**Version**: 1.0
**Date**: 2026-01-08
**Status**: Draft

## 1. Introduction
This document outlines the functional and design requirements for the **Evaluation System V2 Web Interface**. Unlike the PC-centric V1 (Python/Tkinter), V2 interacts with a standalone ARM-based test unit via a web browser.

## 2. System Architecture
*   **Platform**: Web Application (React + Tailwind CSS).
*   **Host**: ARM Cortex-A Embedded Unit (serving the frontend).
*   **Connectivity**: Ethernet (TCP/IP).
*   **Backend Communication**: REST API / WebSockets (for live logic streams).

## 3. UI/UX Design Guidelines
*   **Theme**: "**Engineering Dark**" – High contrast, dark backgrounds (`#09090b`), electric blue accents (`#3b82f6`).
*   **Layout**: Fixed sidebar navigation for quick access to distinct modules.
*   **Components**: Use **Shadcn UI** (Radix Primitives) for accessible, robust interaction.
*   **Responsiveness**: Optimized for Desktop (1920x1080) but functional on Tablet.

## 4. Feature Specifications

### 4.1. Dashboard (Overview)
*   **Objective**: Provide at-a-glance system health monitoring.
*   **Key Metrics**:
    *   CPU/RAM Load (Critical for ARM performance).
    *   Core Voltage / Current (Telemetry from PWR board).
    *   Active Connection IP.
*   **Actions**: System Reboot, Emergency Stop.

### 4.2. Advanced Job Queue (Automation)
*   **Objective**: Automate sequential test execution (Parity with V1 Schedule).
*   **Features**:
    *   **Batch Upload**: Drag-and-drop multiple `.vcd` files.
    *   **Priority Management**: Drag rows to reorder execution priority.
    *   **Loop Mode**: Toggle to repeat the entire list indefinitely (Stress Testing).
    *   **State Tracking**:
        *   `PENDING`: Waiting in queue.
        *   `RUNNING`: Currently executing (Show Progress Bar).
        *   `DONE`: Completed successfully.
        *   `FAILED`: Error occurred (Auto-retry logic applicable).

### 4.3. Result Viewer (Analysis)
*   **Objective**: Visualize logic signals without external tools (replacing PicoScope app).
*   **Features**:
    *   **Interactive Waveform**: A canvas rendering digital signals (`CLK`, `MOSI`, `IRQ`, `GPIO`).
        *   [Zoom In/Out] on specific timeframes.
        *   [Cursor/Ruler] to measure timing deltas (µs/ns).
    *   **Protocol Decoding**: Overlay decoded values (e.g., `SPI: 0xA5`) on the waveform.
    *   **Export**: Download as `.csv` (Table) or `.vcd` (Raw Dump).

### 4.5. Test Asset Manager
*   **Objective**: Manage files stored on the ARM device.
*   **Features**:
    *   Upload/Delete `.vcd` simulations and `.mem` firmware images.
    *   Organize assets into folders (e.g., "Stable", "Drafts").

## 5. Technical Stack Recommendations
*   **Frontend**: React, Vite, Tailwind CSS.
*   **Charts**: Recharts (for stats) or Vis.js (for timelines).
*   **Icons**: Lucide React.
*   **State Management**: Zustand or React Query.
