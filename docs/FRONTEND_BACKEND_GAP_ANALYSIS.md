# Frontend vs Backend Feature Analysis

**Date:** 2026-03-06  
**Questions:**
1. มีการแจกจ่ายงานมีกี่แบบ (How many types of work/job types?)
2. มีอะไรบ้างที่ FE มีแต่ BE ยังไม่หรอกรับ หรือไม่มี API (What does the frontend have that the backend doesn't accept or doesn't have an API for?)

---

## 1. ประเภทของงาน (Job Types)

จากการวิเคราะห์โค้ด พบว่ามี **2 ประเภทของการแจกจ่ายงาน**:

### 1.1 Broadcast Jobs (งานแบบกระจาย)

**คำอธิบาย:** รันงานนี้บนทุกบอร์ดที่เลือกพร้อมกัน (Simultaneous Execution)

**Backend Implementation:**
- [`backend/routers/jobs.py`](backend/routers/jobs.py) - `POST /api/jobs`
- ใช้ `boards` list ใน payload
- มี `target_board_ids` (JSON) ใน schema ([`docs/03_DATABASE_SCHEMA.md:96`](docs/03_DATABASE_SCHEMA.md:96))
- **แต่ยังไม่ได้ implement** broadcast mode อย่างเต็ม

**Frontend Usage:**
- [`frontend/src/utils/apiEndpoints.js`](frontend/src/utils/apiEndpoints.js:36) - `boards` parameter ใน `JOB_CREATE`
- Frontend สามารถส่ง list ของ board IDs

---

### 1.2 Sequential Jobs (งานแบบเรียง)

**คำอธิบาย:** รันงานนี้บนบอร์ดแต่ละอันตามลำดับ (Sequential Execution)

**Backend Implementation:**
- [`backend/routers/jobs.py`](backend/routers/jobs.py) - `POST /api/jobs`
- ใช้ `target_board_id` (single board) หรือ `assigned_board_id`
- มี `queue_position` สำหรับจัดลำดับ

**Frontend Usage:**
- Frontend สามารถส่ง board ID เดียว หรือไม่ส่ง (auto-assign)

---

### 1.3 Test Jobs (งานทดสอบ)

**คำอธิบาย:** งานทดสอบด้วยไฟล์ VCD

**Backend Implementation:**
- [`backend/routers/jobs.py`](backend/routers/jobs.py) - `POST /api/jobs`
- ใช้ `vcd_file_id` และ `firmware_file_id` (FK ไป files table)
- สถานะงาน: pending → configuring → flashing → running → completed/failed

**Frontend Usage:**
- [`frontend/src/utils/apiEndpoints.js`](frontend/src/utils/apiEndpoints.js:43-56) - `JOB_CREATE`, `JOB_BY_ID`, `JOB_START`, `JOB_STOP`
- [`frontend/src/store/useTestStore.js`](frontend/src/store/useTestStore.js) - `jobQueue` state

---

### 1.4 Run Command Jobs (งานรันคำสั่ง)

**คำอธิบาย:** งานรันคำสั่งโดยไม่ใช้ไฟล์ VCD

**Backend Implementation:**
- [`backend/routers/jobs.py`](backend/routers/jobs.py) - `POST /api/jobs/run-command`
- ใช้ `command` field แทน `vcd_file_id`
- `vcd_file_id` สามารถเป็น null

**Frontend Usage:**
- [`frontend/src/utils/apiEndpoints.js`](frontend/src/utils/apiEndpoints.js:52) - `JOB_RUN_COMMAND`

---

## 2. สิ่งที่ Frontend มีแต่ Backend ยังไม่รองรับ

### 2.1 Missing Backend Endpoints

