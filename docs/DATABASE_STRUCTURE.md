# Database Structure — Eval System (SW-FE)

ระบบใช้ **SQLAlchemy (async)** เป็น ORM โดย default ใช้ **SQLite** (`eval_system_demo.db`) สำหรับ demo และสามารถสลับไปใช้ **PostgreSQL** ได้ผ่าน environment variable `USE_SQLITE_DEMO=0`

---

## สรุปตารางในฐานข้อมูล

| ตาราง    | คำอธิบายสั้น |
|----------|------------------|
| `files`  | ลงทะเบียนไฟล์ที่อัปโหลด (VCD, firmware, script) |
| `boards` | รายการบอร์ด/อุปกรณ์ และสถานะ (online, busy, heartbeat) |
| `jobs`   | คิวงานทดสอบ (job) — ลิงก์ไปไฟล์และบอร์ด |
| `results`| ผลการรันทดสอบต่อ job/board (passed/failed, เวลา, log, waveform path) |

---

## 1. ตาราง `files`

ลงทะเบียนไฟล์ที่อัปโหลดผ่านระบบ (ใช้เก็บ path, checksum, ขนาด)

| Column          | Type           | Nullable | คำอธิบาย |
|-----------------|----------------|----------|----------|
| `id`            | VARCHAR(36)    | PK       | UUID |
| `filename`      | VARCHAR(255)   | NOT NULL | ชื่อไฟล์ |
| `file_type`     | ENUM           | NOT NULL | VCD, FIRMWARE, SCRIPT, OTHER |
| `storage_path`  | VARCHAR(512)   | NOT NULL | path ใน storage |
| `checksum_sha256`| VARCHAR(64)    | YES      | SHA256 (optional) |
| `size_bytes`    | BIGINT         | default 0| ขนาดไฟล์ (bytes) |
| `uploaded_at`   | DATETIME       | default now | เวลาอัปโหลด |

**Enum `FileType`:** `VCD` | `FIRMWARE` | `SCRIPT` | `OTHER`

---

## 2. ตาราง `boards`

รายการบอร์ด/อุปกรณ์ และสถานะ real-time

| Column             | Type         | Nullable | คำอธิบาย |
|--------------------|--------------|----------|----------|
| `id`               | VARCHAR(64)  | PK       | รหัสบอร์ด |
| `name`             | VARCHAR(255) | NOT NULL | ชื่อแสดง |
| `ip_address`       | VARCHAR(64)  | default "" | IP |
| `mac_address`      | VARCHAR(64)  | YES      | MAC |
| `firmware_version` | VARCHAR(128) | YES      | เวอร์ชัน firmware |
| `model`            | VARCHAR(128) | YES      | รุ่น/โมเดล |
| `tag`              | VARCHAR(128) | YES      | tag สำหรับกรอง |
| `connections`      | JSON         | YES      | ข้อมูล connections |
| `state`            | VARCHAR(32)  | default "offline" | online / offline / busy / error |
| `cpu_temp`         | FLOAT        | YES      | อุณหภูมิ CPU |
| `cpu_load`         | FLOAT        | YES      | โหลด CPU |
| `ram_usage`        | FLOAT        | YES      | การใช้ RAM |
| `current_job_id`   | VARCHAR(32)  | YES      | job ที่กำลังรันอยู่ |
| `last_heartbeat`   | DATETIME     | YES      | เวลา heartbeat ล่าสุด |
| `created_at`       | DATETIME     | default now | สร้างเมื่อ |

---

## 3. ตาราง `jobs`

คิวงานทดสอบ (แต่ละ record = 1 job/batch ใน queue)

| Column              | Type           | Nullable | คำอธิบาย |
|---------------------|----------------|----------|----------|
| `id`                | VARCHAR(32)    | PK       | รหัส job (จาก backend) |
| `name`              | VARCHAR(255)   | NOT NULL | ชื่อ job |
| `vcd_file_id`       | VARCHAR(36)    | YES      | FK → `files.id` (VCD) |
| `firmware_file_id`  | VARCHAR(36)    | YES      | FK → `files.id` (firmware) |
| `vcd_filename`      | VARCHAR(255)   | YES      | ชื่อไฟล์ VCD (legacy/display) |
| `firmware_filename` | VARCHAR(255)   | YES      | ชื่อไฟล์ firmware (legacy/display) |
| `target_board_id`   | VARCHAR(32)    | YES      | บอร์ดเป้าหมาย (null = auto-assign) |
| `assigned_board_id` | VARCHAR(32)    | YES      | บอร์ดที่ assign แล้ว |
| `priority`          | INTEGER        | default 0 | ความสำคัญ (สูง = รันก่อน) |
| `queue_position`    | INTEGER        | default 0 | ลำดับในคิว |
| `timeout_seconds`   | INTEGER        | default 60 | timeout (วินาที) |
| `retries`           | INTEGER        | default 0 | จำนวน retry |
| `enable_picoscope`   | BOOLEAN        | default false | เปิดใช้ PicoScope |
| `save_to_db`        | BOOLEAN        | default true | บันทึกผลลง DB |
| `state`             | VARCHAR(32)    | default "pending" | pending / configuring / flashing / running / completed / failed / cancelled |
| `progress`          | INTEGER        | default 0 | 0–100 |
| `current_step`      | VARCHAR(255)   | YES      | ขั้นตอนปัจจุบัน |
| `error_message`     | TEXT           | YES      | ข้อความ error |
| `created_at`        | DATETIME       | default now | สร้างเมื่อ |
| `started_at`        | DATETIME       | YES      | เริ่มรันเมื่อ |
| `completed_at`      | DATETIME       | YES      | เสร็จเมื่อ |

