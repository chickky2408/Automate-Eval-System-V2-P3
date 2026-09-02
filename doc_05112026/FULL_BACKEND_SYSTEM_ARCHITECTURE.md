# เอกสารสถาปัตยกรรมระบบหลังบ้าน (Full Backend System Architecture)

## V2 Central Management Platform & FPGA Interface Node

**วันที่จัดทำ:** 26 สิงหาคม 2026
**เวอร์ชัน:** 2.0 (Production Architecture)
**ขอบเขต:** สถาปัตยกรรม Backend ทั้งหมดของระบบ (Central Server + Edge FPGA Agent)

---

## 1. บทนำและวัตถุประสงค์ (Executive Summary)

ระบบ **Automate Evaluation System (Eval System)** เป็นแพลตฟอร์มทดสอบและประเมินผลชิป / ฮาร์ดแวร์แบบอัตโนมัติ (Automated Silicon & Hardware Evaluation Platform) ประกอบด้วย 2 ส่วนประกอบหลักในฝั่ง Backend:

1. **Central Management Server (V2 Backend):** พัฒนาด้วย **FastAPI**, **PostgreSQL**, และ **SQLAlchemy Async** ทำหน้าที่เป็นศูนย์กลางจัดการคิวงาน (Job Dispatcher), จัดการสถานะบอร์ด (Board Fleet Management), รับและจัดเก็บไฟล์ผลลัพธ์ (Artifact Repository), และให้บริการ WebSSH Proxy สำหรับควบคุมบอร์ดทางไกล
2. **FPGA Edge Interface (Board Agent Daemon):** พัฒนาด้วย **FastAPI Daemon (Root Privilege)** บนระบบปฏิบัติการ **PetaLinux (Linux PS)** เชื่อมต่อกับวงจร **FPGA PL** ควบคุม AXI DMA Scatter-Gather Ring Buffer, สั่ง Flash Bitstream, ยิงชุดคำสั่ง Test Vectors ไปยัง DUT (Device Under Test), ประมวลผลแปลงผลลัพธ์ที่ Edge (`.vcd`, `.h5`, `.csv`), และรองรับ **Standalone Mode** ทำงานได้โดยไม่ต้องต่อเน็ต

---

## 2. แผนผังสถาปัตยกรรม Backend รวมทั้งระบบ (Master System Architecture)

