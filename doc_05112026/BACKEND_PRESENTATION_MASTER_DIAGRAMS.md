# เอกสารนำเสนอสถาปัตยกรรมระบบหลังบ้านฉบับสมบูรณ์และละเอียดที่สุด
## (Master Backend System Architecture Specification for Presentation)

**โครงการ:** SiliconCraft Automate Evaluation System Platform (V2 Platform & FPGA Edge Node)  
**วันที่จัดทำ:** 26 สิงหาคม 2026 | **สถานะ:** Official Master Presentation Blueprint

---

## 1. ผังรวมสถาปัตยกรรมระดับละเอียดสูงสุด (Ultra-Detailed Master Backend Flowchart)

แผนผังแสดงโครงสร้างภายในของทุกโมดูล, Services, พอร์ตการเชื่อมต่อ, การแมปหน่วยความจำฮาร์ดแวร์ (Memory Map), ฐานข้อมูล และเส้นทางการไหลของข้อมูลแบบสมบูรณ์:

```mermaid
flowchart TB
    %% =========================================================================
    %% PRESENTATION & CLIENT LAYER
    %% =========================================================================
    subgraph Layer_Clients ["🌐 1. Presentation & External Access Layer"]
        direction LR
        FE_App["🖥️ React Dashboard UI\n(Vite / Tailwind / Zustand)\n• Waveform Scope (60fps Canvas)\n• Board Management & Fleet\n• Artifacts Download & Tolerances"]
        WebSSH_Term["💻 WebSSH Terminal (xterm.js)\n• Direct Linux Console Proxy\n• Live Telemetry Gauge"]
        Local_WebUI["📱 KV/KR Local WebApp\n(Port 8000 WebUI - Standalone)"]
        CLI_Curl["⌨️ Local CLI / cURL API\n(Direct LAN Automation)"]
    end

    %% =========================================================================
    %% V2 CENTRAL PLATFORM BACKEND
    %% =========================================================================
    subgraph Central_Platform ["🏢 2. V2 Central Management Server (FastAPI Backend - Port 8000)"]
        direction TB
        
        subgraph Ingress_Routers ["API Ingress & Routers (/api)"]
            R_Boards["routers/boards.py\n• Board CRUD\n• WebSSH Proxy\n• Measurements"]
            R_Jobs["routers/jobs.py\n• Create/Cancel Jobs\n• Priority Queue"]
            R_Upload["routers/agent_results.py\n• /v1/upload/init|part|complete\n• /v1/upload/stream (LZ4)"]
            R_Files["routers/files.py\n• Bitstreams & Vectors Library"]
            R_WS["routers/ws.py\n• Real-Time Broadcast\n(Job/Board State)"]
        end

        subgraph Core_Engine_Services ["Core Background Engines & Services"]
            direction TB
            JobQueue["⚙️ JobQueueService (services/job_queue.py)\n• Worker Loop (_execute_target)\n• State Transition (pending ➔ running ➔ done)\n• Board Assignment Algorithm"]
            BoardManager["📡 BoardManager & Watchdog (services/board_manager.py)\n• Heartbeat Registry (15s Window)\n• Auto-Watchdog (30s Timeout Check)\n• Force Reboot Dispatcher"]
            FileStore["📁 FileStoreService (services/file_store.py)\n• SHA-256 Checksum Validator\n• Directory Manager (uploads/WAVEFORM, REPORT)"]
            WaveformEngine["📈 WaveformEngine (services/waveform_file.py)\n• HDF5 Fast Slicer (raw dataset)\n• Server-Side VCD Converter (Multi-threaded)"]
            SSHProxyServer["🔒 WebSSH Proxy Service\n• Paramiko Keepalive Tunnel (Port 22)\n• Incremental UTF-8 Decoder"]
        end

        subgraph Central_Persistence ["Data Storage & Persistence"]
            DB_Postgres[("🗄️ PostgreSQL Database\n• boards & board_status\n• jobs & test_cases\n• results & files")]
            Disk_Storage[("💾 High-Speed Storage (NVMe SSD)\n• uploads/WAVEFORM/{year}/{month}/*.h5\n• uploads/REPORT/*.csv\n• uploads/LOG/*.log")]
        end

        Ingress_Routers <--> Core_Engine_Services
        Core_Engine_Services <--> DB_Postgres
        Core_Engine_Services <--> Disk_Storage
    end

    %% =========================================================================
    %% TRANSPORT & NETWORK INTERCONNECT
    %% =========================================================================
    subgraph Transport_Layer ["🌐 3. High-Speed Transport Layer (Gigabit Ethernet 1 Gbps / SFP+)"]
        direction LR
        REST_Control["HTTP/1.1 REST Control\n• POST /execute\n• POST /system/reboot\n• POST /api/agent/register"]
        LZ4_Stream["🚀 High-Speed LZ4 Binary Stream\n• 615.9 MB/s Compression\n• ~3-5s for 1.5 GB\n• Chunked Transfer Encoding"]
        SSH_TCP["🔐 SSH Protocol Tunnel\n• TCP Port 22 (Keepalive 10s)"]
    end

    %% =========================================================================
    %% FPGA INTERFACE EDGE NODE
    %% =========================================================================
    subgraph FPGA_Edge_Node ["⚡ 4. FPGA Interface Edge Node (KR260 / KV260 / Zybo)"]
        direction TB

        subgraph PetaLinux_PS ["Linux Processing System (PetaLinux PS - 4x ARM Cortex-A53)"]
            direction TB
            Agent_Daemon["🤖 board_agent (FastAPI Daemon - Root)\n• Port 8000 Listener\n• Lifespan Loop"]
            
            subgraph Agent_Internal_Modules ["Agent Internal Subsystems"]
                Runner["JobRunner Engine (runner.py)\n• Pipeline Lock (busy flag)\n• Asset Downloader & Cache\n• Test Sequence Controller"]
                HTTPX_Client["BackendClient (backend_client.py)\n• Heartbeat Loop (Every 15s)\n• Telemetry Reporter\n• LZ4 Chunked Uploader"]
                LZ4_Engine["🚀 LZ4 Fast Compression Engine\n• lz4.frame (615.9 MB/s)\n• Direct RAM-to-Socket Streaming"]
                FpgaCtrl["FPGA Controller (hardware.py)\n• xmutil load / fpgautil -b\n• Bitstream Manager"]
                ResetCtrl["Hardware Reset Controller\n• 0xA0020000 devmem Pulse\n• GPIO Line Toggle"]
                Sensors["System Metrics (metrics.py)\n• Thermal (/sys/class/thermal)\n• RAM (/proc/meminfo)\n• FPGA Status"]
            end

            subgraph SD_Sync_Storage ["Local Edge Storage"]
                SD_Card[("💾 SD Card Storage\n/mnt/sdcard/eval_standalone/\n• pending_sync/ (manifest.json)\n• test_vectors/ & bitstreams/")]
            end

            Agent_Daemon <--> Agent_Internal_Modules
            Agent_Internal_Modules <--> SD_Sync_Storage
        end

        subgraph FPGA_PL_Hardware ["FPGA Programmable Logic (PL Hardware Layer)"]
            direction TB
            
            subgraph AXI_Subsystem ["AXI Memory & Control Subsystem"]
                AXI_DMA_Ctrl["📡 AXI DMA Engine Controller\n(Physical Addr: 0xA0000000)"]
                BD_Ring_Mem["📋 Scatter-Gather BD Ring\n(Physical Addr: 0x7F000000 - 16 MB)"]
                DDR_Sample_RAM["🧠 High-Speed DDR Sample Memory\n(Physical Addr: 0x800000000 - 2 GB)"]
                Control_Regs["🎛️ Custom Stimulus & Reset Registers\n(Physical Addr: 0xA0020000)"]
            end

            subgraph DUT_Interface ["DUT Physical Interface"]
                DUT_Device["🔌 DUT (Device Under Test)\n• CML Differential High-Speed\n• SPI / I2C / UART Bus\n• GPIO Control Pins"]
            end

            AXI_DMA_Ctrl <--> BD_Ring_Mem
            AXI_DMA_Ctrl <--> DDR_Sample_RAM
            Control_Regs --> DUT_Device
            DUT_Device <--> AXI_DMA_Ctrl
        end

        %% PS to PL Interconnect
        Runner -- "mmap /dev/mem" --> AXI_DMA_Ctrl
        Runner -- "mmap /dev/mem" --> Control_Regs
        FpgaCtrl -- "fpgautil / xmutil" --> FPGA_PL_Hardware
        ResetCtrl -- "devmem write" --> Control_Regs
        DDR_Sample_RAM -- "Zero-Copy RAM Read" --> LZ4_Engine
    end

    %% =========================================================================
    %% CROSS-LAYER CONNECTIONS
    %% =========================================================================
    FE_App <==> Ingress_Routers
    WebSSH_Term <==> SSHProxyServer
    Local_WebUI <==> Agent_Daemon
    CLI_Curl <==> Agent_Daemon

    Ingress_Routers <==> REST_Control <==> Agent_Daemon
    Ingress_Routers <==> LZ4_Stream <== LZ4_Engine
    SSHProxyServer <==> SSH_TCP <==> PetaLinux_PS
```

