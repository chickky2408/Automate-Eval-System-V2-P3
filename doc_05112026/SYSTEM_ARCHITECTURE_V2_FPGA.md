# สถาปัตยกรรมระบบทดสอบฮาร์ดแวร์แบบสมบูรณ์ (V2 Platform & FPGA Interface Architecture)

**วันที่จัดทำ:** 26 สิงหาคม 2026  
**สถานะ:** เอกสารทางการ (Official System Specification)  
**ขอบเขต:** V2 Central Platform (Server/HQ) ⟷ FPGA Interface (KR260/KV260/Zybo Board Agent & Standalone)

---

## 1. ภาพรวมสถาปัตยกรรมระบบ (System Architecture Overview)

ระบบถูกออกแบบให้ทำงานได้ **2 โหมดหลัก**:
1. **V2 Connected Mode (Centralized Control):** สั่งงานผ่าน Web UI กลาง, บริหารจัดการคิวงาน (Job Queue), แจกจ่ายงานไปยังบอร์ด FPGA หลายตัวพร้อมกัน, จัดเก็บ Waveform และแสดงผลกราฟ
2. **Standalone Mode (Autonomous Edge Execution):** บอร์ด FPGA สามารถรันงานทดสอบ บันทึกสัญญาณ และแปลงผลลัพธ์ได้ด้วยตัวเอง โดยสั่งงานผ่าน **Local WebApp บนบอร์ด (KV/KR Board WebUI)**, **cURL API ผ่าน LAN**, หรือ **Local CLI** พร้อมบันทึกผลลง SD Card และพร้อมรองรับการ Sync ย้อนหลัง

```mermaid
flowchart TB
    subgraph V2_Server ["🖥️ V2 Management Platform (Server / HQ)"]
        FE["React Frontend (Dashboard, Waveform Viewer, WebSSH)"]
        BE["FastAPI Backend (Job Queue, Board Manager, File Service)"]
        DB[("PostgreSQL Database")]
        Storage[("Extracted Artifacts Storage\n(/uploads/WAVEFORM, REPORT, etc.)")]
        
        FE <--> BE
        BE <--> DB
        BE --> Storage
    end

    subgraph Transport ["🌐 Network / LAN Transport Layer"]
        HTTP_API["HTTP REST API / WebSocket (Port 8000)"]
        SSH_TUNNEL["WebSSH Proxy (Paramiko Tunnel - Port 22)"]
        TAR_GZ["Atomic Bundle (.tar.gz) Chunked Upload"]
    end

    subgraph FPGA_Node ["⚡ FPGA Interface (KR260 / KV260 / Zybo)"]
        subgraph Software_Space ["Linux PS Space (PetaLinux / Ubuntu)"]
            Agent["board_agent (FastAPI Daemon - root)"]
            LocalUI["Local WebApp (Port 8000 WebUI)"]
            SDCard[("/mnt/sdcard/eval_standalone/\n(Sync-Ready Layout)")]
            Engine["Edge Conversion Engine\n(bin2vcd, bin2h5, bin2csv)"]
            Packer["Atomic Bundle Packer (.tar.gz)"]
        end

        subgraph Hardware_Space ["FPGA PL Space (Hardware Acceleration)"]
            DMA["AXI DMA Engine (S2MM Ring Buffer)"]
            Registers["Control / Reset Registers (0xA0020000)"]
            Bitstream["FPGA Bitstream (fpgautil / xmutil)"]
            DUT["DUT (Device Under Test)"]
        end

        LocalUI <--> Agent
        Agent <--> Engine
        Engine --> SDCard
        Engine --> Packer
        Agent --> Bitstream
        Agent --> Registers
        Agent --> DMA
        DMA <--> DUT
        Registers <--> DUT
    end

    BE <==> HTTP_API <==> Agent
    BE <==> SSH_TUNNEL <==> FPGA_Node
    Packer ==> TAR_GZ ==> BE
```

---

## 2. โครงสร้างการส่งข้อมูลด้วย LZ4 Streaming & Central Conversion Pipeline

```mermaid
flowchart LR
    subgraph Edge_FPGA ["⚡ FPGA Board (Edge)"]
        Raw["Raw DMA Stream (1.5 GB in RAM)"] --> LZ4["LZ4 Compressor (615.9 MB/s)\n(ใช้เวลา ~2.5s เหลือ 8-80 MB)"]
        Raw --> CSV["summary.csv (1s)\n(Pass/Fail & Metrics)"]
        LZ4 --> Socket["HTTP Chunked Streamer"]
    end

    subgraph Network ["🌐 Gigabit LAN (~1s)"]
        Socket --> Net["Compressed Stream (8-80 MB)"]
    end

    subgraph Central_Server ["🖥️ Central Platform (V2 Server)"]
        Net --> Decomp["LZ4 Fast Decompressor (3.2 GB/s)"]
        Decomp --> H5["HDF5 Waveform Engine (.h5)"]
        Decomp --> VCD["VCD Logic Analyzer (.vcd)"]
    end
```

---

## 3. วงจรการทำงานของคำสั่งทดสอบ (Test Vector Execution Flow)

1. **Direct Test Vector:** คนทำ Test Case เตรียมไฟล์ Binary Instruction สำเร็จรูป (ไม่ต้องแปลงจาก VCD)
2. **DMA Arming:** ตั้งค่า Scatter-Gather BD Ring บน Physical Memory
3. **Execution & Driving:** ยิงคำสั่งเข้า AXI Register / DMA Stream ไปยัง DUT
4. **Capture:** ดึงข้อมูลผ่าน S2MM Ring เข้าสู่ไฟล์ `.bin`
5. **Local Multi-Conversion:** แปลงเป็น `.vcd`, `.h5`, `.csv` ทันทีบนบอร์ด
6. **Delivery:**
   - **ถ้าต่อ V2:** ส่ง Atomic Bundle `.tar.gz` ผ่าน Chunked Uploader
   - **ถ้าเป็น Standalone:** บันทึกเก็บลง `/mnt/sdcard/eval_standalone/pending_sync/`

---

## 4. กลยุทธ์การกู้คืนข้อผิดพลาดระดับฮาร์ดแวร์ (Fault Recovery Strategy)

ระบบใช้แนวทาง **Force Board Reboot** ร่วมกับ Watchdog Sweeper:

| ลำดับ | เหตุการณ์ | การทำงานของระบบ |
| :---: | :--- | :--- |
| **1** | DMA Timeout / Bus Hang / DUT ไม่ตอบสนอง | Agent ส่งสถานะ `ERROR` หรือ Backend ตรวจพบ Timeout (> 60s) |
| **2** | Force Board Reboot Trigger | Backend ส่งคำสั่ง `POST /system/reboot` ไปยังบอร์ดทันที |
| **3** | Immediate State Lock | Backend ปรับสถานะบอร์ดในฐานข้อมูลเป็น `offline` และล็อก Cooldown 35-45s |
| **4** | Clean Restart & Rediscovery | บอร์ด PetaLinux บูตเสร็จ ยิง Heartbeat `POST /api/agent/register` กลับมา ระบบนำบอร์ดเข้าพร้อมรับคิวงานใหม่ 100% |
