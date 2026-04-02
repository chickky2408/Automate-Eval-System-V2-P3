# Evaluation System: V1 vs V2 Analysis

**Objective**: Understand the system architecture differences between the existing V1 deployment and the planned V2 system.

> [!WARNING]
> Access to `Eval_system_V2.docx` was limited (binary format). This analysis is based on the V1 Codebase (`3-link v3/deployment`) and the V2 Architecture Diagram (`eva;_system_V2_08012026.drawio`).

## 1. System V1: PC-Centric UART Orchestrator
**Location**: `d:\siliconcraft\eval_system\3-link v3\3-link v3\deployment`

The V1 system is a host-driven test tool that orchestrates hardware boards over a serial link.

*   **Architecture**: "Tethered" design. PC does all the processing.
*   **Hardware Topology**:
    *   **Boards**: 3 Target Boards (LOGIC, PWR, LF) + 1 Programmer Board.
    *   **Connectivity**: Single UART Port (Daisy-chain or shared bus protocol).
*   **Software Stack**:
    *   `uart_send_core.py`: Main Orchestrator. Handles VCD parsing, packet generation, and serial transmission.
    *   `vcd2protocol.py`: Converts simulation VCD files into board-specific protocol streams.
    *   `serial_sender 3-link V2.py` (Programmer): Handles EROM/ULP flashing.
*   **Workflow**:
    1.  User provides VCD file on PC.
    2.  PC parses VCD -> Generates Streams.
    3.  PC sends streams to boards via UART in real-time.
    4.  Results logged to local SQLite (`runs.sqlite`).

## 2. System V2: Networked ARM + FPGA Standalone
**Source**: `eva;_system_V2_08012026.drawio`

The V2 system proposes a distributed, networked architecture where the intelligence moves to the "Edge" (the test unit itself).

*   **Architecture**: "Standalone Networked Appliance".
*   **Hardware Topology**:
    *   **New Core**: **ARM + FOGA (FPGA)**.
    *   **Connectivity**: Ethernet (TCP/IP) via a SWITCH HUB.
    *   **External Links**: Connects to "Server 43" and "PC".
*   **Key Shifts (Inferred from Diagram)**:
    *   **VCD Conversion on Device**: The diagram notes "* ถ้าหาก VCD to protocol converter อยู่ใน ARM ทำให้ระบบสามารถทำงานแบบ standalone ได้" (*If VCD converter is in ARM, the system can work standalone*).
    *   **Control Interface**: Uses "SSH to test unit" and "VNC" instead of a local Python GUI sending UART commands.
    *   **Data Handling**: Mentions "Main Database" (likely central) vs "tmp database" (on device).
    *   **OTA Server**: Adds Over-The-Air update capabilities.

## 3. Comparison Summary

| Feature | V1 (Current Code) | V2 (Proposed Diagram) |
| :--- | :--- | :--- |
| **Compute Location** | **PC Host** (Python Scripts) | **ARM Board** (Embedded Linux?) |
| **Protocol Generation** | PC generates frames (`vcd2protocol`) | ARM generates frames (Standalone) |
| **Connectivity** | USB-UART (Serial) | Ethernet (TCP/IP) |
| **User Interface** | PC GUI (`GUI_uart_send.py`) | VNC / Command Line / Web? |
| **Deployment** | Run script folder on PC | OTA Updates / SSH |
| **Focus** | Direct Hardware Control | Scalable Test Farm / Standalone Unit |

---
**Next Steps Recommendation**:
Since V2 implies porting the VCD parsing logic (`vcd2protocol.py`) to run on an ARM processor, the migration strategy should focus on:
1.  Decoupling `vcd2protocol.py` from the V1 UART Sender.
2.  Designing the ARM-side software (Python service or C++?).
3.  Defining the TCP/IP API between the User PC and the ARM Unit.