**ความสัมพันธ์**
- `vcd_file_id` → `files.id`
- `firmware_file_id` → `files.id`

---

## 4. ตาราง `results`

ผลการรันทดสอบ (ต่อ 1 job + 1 board ต่อ record)

| Column               | Type         | Nullable | คำอธิบาย |
|----------------------|--------------|----------|----------|
| `id`                 | VARCHAR(32)  | PK       | รหัสผล |
| `job_id`             | VARCHAR(32)  | NOT NULL | รหัส job |
| `job_name`           | VARCHAR(255) | NOT NULL | ชื่อ job |
| `board_id`           | VARCHAR(32)  | NOT NULL | รหัสบอร์ด |
| `board_name`         | VARCHAR(255) | NOT NULL | ชื่อบอร์ด |
| `passed`             | BOOLEAN      | NOT NULL | ผ่าน/ไม่ผ่าน |
| `started_at`         | DATETIME     | NOT NULL | เริ่มรัน |
| `completed_at`       | DATETIME     | NOT NULL | เสร็จเมื่อ |
| `duration_seconds`   | FLOAT        | NOT NULL | ระยะเวลา (วินาที) |
| `vcd_filename`       | VARCHAR(255) | NOT NULL | ชื่อ VCD ที่ใช้ |
| `firmware_filename`  | VARCHAR(255) | YES      | ชื่อ firmware |
| `error_message`      | TEXT         | YES      | ข้อความ error |
| `packet_count`       | INTEGER      | default 0 | จำนวน packet |
| `crc_errors`         | INTEGER      | default 0 | จำนวน CRC error |
| `console_log`        | TEXT         | YES      | log จาก console |
| `waveform_hdf5_path` | VARCHAR(512) | YES      | path ไฟล์ HDF5 waveform |
| `metrics`            | JSON         | YES      | metrics เพิ่มเติม |

---

## สิ่งที่ไม่ได้อยู่ใน Database (ในระบบนี้)

- **Saved Test Cases (คลัง test case)**  
  เก็บใน **Frontend localStorage** เท่านั้น (`appSavedTestCases`) — ยังไม่มีตาราง `test_cases` ใน backend

- **Job metadata แบบ Frontend (tag, config name, รายการไฟล์ย่อย, pairs data)**  
  เก็บใน **in-memory** ที่ backend: `FEJobStore` (services/fe_job_store.py) — ไม่ persist ลง DB  
  - ประกอบด้วย: tag, clientId, firmware, boards[], files[] (ชื่อ VCD/ERoM/ULP, order, try_count), configName, pairsData

- **Notifications**  
  ขึ้นกับ implementation — อาจเป็น in-memory หรือ table แยก (ใน repo นี้ดูจาก notification_store ถ้ามี)

---

## การเชื่อมต่อ Database

- **Config:** `backend/db/database.py`
- **Default (demo):** `sqlite+aiosqlite:///./eval_system_demo.db`
- **Production:** ตั้ง `USE_SQLITE_DEMO=0` แล้วใช้ตัวแปร `DB_USER`, `DB_PASS`, `DB_HOST`, `DB_NAME` สำหรับ PostgreSQL  
  URL รูปแบบ: `postgresql+asyncpg://{user}:{pass}@{host}/{dbname}`

---

## สรุปความสัมพันธ์ (ER สั้นๆ)

```
files (id)
  ↑
  │ vcd_file_id, firmware_file_id
jobs (id) ──────┬── current_job_id → boards
                │
                └── job_id → results (job_id, board_id)
boards (id)
```

- **files**: อ้างอิงจาก `jobs.vcd_file_id`, `jobs.firmware_file_id`
- **jobs**: อ้างอิงจาก `results.job_id`; `boards.current_job_id` ชี้ไปที่ job ที่กำลังรัน
- **boards**: ถูกอ้างอิงใน `results.board_id`