| Frontend Endpoint | Backend Status | คำอธิบาย |
|-------------------|----------------|-------------|
| `JOB_STATUS_SUMMARY` | ❌ ไม่มี | สรุปสถานะงานทั้งหมด |
| `JOB_EXPORT` | ❌ ไม่มี | Export job data |
| `JOB_REORDER` | ⚠️ มีใน service แต่ไม่มี router endpoint | Reorder jobs in queue (มีใน [`job_queue.py:126-134`](backend/services/job_queue.py:126-134)) |
| `JOB_PAIRS` | ⚠️ มีใน fe_job_store แต่ไม่มี router endpoint | Get pairs data for editing (มีใน [`fe_job_store.py:99-112`](backend/services/fe_job_store.py:99-112)) |

---

### 2.2 Missing Backend Features

| Feature | Backend Status | คำอธิบาย |
|---------|----------------|-------------|
| **Test Commands** | ❌ ไม่มี API และไม่มี Database table | Test commands เก็บใน localStorage ([`useTestStore.js:30-49`](frontend/src/store/useTestStore.js:30-49)) |
| **File Tags** | ❌ ไม่มี API และไม่มี Database table | File tags เก็บใน localStorage ([`useTestStore.js:57`](frontend/src/store/useTestStore.js:57)) |
| **Job Files** | ⚠️ เก็บใน fe_job_store (in-memory) เท่านั้น | Files ในงาน เก็บใน memory ([`fe_job_store.py`](backend/services/fe_job_store.py)) |

---

### 2.3 Frontend Not Connected to Backend

| Feature | Frontend | Backend | คำอธิบาย |
|---------|-----------|---------|-------------|
| **Test Cases/Sets** | ❌ ไม่มี endpoints | ✅ มีแล้ว ([`test_cases.py`](backend/routers/test_cases.py)) |
| **Profiles** | ✅ มีใน apiEndpoints.js | ✅ มีแล้ว ([`profiles.py`](backend/routers/profiles.py)) |
| **Notifications** | ✅ มีใน apiEndpoints.js | ✅ มีแล้ว ([`notifications.py`](backend/routers/notifications.py)) |

---

## 3. สรุป

### 3.1 ประเภทของงาน (Job Types)

มี **2 ประเภทของการแจกจ่ายงาน**:

1. **Broadcast Jobs** - รันงานนี้บนทุกบอร์ดที่เลือกพร้อมกัน
   - Frontend: ส่ง `boards` list
   - Backend: มี schema แต่ยังไม่ได้ implement อย่างเต็ม

2. **Sequential Jobs** - รันงานนี้บนบอร์ดแต่ละอันตามลำดับ
   - Frontend: ส่ง board ID เดียว หรือไม่ส่ง (auto-assign)
   - Backend: ใช้ `target_board_id` หรือ `assigned_board_id`

---

### 3.2 สิ่งที่ต้องแก้ไข

**Priority 1 (สำคัญมาก):**
1. ✅ เพิ่ม `JOB_STATUS_SUMMARY` endpoint
2. ✅ เพิ่ม `JOB_EXPORT` endpoint
3. ✅ เพิ่ม `JOB_REORDER` router endpoint (service มีแล้ว)
4. ✅ Implement Broadcast mode อย่างเต็ม

**Priority 2 (สำคัญปานกลาง):**
1. ✅ สร้าง Test Commands API + Database table
2. ✅ สร้าง File Tags API + Database table
3. ✅ Persist Job Files ไป database
4. ✅ เชื่อมต่อ Frontend ไป Test Cases/Sets endpoints

---

## 4. ไฟล์อ้างอิง

- [`docs/DATABASE_USAGE_ANALYSIS.md`](docs/DATABASE_USAGE_ANALYSIS.md) - วิเคราะห์การใช้ database
- [`docs/DATABASE_FIX_IMPLEMENTATION_PLAN.md`](docs/DATABASE_FIX_IMPLEMENTATION_PLAN.md) - แผนการแก้ไข
- [`docs/DATABASE_FIXES_SUMMARY.md`](docs/DATABASE_FIXES_SUMMARY.md) - สรุปการแก้ไข