---

## 2. ลำดับการทำงานตั้งแต่เริ่มจนจบแยกตาม Service (Service-Level End-to-End Sequence Diagram)

แผนผัง Sequence Diagram แสดงการสื่อสารระหว่าง **Services ภายใน V2 Central Backend** และ **Subsystems ภายใน FPGA Board Agent** ทุกขั้นตอน:

```mermaid
sequenceDiagram
    autonumber
    actor Engineer as 🖥️ UI / Engineer
    box "🏢 V2 Central Management Platform (Server Backend)" #0f172a
        participant Router as API Gateway / Routers
        participant JobQueue as JobQueueService
        participant BoardMgr as BoardManager & Watchdog
        participant FileStore as FileStoreService
        participant WaveformSvc as WaveformEngine (H5/VCD)
        participant DB as PostgreSQL DB
    end

    box "⚡ FPGA Interface Edge Node (PetaLinux PS & PL)" #022c22
        participant AgentAPI as Board Agent (FastAPI)
        participant Runner as JobRunner Pipeline
        participant FpgaCtrl as FpgaController (PL Flash)
        participant LZ4Streamer as LZ4 Streamer Engine
        participant AXI_DMA as AXI DMA & Control Regs
        participant DUT as DUT (Device Under Test)
    end

    %% =========================================================================
    %% PHASE 1: HEARTBEAT
    %% =========================================================================
    Note over AgentAPI,BoardMgr: 🟢 Phase 1: การลงทะเบียนบอร์ด & Heartbeat Loop (ทุกๆ 15 วินาที)
    loop Every 15 Seconds
        AgentAPI->>Router: POST /api/agent/register {board_id: "kr260-01", ip: "192.168.1.111", metrics: {temp: 48C, ram: 32%}}
        Router->>BoardMgr: register_heartbeat(payload)
        BoardMgr->>DB: UPSERT INTO board_status SET state='online', last_heartbeat=NOW()
        BoardMgr-->>Router: Status OK
        Router-->>AgentAPI: 200 OK {"status": "registered"}
    end

    %% =========================================================================
    %% PHASE 2: JOB CREATION & DISPATCH
    %% =========================================================================
    Note over Engineer,Runner: 🔵 Phase 2: การสร้างงานและแจกจ่ายงาน (Job Dispatch via Services)
    Engineer->>Router: POST /api/jobs {test_case_id: "tc-101", target_board_id: "kr260-01", vector_id: "vec-01", bitstream_id: "bs-01"}
    Router->>DB: INSERT INTO jobs (status='pending'), results (status='pending')
    Router->>JobQueue: notify_new_job()
    Router-->>Engineer: 201 Created {"job_id": "job-101"}

    JobQueue->>JobQueue: Worker Loop ตรวจพบงาน pending + บอร์ด online
    JobQueue->>DB: UPDATE board_status SET state='busy', current_job_id='job-101'
    JobQueue->>BoardMgr: execute_job(board_id="kr260-01", job_id="job-101")
    BoardMgr->>AgentAPI: POST http://192.168.1.111:8000/execute {job_id: "job-101", result_id: "res-101", vector_id: "vec-01", bs_id: "bs-01"}
    AgentAPI->>Runner: spawn_job_execution(job_id, result_id)
    AgentAPI-->>BoardMgr: 200 OK {"accepted": true}
    JobQueue->>DB: UPDATE jobs SET status='running'

    %% =========================================================================
    %% PHASE 3: ASSET DOWNLOAD & HARDWARE DRIVING
    %% =========================================================================
    Note over Runner,DUT: 🟣 Phase 3: การรันบนฮาร์ดแวร์จริง (Asset Stream ➔ PL Flash ➔ DMA Capture)
    par Download Bitstream & Test Vector Assets
        Runner->>Router: GET /api/files/bs-01/content
        Router->>FileStore: read_file_stream("bs-01")
        FileStore-->>Runner: Bitstream Binary Stream
        Runner->>Router: GET /api/files/vec-01/content
        Router->>FileStore: read_file_stream("vec-01")
        FileStore-->>Runner: Test Vector Binary Stream
    end

    Runner->>FpgaCtrl: flash_bitstream("bs-01.bin")
    FpgaCtrl->>AXI_DMA: fpgautil -b / xmutil load (PL Ready)
    Runner->>AXI_DMA: Arm AXI DMA S2MM BD Ring (0x7F000000) & Control (0xA0000000)
    Runner->>AXI_DMA: Drive Test Vector to Registers (0xA0020000)
    AXI_DMA->>DUT: ส่งสัญญาณกระตุ้น (Clock, Data, Protocol Stimulus)
    DUT-->>AXI_DMA: สัญญาณตอบสนองความเร็วสูงจากชิป
    AXI_DMA->>AXI_DMA: Stream Samples 1.5 GB เข้าสู่ DDR RAM (0x800000000)

    %% =========================================================================
    %% PHASE 4: LZ4 STREAMING
    %% =========================================================================
    Note over Runner,WaveformSvc: 🟠 Phase 4: สตรีมมิ่งข้อมูลด้วย LZ4 Pipeline (~3.3 วินาที สำหรับ 1.5 GB)
    Runner->>LZ4Streamer: start_streaming(dma_buffer, chunk_size=16MB)
    Runner->>Router: POST /v1/upload/init {upload_id: "upl-101", target: "res-101.lz4"}
    
    loop Real-Time LZ4 Streaming (Zero Disk IO บนบอร์ด)
        LZ4Streamer->>LZ4Streamer: บีบอัดก้อน 16MB ใน RAM (615.9 MB/s เหลือ ~800 KB)
        LZ4Streamer->>Router: POST /v1/upload/part (Chunk Payload ผ่าน Gigabit LAN)
        Router->>FileStore: append_stream_chunk(upl_id, compressed_chunk)
    end
    
    Runner->>Router: POST /v1/upload/complete {upload_id: "upl-101", sha256: "..."}
    Runner->>Router: POST /api/boards/kr260-01/measurements {passed: true, duration: 3.45s, metrics: {...}}

    %% =========================================================================
    %% PHASE 5: SERVER INGESTION & DECODE
    %% =========================================================================
    Note over Router,Engineer: 🏁 Phase 5: การประมวลผลบนเซิร์ฟเวอร์ & อัปเดตสถานะสมบูรณ์
    Router->>WaveformSvc: process_uploaded_lz4("res-101.lz4")
    WaveformSvc->>WaveformSvc: Decompress LZ4 (3,200 MB/s) บน Server RAM
    par Generate Multi-Format Artifacts on Server
        WaveformSvc->>FileStore: save_hdf5("res-101.h5", dataset='raw')
        WaveformSvc->>FileStore: save_vcd_background("res-101.vcd")
    end
    FileStore->>DB: INSERT INTO files (file_type='WAVEFORM', path='res-101.h5')
    Router->>DB: UPDATE results SET status='completed', passed=true, duration_seconds=3.45
    Router->>DB: UPDATE jobs SET status='completed'
    BoardMgr->>DB: UPDATE board_status SET state='online', current_job_id=NULL (บอร์ดว่างพร้อมรับงานถัดไป!)
    Router-->>Engineer: WebSocket Broadcast: JOB_COMPLETED {result_id: "res-101", passed: true}
```

