# Backend Structure (Eval System V2)

เอกสารสรุปโครงสร้าง backend ใช้เป็น reference ก่อนเขียน/แก้ feature

---

## 1. โครงสร้างโฟลเดอร์และความรับผิดชอบ

```
backend/
├── main.py              # Entry, CORS, lifespan, รวม routers
├── db/
│   ├── database.py      # Engine, session, init_db (SQLite/PostgreSQL)
│   └── orm_models.py    # FileORM, JobORM, ResultORM, BoardORM
├── models/              # Pydantic / domain models (BoardInfo, Job, TestResult, ...)
├── routers/             # HTTP + WebSocket endpoints
│   ├── boards.py        # /api/boards
│   ├── jobs.py          # /api/jobs
│   ├── files.py        # /api/files
│   ├── results.py      # /api/results
│   ├── system.py       # /api/system
│   ├── notifications.py # /api/notifications
│   ├── agent.py        # /api/agent (board register/heartbeat)
│   └── ws.py           # WebSocket routes (no prefix)
└── services/            # Business logic + DB/disk access
    ├── board_manager.py   # boards table
    ├── job_queue.py       # jobs table + queue loop
    ├── file_store.py      # files table + disk uploads
    ├── result_store.py    # results table + HDF5 waveforms
    ├── fe_job_store.py    # in-memory only (tag, boards, files list, pairsData)
    └── notification_store.py # in-memory only (notifications)
```

- **Routers**: รับ request → เรียก service → return response (หรือ raise HTTPException).
- **Services**: อ่าน/เขียน DB (ผ่าน `async_session` + ORM) หรือ disk; ไม่รู้เรื่อง HTTP.
- **DB**: SQLite demo = `eval_system_demo.db`; เปลี่ยนเป็น PostgreSQL ได้ด้วย env.

---

## 2. Router → Service → ข้อมูลที่ใช้

| Router | Prefix | Service หลัก | ตาราง/ที่เก็บข้อมูล |
|--------|--------|--------------|----------------------|
| boards | `/api/boards` | `board_manager` | **boards** |
| jobs | `/api/jobs` | `job_queue_service` + `fe_job_store` | **jobs** + in-memory meta |
| files | `/api/files` | `file_store` | **files** + disk `uploads/` |
| results | `/api/results` | `result_store` | **results** + HDF5 `storage/waveforms/` |
| system | `/api/system` | `board_manager` + disk usage | **boards** (aggregate) |
| notifications | `/api/notifications` | `notification_store` | in-memory only |
| agent | `/api/agent` | `board_manager` | **boards** (register/heartbeat) |
| ws | (no prefix) | `board_manager`, `job_queue_service` | **boards**, **jobs** |

---

## 3. Endpoint สรุป (สำหรับเทียบกับ Frontend)

### 3.1 Boards (`/api/boards`)
- `GET ""` → list boards (filter: status, model, firmware)
- `POST ""` → create board
- `GET "/{board_id}"` → get board
- `PATCH "/{board_id}"` → update board
- `GET "/{board_id}/status"` → board status
- `GET "/{board_id}/telemetry"` → telemetry
- `POST "/{board_id}/reboot"` → reboot
- `POST "/{board_id}/firmware"` → update firmware (Form + file)
- `POST "/{board_id}/self-test"` → self-test
- `POST "/batch"` → batch action (reboot, updateFirmware, selfTest, delete)
- `DELETE "/{board_id}"` → delete board
- `POST "/{board_id}/ping"` → ping
- `WS "/{board_id}/ssh/connect"` → SSH proxy (echo)

### 3.2 Jobs (`/api/jobs`)
- `GET ""` → list jobs (filter: status, tag, clientId)
- `GET "/{job_id}"` → get job
- `POST ""` → create job (payload: name, tag, firmware, boards, files, configName, clientId, pairsData)
- `PUT "/{job_id}"` → update job (pending only)
- `POST "/{job_id}/start"` → start job
- `POST "/{job_id}/stop"` → stop job
- `POST "/stop-all"` → stop all running
- `GET "/{job_id}/export"` → export job as JSON
- `PATCH "/{job_id}"` → update tag
- `GET "/{job_id}/files"` → list files in job (from fe_job_store)
- `GET "/{job_id}/pairs"` → get pairs data (edit batch)
- `POST "/{job_id}/files/{file_id}/stop"` → stop file
- `POST "/{job_id}/files/{file_id}/rerun"` → rerun stopped file
- `POST "/{job_id}/files/{file_id}/move"` → move file (direction)
- `POST "/upload"` → upload VCD/firmware + create job (Form)
- `DELETE "/{job_id}"` → delete job
- `POST "/{job_id}/reorder"` → reorder job (new_position)
- `POST "/run-command"` → create run-command job
- `POST "/start"` → start queue processing
- `POST "/stop"` → stop queue processing
- `GET "/status/summary"` → queue status

### 3.3 Files (`/api/files`)
- `POST "/upload"` → upload file (file + optional metadata)
- `GET ""` → list files
- `GET "/{file_id}"` → get file metadata
- `DELETE "/{file_id}"` → delete file

### 3.4 Results (`/api/results`)
- `GET ""` → list results (board_id, passed, limit, offset)
- `GET "/{result_id}"` → get result
- `GET "/{result_id}/waveform"` → waveform data
- `GET "/{result_id}/download"` → download HDF5 file
- `GET "/{result_id}/log"` → console log
- `DELETE "/{result_id}"` → delete result

### 3.5 System (`/api/system`)
- `GET "/health"` → system health (boards count, storage)
- `GET "/storage"` → storage summary
- `GET "/board-api/status"` → board API status

### 3.6 Notifications (`/api/notifications`)
- `GET ""` → list (read?, limit)
- `POST "/{id}/read"` → mark read
- `POST "/read-all"` → mark all read

### 3.7 Agent (`/api/agent`) — เรียกจาก Board/Agent
- `POST "/register"` → register board (ใช้ IP จาก request)
- `POST "/heartbeat"` → heartbeat (อัปเดต IP, temp ฯลฯ)

### 3.8 WebSocket (`ws.py`)
- `WS /ws/system` → system health ทุก 5 วินาที
- `WS /ws/boards` → board updates ทุก 5 วินาที
- `WS /ws/jobs` → job progress ทุก 5 วินาที
- `POST /api/waveform/chunk` → Node ส่ง waveform → broadcast ไป /ws/waveform
- `WS /ws/waveform` → frontend รับ waveform realtime

---

## 4. Flow สั้นๆ

- **Startup**: `init_db()` → สร้างตารางถ้ายังไม่มี; `job_queue_service.initialize()`.
- **Board**: UI/Agent เรียก boards API → `board_manager` อ่าน/เขียน **boards**.
- **Job**: UI สร้าง/อัปเดต job → `job_queue_service` อ่าน/เขียน **jobs**; metadata (tag, boards, files, pairs) อยู่ที่ `fe_job_store` (in-memory).
- **File**: อัปโหลด → `file_store` เขียน disk + **files**; job อ้างอิงชื่อไฟล์ (และมี vcd_file_id/firmware_file_id ใน jobs ถ้า map แล้ว).
- **Result**: หลังรันเทส → เขียน **results** + HDF5; อ่านผ่าน result_store.
- **Notification**: in-memory เท่านั้น ไม่มี DB.

ไฟล์นี้ใช้คู่กับ `DATA_STRUCTURE.md` และ `FEATURE_DATA_MAP.md` เพื่อดูว่า feature ไหนใช้ข้อมูลอะไรบ้าง
