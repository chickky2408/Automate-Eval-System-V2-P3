# 🔄 เจาะลึกเส้นทางการไหลของข้อมูล (End-to-End Data Flow In-Depth)
**วันที่สกัดข้อมูล:** 11 พฤษภาคม 2026
**แหล่งข้อมูล:** Source Code (Frontend, Backend Routers, Services, Database Models)

เอกสารนี้แสดงรายละเอียดทางเทคนิคของข้อมูลที่ไหลผ่านแต่ละเลเยอร์ ตั้งแต่การคลิกที่หน้าจอ จนถึงการประมวลผลบนฮาร์ดแวร์และการบันทึกผล

---

## 🚀 ขั้นตอนที่ 1: การสั่งงานจากหน้าบ้าน (Frontend Entry)
เมื่อผู้ใช้กดปุ่ม **"Run Test"** บนหน้า Dashboard หรือ Job Manager

1.  **UI Component:** `Dashboard.jsx` หรือ `JobCreateModal.jsx` รวบรวมข้อมูลจากฟอร์ม
2.  **Service Call:** เรียกฟังก์ชัน `createJob(payload)` ใน `frontend/src/services/api.js`
3.  **Communication:** ส่งคำสั่งผ่าน HTTP โปรโตคอล:
    - **Method:** `POST`
    - **URL:** `/api/jobs`
    - **Payload (JSON):**
      ```json
      {
        "name": "Validation_Project_v1",
        "vcd_file_id": "8a7b9c...",
        "target_board_id": "zybo_01",
        "priority": 10
      }
      ```

---

## ⚙️ ขั้นตอนที่ 2: การประมวลผลที่หลังบ้าน (Backend Orchestration)
เมื่อ FastAPI ได้รับ Request ที่ Endpoint `/api/jobs`

1.  **Router Layer (`routers/jobs.py`):**
    - รับ JSON และแปลงเป็น Pydantic Model (`JobCreate`) เพื่อทำ Validation
    - เรียกใช้ `JobQueueService.add_job()`
2.  **Service Layer (`services/job_queue.py`):**
    - ตรวจสอบสิทธิ์และทรัพยากร (เช่น ไฟล์ VCD มีอยู่จริงไหม)
    - สร้าง Instance ของ `JobORM`
3.  **Database Persistence:**
    - **Action:** `db.add(new_job)` -> `await db.commit()`
    - **Result:** ข้อมูลถูกบันทึกลงตาราง `jobs` (สถานะ = `pending`) และ `job_files`
4.  **Real-time Notification:**
    - ส่งสัญญาณผ่าน **WebSocket** (`ws_manager.broadcast`) หัวข้อ `JOB_CREATED` เพื่อให้หน้าจอทุกเครื่องอัปเดตรายการงานทันที

---

## 🤖 ขั้นตอนที่ 3: การจ่ายงานและล็อกบอร์ด (Dispatching & Locking)
`JobQueueService` ทำงานเป็น Background Task เพื่อวนลูปเช็คคิว

1.  **Board Selection:** ตรวจสอบตาราง `boards` หาบอร์ดที่ `state = 'online'`
2.  **Concurrency Control (Locking):**
    - **SQL Action:** `UPDATE boards SET state='busy', current_job_id='job_id' WHERE id='zybo_01'`
    - **Logic:** ป้องกันไม่ให้งานอื่นเข้ามาแย่งใช้บอร์ดเดียวกัน
3.  **Instruction Dispatch:** 
    - ส่งสัญญาณ HTTP หรือ WebSocket ไปยัง **Hardware Agent** (ที่รันอยู่บน Zybo) เพื่อบอกให้เริ่มโหลดไฟล์
    - อัปเดตสถานะงาน: `UPDATE jobs SET state='configuring'`

---

## 🔌 ขั้นตอนที่ 4: การทำงานบนฮาร์ดแวร์ (Hardware Execution)
Hardware Agent บนบอร์ด Zybo ดำเนินการตามขั้นตอน

1.  **Asset Pull:** Agent เรียก `GET /api/files/download/{id}` เพื่อดึงไฟล์ VCD/EROM มาเก็บใน Local Memory ของบอร์ด
2.  **Execution:** เริ่มรันสัญญาณทดสอบและตรวจจับเอาต์พุตจาก DUT
3.  **Telemetry Feed:** Agent ส่ง Heartbeat กลับมาที่ `POST /api/agent/heartbeat` ทุก 5 วินาที
    - **Update DB:** อัปเดตตาราง `board_status` (Temp, Load) และตาราง `jobs` (Progress %)
    - **Frontend:** ผู้ใช้จะเห็น Progress Bar ขยับแบบ Real-time

---

## 📊 ขั้นตอนที่ 5: การบันทึกผลลัพธ์ (Final Result Storage)
เมื่อ Agent ทำงานเสร็จสิ้น

1.  **Result Upload:** Agent ส่งผลสรุปและไฟล์ Waveform กลับมาที่ `POST /api/files/upload/result`
2.  **Database Finalization:**
    - **INSERT:** บันทึกข้อมูลลงตาราง `results` (เก็บบันทึก Pass/Fail, Metrics JSON)
    - **UPDATE:** เปลี่ยนสถานะงานในตาราง `jobs` เป็น `completed` และบันทึก `completed_at`
    - **UNLOCK:** เปลี่ยนสถานะบอร์ดในตาราง `boards` กลับเป็น `online` เพื่อรับงานถัดไป
3.  **Waveform Processing:** เก็บไฟล์ HDF5 ลงใน Storage และบันทึก Path ลงใน DB เพื่อให้ Frontend เรียกดูผ่าน `getResultWaveform()`

---
**สรุปหัวใจของระบบ:** 
ข้อมูลจะมีการ Sync กัน 3 ทางเสมอ (**Database** <-> **Memory State** <-> **WebSocket**) เพื่อให้มั่นใจว่าสิ่งที่ผู้ใช้เห็นบนหน้าจอ คือสถานะจริงของ Hardware ในวินาทีนั้นครับ