---

## 3. ผังท่อส่งข้อมูลในหน่วยความจำระดับ Zero-Disk Bottleneck (Data & Memory Pipeline)

แผนผังแสดงโครงสร้างการเคลื่อนที่ของข้อมูลตั้งแต่ระดับ Physical Memory ในชิป จนถึง Dashboard หน้าเว็บ โดย **ไม่ผ่านการเขียนไฟล์ดิบลง SD Card ของบอร์ด**:

```mermaid
flowchart LR
    subgraph Step1 ["1. PL Hardware Space"]
        DUT["DUT Pins"] --> AXI_DMA["AXI DMA Engine\n(0xA0000000)"]
        AXI_DMA --> DDR["Physical DDR RAM\n(0x800000000)\n1.5 GB Raw Data"]
    end

    subgraph Step2 ["2. PS Linux Kernel & User Space"]
        DDR -- "mmap /dev/mem\n(Circular Buffer 32MB)" --> CPU_Cache["ARM Cortex-A53\nCPU L1/L2 Cache"]
        CPU_Cache --> LZ4["LZ4 Compressor\n(615.9 MB/s)\nลดเหลือ ~80 MB"]
        LZ4 --> Socket_Buf["Linux TCP Socket Buffer"]
    end

    subgraph Step3 ["3. Network Transport"]
        Socket_Buf -- "Gigabit LAN (95 MB/s)\nใช้เวลา ~0.85s" --> Server_Socket["Server TCP Socket Buffer"]
    end

    subgraph Step4 ["4. Central Server RAM & Storage"]
        Server_Socket --> LZ4_Dec["Server LZ4 Decompressor\n(3,200 MB/s)"]
        LZ4_Dec --> Mem_Buf["Server Memory Buffer"]
        Mem_Buf --> H5["HDF5 Waveform (.h5)\n(Dataset 'raw')"]
        Mem_Buf --> VCD["VCD Logic Trace (.vcd)"]
        Mem_Buf --> CSV["Summary Metrics (.csv)"]
    end

    subgraph Step5 ["5. Web Presentation"]
        H5 --> WebGL["WebGL Scope Viewer (60fps)\n(HighPerformanceWaveformViewer)"]
        CSV --> Table["Pass/Fail Tolerances Table\n(MultiArtifactDownloadPanel)"]
    end
```