```mermaid
flowchart TB
    subgraph Client_Layer ["🌐 Presentation & Remote Access"]
        UI["React Frontend Dashboard (Vite / Next.js)"]
        SSH_Client["Xterm.js Terminal Client"]
        Local_UI["KV/KR Local WebApp (Port 8000 WebUI)"]
        CLI_Client["cURL / Local CLI Tool"]
    end

    subgraph Central_Backend ["🖥️ Central Management Platform (V2 Backend - FastAPI)"]
        direction TB
        Router_Main["API Gateway & Router Ingress\n(/api/jobs, /api/boards, /api/files, /v1/upload)"]
    
        subgraph Core_Services ["Core Backend Services"]
            JQ["Job Queue Service (Worker Loop)"]
            BM["Board Manager & Heartbeat Registry"]
            Watchdog["Board Watchdog (15s Sweep / 30s Timeout)"]
            FileStore["File Store & Artifact Extractor"]
            SSHProxy["WebSSH Proxy (Paramiko Keepalive Tunnel)"]
        end
    
        subgraph Data_Layer ["Data Persistence"]
            DB[("PostgreSQL\n(Jobs, Results, Boards, Files)")]
            FS_Store[("Artifact File Storage\n(/uploads/WAVEFORM, REPORT, etc.)")]
        end
    end

    subgraph Edge_Backend ["⚡ FPGA Node Backend (PetaLinux PS - Root Daemon)"]
        direction TB
        Agent_API["Board Agent FastAPI Daemon (Port 8000)"]
    
        subgraph Agent_Core ["Agent Core Modules"]
            Runner["Job Runner Engine (busy lock & pipeline)"]
            Client["Backend HTTPX Client (Heartbeat & Chunked Uploader)"]
            ConvEngine["Edge Streaming Conversion Engine\n(bin2vcd, bin2h5, bin2csv)"]
            BundlePacker["Atomic Bundle Packer (.tar.gz)"]
            FpgaCtrl["FPGA Controller (xmutil / fpgautil)"]
            ResetMgr["Hardware Reset Controller (0xA0020000 / GPIO)"]
        end

        subgraph Storage_Edge ["Edge Storage"]
            SD_Storage[("/mnt/sdcard/eval_standalone/\n(Sync-Ready Layout)")]
        end
    end

    subgraph Hardware_PL ["🔌 FPGA PL Hardware Layer"]
        AXI_DMA["AXI DMA Controller (0xA0000000)"]
        BD_Ring["Scatter-Gather BD Ring (0x7F000000)"]
        DDR_Buffer["High-Speed Sample Memory (0x800000000)"]
        DUT["DUT (Device Under Test - CML / SPI / Custom)"]
    end

    %% Client to Central
    UI <--> Router_Main
    SSH_Client <--> SSHProxy
    Local_UI <--> Agent_API
    CLI_Client <--> Agent_API

    %% Central Internal
    Router_Main <--> Core_Services
    Core_Services <--> DB
    Core_Services <--> FS_Store

    %% Central to Edge Interconnect
    BM -- "1. Dispatch Job (POST /execute)" --> Agent_API
    Watchdog -- "Reboot Trigger (POST /system/reboot)" --> Agent_API
    Client -- "2. Heartbeat (POST /api/agent/register Every 15s)" --> BM
    BundlePacker -- "3. Chunked Upload (.tar.gz)" --> Router_Main
    SSHProxy <== "Paramiko SSH Tunnel (Port 22)" ==> Agent_API

    %% Edge Internal
    Agent_API <--> Runner
    Runner --> FpgaCtrl
    Runner --> ResetMgr
    Runner --> ConvEngine
    ConvEngine --> BundlePacker
    ConvEngine --> SD_Storage

    %% Edge to PL
    FpgaCtrl --> Hardware_PL
    ResetMgr --> Hardware_PL
    Runner --> AXI_DMA
    AXI_DMA <--> BD_Ring
    AXI_DMA <--> DDR_Buffer
    Hardware_PL <--> DUT
```

---

## 3. แผนผังลำดับการทำงานสมบูรณ์ (End-to-End Execution Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor User as Engineer / Frontend
    participant V2_BE as V2 Central Backend
    participant DB as PostgreSQL
    participant V2_FS as V2 File Storage
    participant Agent as Board Agent (PetaLinux)
    participant PL as FPGA PL (DMA & Registers)
    participant DUT as DUT (Device Under Test)

    Note over User,Agent: 🟢 Phase 1: การลงทะเบียนและสถานะบอร์ด (Heartbeat Loop)
    loop Every 15 Seconds
        Agent->>V2_BE: POST /api/agent/register {board_id, ip, mac, cpu_temp, fpga_status}
        V2_BE->>DB: UPSERT board_status (state='online', last_seen=now())
        V2_BE-->>Agent: 200 OK (Keepalive ACK)
    end

    Note over User,Agent: 🔵 Phase 2: การสั่งงานทดสอบ (Job Dispatch)
    User->>V2_BE: POST /api/jobs {test_case_id, target_board_id, test_vector_file_id, bitstream_file_id}
    V2_BE->>DB: INSERT INTO jobs (status='pending'), results (status='pending')
    V2_BE->>DB: UPDATE board_status SET state='busy' WHERE board_id='kr260-01'
    V2_BE->>Agent: POST http://{ip}:8000/execute {job_id, result_id, test_vector_url, bitstream_url}
    Agent-->>V2_BE: 200 OK {"accepted": true} (Agent starts Background Worker)

    Note over Agent,DUT: 🟣 Phase 3: การทำงานบนฮาร์ดแวร์จริง (Hardware Execution)
    par Download Assets
        Agent->>V2_BE: GET /api/files/{bitstream_id}/content
        V2_BE-->>Agent: Bitstream Binary Stream
        Agent->>V2_BE: GET /api/files/{vector_id}/content
        V2_BE-->>Agent: Test Vector Binary Stream
    end
  
    Agent->>PL: Flash FPGA via fpgautil/xmutil
    Agent->>PL: Setup AXI DMA S2MM BD Ring (0x7F000000) & Arm DMA (0xA0000000)
    Agent->>PL: Write Test Vector to Control Registers (0xA0020000)
    PL->>DUT: Drive Stimulus Signals (Clock, Data, Trigger)
    DUT-->>PL: High-Speed Output Response
    PL->>PL: Stream Samples into DDR RAM (0x800000000) via AXI DMA

    Note over Agent,V2_BE: 🟠 Phase 4: การประมวลผลที่ Edge & ส่งมอบผลลัพธ์ (Edge Processing & Upload)
    Agent->>Agent: Read DMA Buffer to raw_capture.bin
    par Edge Multi-Format Streaming Conversion
        Agent->>Agent: bin2vcd.py ➔ waveform.vcd (Logic Analyzer Trace)
        Agent->>Agent: bin2h5.py ➔ capture.h5 (High-density Analog Raw Dataset)
        Agent->>Agent: bin2csv.py ➔ summary.csv (Pass/Fail & Metrics)
    end
    Agent->>Agent: Pack into run_{result_id}_bundle.tar.gz + manifest.json
  
    loop Chunked Upload Protocol
        Agent->>V2_BE: POST /v1/upload/init {upload_id, target_filename, part_size}
        Agent->>V2_BE: POST /v1/upload/part (Binary Chunks with Offset)
        Agent->>V2_BE: POST /v1/upload/complete {expected_size, checksum}
    end

    V2_BE->>V2_FS: Extract .tar.gz ➔ Save individual files (.vcd, .h5, .csv)
    V2_BE->>DB: Register FileORM records & Update ResultORM (status='completed', passed=true)
    V2_BE->>DB: UPDATE board_status SET state='online'
    V2_BE-->>User: WebSocket Broadcast: JOB_COMPLETED & Results Ready
