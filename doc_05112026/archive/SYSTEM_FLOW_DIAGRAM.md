# 🌊 แผนภาพลำดับการทำงานของระบบ (System Flow Diagram)
**วันที่สกัดข้อมูล:** 11 พฤษภาคม 2026
**แหล่งข้อมูล:** วิเคราะห์ตรรกะจาก `services/job_queue.py` และ `services/board_manager.py`

เอกสารนี้แสดงขั้นตอนการไหลของข้อมูลและการตัดสินใจ (Logic Flow) ตั้งแต่เริ่มต้นจนสิ้นสุดกระบวนการทดสอบ

---

## 1. ผังกระบวนการทำงานหลัก (Main Workflow Flowchart)

```mermaid
flowchart TD
    %% Start/End Nodes
    Start(["เริ่ม: ผู้ใช้สั่งรันงานทดสอบ"])
    End(["จบงาน: ผู้ใช้ดูผลและ Waveform"])

    %% User Input
    Start --> Input["เลือกไฟล์ VCD และบอร์ดเป้าหมาย"]
    Input --> API["เรียก POST /api/jobs"]
    
    %% Backend Layer
    subgraph Backend_Process ["เลเยอร์หลังบ้าน (FastAPI)"]
        API --> Val{ตรวจสอบความถูกต้อง}
        Val -- ไม่ผ่าน --> Error(["แจ้งเตือน Error กลับหน้าจอ"])
        Val -- ผ่าน --> SavePending["บันทึก Job ลง DB สถานะ pending"]
        
        SavePending --> QueueMgr{เช็คคิวและบอร์ดว่าง?}
        
        QueueMgr -- ยังไม่พร้อม --> Wait[รอในคิวลำดับถัดไป]
        Wait --> QueueMgr
        
        QueueMgr -- พร้อม --> Lock["ล็อกบอร์ด: บันทึก busy ใน DB"]
        Lock --> StartExec["เปลี่ยนสถานะงานเป็น running"]
    end
    
    %% Hardware Layer
    subgraph Agent_Execution ["เลเยอร์ฮาร์ดแวร์ (Zybo Agent)"]
        StartExec --> PullFiles["Agent ดึงไฟล์ VCD/EROM จาก Server"]
        PullFiles --> RunTest["Agent เริ่มรันการทดสอบ"]
        RunTest --> Heartbeat["ส่ง Heartbeat รายงานความคืบหน้า"]
        Heartbeat -.-> WS["WebSocket อัปเดต UI Real-time"]
    end
    
    %% Result Processing
    RunTest --> Finish{รันเสร็จสิ้น?}
    Finish -- สำเร็จ --> SaveRes["บันทึกผลลงตาราง results"]
    Finish -- ผิดพลาด --> SaveFail["บันทึก Log ความผิดพลาดลง DB"]
    
    SaveRes --> Unlock["ปลดล็อกบอร์ด: เปลี่ยนสถานะเป็น online"]
    SaveFail --> Unlock
    
    Unlock --> End
```

---

## 2. รายละเอียดขั้นตอนทางเทคนิค (Technical Steps)

### ก. การรับเข้าข้อมูล (Input & Validation)
- ระบบตรวจสอบ `vcd_file_id` ว่ามีไฟล์จริงอยู่ในคลังหรือไม่
- ตรวจสอบ `target_board_id` ว่าบอร์ดออนไลน์อยู่หรือไม่ก่อนรับงานเข้าคิว

### ข. การจัดการคิว (Queue Management)
- งานที่รับเข้ามาจะอยู่ในสถานะ `pending` เสมอ
- `JobQueueService` จะวนลูปเช็คงานที่เก่าที่สุด (FIFO) และบอร์ดที่เหมาะสมเพื่อเริ่มงาน

### ค. การล็อกทรัพยากร (Resource Locking)
- **สำคัญมาก:** ระบบจะทำการ Update ตาราง `boards` ให้เป็น `busy` และผูก `current_job_id` ไว้ทันที เพื่อป้องกันไม่ให้งานอื่นเข้ามาแทรกในระหว่างประมวลผล

### ง. การสื่อสารแบบ Real-time (WebSocket Updates)
- ในขณะที่ Agent รันงาน จะมีการส่ง Progress (0-100%) กลับมา
- ข้อมูลนี้จะถูกส่งต่อไปยังผู้ใช้ทุกคนผ่าน WebSocket Topic: `JOB_PROGRESS`

### จ. การสรุปผลและคืนทรัพยากร (Finalization)
- เมื่อได้รับสัญญาณจาก Agent ว่า "Done" ระบบจะรีบทำการ `Unlock` บอร์ดใน Database ทันทีเพื่อให้คิวถัดไปเริ่มทำงานได้โดยไม่มี Delay

---
> **คำแนะนำ:** เอกสารนี้สามารถใช้ร่วมกับ `DATABASE_SCHEMA_FULL.md` เพื่อแสดงให้เห็นว่าข้อมูลถูกแก้ไขในตารางไหน ณ ขั้นตอนใดของ Flow นี้ครับ