---

## 4. กลไกการจัดการข้อผิดพลาดและ Watchdog State Machine (Fault Recovery)

```mermaid
stateDiagram-v2
    [*] --> Online_Idle: Board Registered (Heartbeat Loop Every 15s)
    
    Online_Idle --> Busy_Executing: Job Dispatched via POST /execute
    
    state Busy_Executing {
        [*] --> Flashing_PL
        Flashing_PL --> DMA_Running: Bitstream Loaded
        DMA_Running --> LZ4_Streaming: Capture Complete
        LZ4_Streaming --> Ingestion_Complete: Upload Done
        Ingestion_Complete --> [*]
    }
    
    Busy_Executing --> Online_Idle: Success (200 OK & Result Saved)
    
    Busy_Executing --> Hardware_Lockup: DMA Bus Hang / Timeout (>60s) / Error
    Online_Idle --> Stale_Offline: Missed Heartbeat (>30s)
    
    state Hardware_Lockup {
        [*] --> Send_Force_Reboot: Backend Sends POST /system/reboot
        Send_Force_Reboot --> Cooldown_Lock: DB Sets state='offline'
        Cooldown_Lock --> Wait_Rebirth: Block Queue for 35-45 Seconds
    }
    
    Wait_Rebirth --> Online_Idle: New Register Heartbeat Received (Fresh State 100%)
    Wait_Rebirth --> Quarantined: Reboot Failed (>3 attempts)
    Stale_Offline --> Online_Idle: Heartbeat Recovered
```