```

---

## 4. โครงสร้างโมเดลฐานข้อมูล (Database Schema & ORM Relationships)

```mermaid
erDiagram
    BOARDS ||--o{ BOARD_STATUS : "has current telemetry"
    BOARDS ||--o{ JOBS : "assigned to"
    TEST_CASES ||--o{ JOBS : "defines specification"
    RUN_SETS ||--o{ TEST_CASES : "groups"
    JOBS ||--|| RESULTS : "produces"
    RESULTS ||--o{ FILES : "owns artifacts"
    USERS ||--o{ JOBS : "creates"

    BOARDS {
        varchar(36) id PK
        varchar(100) name
        varchar(50) model "KR260 / KV260 / Zybo"
        varchar(45) ip_address
        varchar(17) mac_address
        varchar(50) agent_version
        timestamp created_at
    }

    BOARD_STATUS {
        varchar(36) board_id PK, FK
        enum state "online | busy | offline | error | quarantined"
        varchar(36) current_job_id
        float cpu_temperature
        float memory_used_percent
        boolean fpga_configured
        timestamp last_heartbeat
    }

    JOBS {
        varchar(36) id PK
        varchar(100) name
        varchar(36) test_case_id FK
        varchar(36) target_board_id FK
        enum status "pending | configuring | running | completed | error | cancelled"
        json parameters
        timestamp created_at
        timestamp completed_at
    }

    RESULTS {
        varchar(36) id PK
        varchar(36) job_id FK
        boolean passed
        float duration_seconds
        json metrics_summary "peak_voltage, freq, eye_margin"
        text error_message
        timestamp created_at
        timestamp completed_at
    }

    FILES {
        varchar(36) id PK
        varchar(36) result_id FK
        enum file_type "WAVEFORM | REPORT | LOG | SCRIPT | OTHER"
        varchar(255) file_path
        varchar(100) mime_type
        bigint file_size_bytes
        varchar(64) sha256_hash
        timestamp created_at
    }
```

---

## 5. กลยุทธ์การกู้คืนข้อผิดพลาดและการทำงานของ Watchdog (Fault Recovery State Machine)

```mermaid
stateDiagram-v2
    [*] --> Idle_Online: Board Registered (Heartbeat Active)
  
    Idle_Online --> Busy_Executing: Job Dispatched (POST /execute)
  
    state Busy_Executing {
        [*] --> Flashing_FPGA
        Flashing_FPGA --> DMA_Running: Bitstream Ready
        DMA_Running --> Edge_Converting: Capture Complete
        Edge_Converting --> Uploading_Bundle: Artifacts Ready
        Uploading_Bundle --> [*]
    }
  
    Busy_Executing --> Idle_Online: Execution Success (200 OK & Upload Done)
  
    Busy_Executing --> Hardware_Fault: DMA Hang / Timeout (>60s) / Bus Error
    Idle_Online --> Stale_Offline: Missed Heartbeat (>30s)
  
    state Hardware_Fault {
        [*] --> Force_Reboot_Triggered
        Force_Reboot_Triggered --> Cooldown_Timer: POST /system/reboot Sent
        Cooldown_Timer --> Waiting_For_Rebirth: Lock State for 35-45s
    }
  
    Waiting_For_Rebirth --> Idle_Online: New Registration Heartbeat Received
    Waiting_For_Rebirth --> Quarantined: Reboot Failed (>3 attempts)
    Stale_Offline --> Idle_Online: Heartbeat Resumed
```

---

## 6. สเปกรายละเอียด API สำคัญ (Key Backend API Specifications)

### 6.1 V2 Central Platform Endpoints


| Endpoint                       | Method | Role                                             | Request / Response Schema                                                 |
| :------------------------------- | :------: | :------------------------------------------------- | :-------------------------------------------------------------------------- |
| `/api/agent/register`          | `POST` | รับ Heartbeat จากบอร์ด Agent          | `{"board_id": str, "mac": str, "ip": str, "metrics": {...}}` ➔ `200 OK`  |
| `/api/jobs`                    | `POST` | สร้างงานทดสอบใหม่เข้าคิว | `{"test_case_id": str, "board_id": str, "params": {}}` ➔ `201 Created`   |
| `/v1/upload/init`              | `POST` | เริ่มต้น Chunked Upload Session          | `{"upload_id": str, "part_size_bytes": int, "filename": str}` ➔ `200 OK` |
| `/v1/upload/part`              | `POST` | ส่งข้อมูลก้อน Binary (.tar.gz part) | Binary Payload with Query`upload_id` & `part_number`                      |
| `/v1/upload/complete`          | `POST` | ปิด Upload, แตกไฟล์ & ผูก DB        | `{"expected_size": int, "expected_parts": int}` ➔ `200 OK`               |
| `/api/boards/{id}/terminal/ws` |  `WS`  | WebSSH WebSocket Proxy                           | Paramiko SSH Tunnel to Board Port 22                                      |

### 6.2 FPGA Board Agent Endpoints (Port 8000)


| Endpoint         | Method | Role                                                     | รายละเอียด                                                                       |
| :----------------- | :------: | :--------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| `/health`        | `GET` | Health check & Telemetry                                 | คืนค่า CPU temp, RAM usage, fpga_status, busy flag                                   |
| `/execute`       | `POST` | สั่งเริ่มรันงานทดสอบ                 | รองรับทั้งโหมด V2 (`bitstream_url`) และ Standalone (`test_vector_path`)   |
| `/system/reboot` | `POST` | สั่งรีบูตระบบปฏิบัติการ PetaLinux | รันคำสั่ง`sudo reboot` ภายใต้สิทธิ์ Root ทันที                   |
| `/` (WebUI)      | `GET` | Local WebApp Dashboard                                   | หน้าเว็บ Standalone สำหรับควบคุมและดูสถานะหน้าบอร์ด |

---

## 7. ข้อมูลทางเทคนิคฮาร์ดแวร์ (Hardware Physical Memory Map)


| ช่วงแอดเดรส (Physical Address) | ขนาด (Size) | วัตถุประสงค์ (Purpose)                                                   |
| :------------------------------------------ | :---------------: | :------------------------------------------------------------------------------------- |
| `0xA0000000 - 0xA000FFFF`                 |      64 KB      | **AXI DMA Engine Registers** (MM2S & S2MM Control, Status, BD Pointers)              |
| `0xA0020000 - 0xA002003F`                 |      64 B      | **Custom Control & Reset Registers** (DUT Stimulus Trigger, Reset Pin, Clocks)       |
| `0x7F000000 - 0x7FFFFFFF`                 |      16 MB      | **Scatter-Gather Buffer Descriptor (BD) Ring** ใน DDR RAM                          |
| `0x800000000 - 0x87FFFFFFF`               |      2 GB      | **High-Speed Sample Capture Buffer** (จองไว้รับข้อมูลจาก S2MM DMA) |