---

## 5. ตารางสรุปจุดเด่นทางเทคนิคสำหรับใช้นำเสนอ (Key Presentation Highlights)

| หัวข้อ (Topic) | จุดเด่นของสถาปัตยกรรม (Architectural Highlight) | ประโยชน์เชิงวิศวกรรม (Engineering Benefit) |
| :--- | :--- | :--- |
| **1. Throughput & Speed** | ใช้ **LZ4 Streaming Pipeline (615.9 MB/s)** บีบอัดข้อมูล 1.5 GB เหลือ ~80 MB | ลดเวลาส่งข้อมูลจาก 16 วินาทีเหลือ **~3.3 วินาที** (เร็วขึ้นเกือบ 5 เท่า) |
| **2. Edge & Server Offloading** | ย้ายงานแปลง `.vcd` และ `.h5` มาทำบน CPU Multi-core ของคอมกลาง | ลดเวลาติดสถานะ Busy ของบอร์ดจาก **3 ชั่วโมง เหลือเพียง ~4 วินาที** |
| **3. Hardware Safety & Lifespan** | สตรีมข้อมูลตรงจาก **DDR RAM ➔ Network** แบบ Zero-Copy | ป้องกันปัญหา **SD Card เสื่อมสภาพ** จากการเขียนไฟล์ดิบ 12+ GB ซ้ำๆ |
| **4. Dual Mode Operation** | รองรับทั้ง **V2 Connected Mode** (คิวงานกลาง) และ **Standalone Mode** (ออฟไลน์หน้างาน) | บอร์ดทำงานได้อย่างอิสระ บันทึกผลลง SD Card พร้อมรองรับการ Sync ย้อนหลัง |
| **5. Fault Recovery** | ระบบ **Force Board Reboot** + Watchdog Sweeper ทุก 15 วินาที พร้อม Cooldown 35s | คืนสภาวะ AXI Bus และ Physical Memory ให้สะอาด 100% ก่อนเริ่มงานใหม่ |
| **6. Interactive Web UI** | **WebGL/Canvas Waveform Scope (60fps)** พร้อม Dual Measurement Cursors ($X_1, X_2, \Delta t$) | วิเคราะห์สัญญาณความเร็วสูงและ Bus Decoder (Hex) ได้บนเบราว์เซอร์ทันที |
