# Eval System V2 — สรุป Backend API (API Endpoints & Payloads)

**Base URL:** `http://<host>:<port>` (ค่าเริ่มต้น port `8000`)  
**เอกสารอัตโนมัติ (ลองค่าได้จริง):** `GET /docs` (Swagger) และ `GET /redoc`  
**Response error รูปแบบทั่วไป:** `{ "message": "...", "code": "HTTP_ERROR" | "INTERNAL_ERROR", "details": { } }`

---

## 1. Root & health

| Method | Path | Query / Body | คำอธิบาย / Response สรุป |
|--------|------|----------------|---------------------------|
| GET | `/api/health` | — | `{ "status": "ok", "version": "2.0.0" }` |
| GET, HEAD | `/` | — | ไฟล์ SPA (production) |
| GET, HEAD | `/{path}` | — | static หรือ SPA index (ยกเว้น path ที่ขัดกับ API) |

---

## 2. Boards — `/api/boards`

| Method | Path | Query / Body | Payload / รายละเอียด |
|--------|------|----------------|----------------------|
| GET | `/api/boards` | `status?`, `model?`, `firmware?` | รายการ board (array) — ฟิลด์หลัก: `id`, `name`, `status`, `ip`, `mac`, `firmware`, `model`, `tag`, `connections`, `lastHeartbeat`, ฯลฯ |
| POST | `/api/boards` | **JSON** `BoardCreateRequest` | `name` (str), `status?` (default `"online"`), `ip?`, `mac?`, `firmware?`, `model?`, `tag?`, `connections?` (array string) |
| GET | `/api/boards/{board_id}` | — | object board |
| PATCH | `/api/boards/{board_id}` | **JSON** `BoardUpdateRequest` | ทุกฟิลด์ optional: `name`, `status`, `ip`, `mac`, `firmware`, `model`, `tag`, `connections` (อย่างน้อย 1 ฟิลด์) |
| GET | `/api/boards/{board_id}/status` | — | `BoardStatus` (state, cpu_temp, current_job_id, last_heartbeat, …) |
| GET | `/api/boards/{board_id}/telemetry` | — | voltage, signal, temp, timestamp |
| POST | `/api/boards/{board_id}/reboot` | — | `{ "success", "message" }` |
| POST | `/api/boards/{board_id}/firmware` | **multipart/form** | `firmwareVersion` (form field), `firmwareFile` (file) |
| POST | `/api/boards/{board_id}/self-test` | — | success + results จำลอง |
| POST | `/api/boards/batch` | **JSON** `BatchActionRequest` | `boardIds` (array), `action`: `"reboot"` \| `"updateFirmware"` \| `"selfTest"` \| `"delete"`, `firmwareVersion?` |
| POST | `/api/boards/{board_id}/pause-queue` | — | success message |
| POST | `/api/boards/{board_id}/resume-queue` | — | success message |
| POST | `/api/boards/{board_id}/shutdown` | — | success message (ภายในยัง map ไป reboot) |
| DELETE | `/api/boards/{board_id}` | — | `{ "success": true }` |
| POST | `/api/boards/{board_id}/ping` | — | `{ "board_id", "reachable" }` |
| WS | `/api/boards/{board_id}/ssh/connect` | WebSocket | echo ตัวอย่าง (ม็อก) |

**หน้า FE โดยมาก:** หน้า Boards / System Summary / จับคู่ job กับ board

---

## 3. Jobs (คิวรัน) — `/api/jobs`

| Method | Path | Query / Body | Payload / รายละเอียด |
|--------|------|----------------|----------------------|
| GET | `/api/jobs` | `status?`, `tag?`, `clientId?` | รายการ job (object ตาม `_build_fe_job`: id, name, progress, status, tag, tags, files, boards, profileId, …) |
| GET | `/api/jobs/{job_id}` | — | job รายการเดียว |
| POST | `/api/jobs` | **JSON** `JobCreatePayload` | `name` (str), `tag?`, `tagColor?`, `tags?` (array of `{ tag?, name?, tagColor?, color? }`), `firmware?`, `boards?`, `files?` (array `JobFileCreate`), `configName?`, `clientId?`, `profileId?`, `profileDisplayName?`, `pairsData?` (array dict) — **JobFileCreate:** `name`, `order?`, `vcd?`, `erom?`, `ulp?`, `try_count?`, `testCaseName?` |
| PUT | `/api/jobs/{job_id}` | **JSON** เหมือน `JobCreatePayload` | อัปเดตเฉพาะ job ที่ **pending** |
| POST | `/api/jobs/{job_id}/start` | — | เริ่มรัน; อาจ 409 ถ้าไฟล์เปลี่ยนหลัง upload (`FILE_MODIFIED`) |
| POST | `/api/jobs/{job_id}/stop` | — | หยุด job |
| POST | `/api/jobs/stop-all` | — | `{ "success", "stoppedCount" }` |
| POST | `/api/jobs/{job_id}/reorder` | `new_position` (query, int) | จัดลำดับคิว — *ในโค้ดมี handler สองฉบับชื่อเดียว; ฝั่ง Python ฉบับหลัง override ฉบับก่อน — ตรวจด้วย `/docs`* |
| GET | `/api/jobs/{job_id}/export` | — | JSON job เหมือน get |
| GET | `/api/jobs/status/summary` | — | สรุปจำนวน pending/running/… หรือสถานะ queue — *มี `GET` ซ้ำ path ในไฟล์; ดู OpenAPI* |
| PATCH | `/api/jobs/{job_id}` | **JSON** `JobTagUpdate` | `tag?`, `tagColor?`, `tags?` (array) |
| GET | `/api/jobs/{job_id}/files` | — | รายการไฟล์ใน job (serialized) |
| GET | `/api/jobs/{job_id}/pairs` | — | `{ "pairsData": ... }` สำหรับ pair table / edit batch |
| POST | `/api/jobs/{job_id}/files/{file_id}/stop` | — | หยุดไฟล์ใน job |
| POST | `/api/jobs/{job_id}/files/{file_id}/rerun` | — | rerun ไฟล์ที่ status stopped |
| POST | `/api/jobs/{job_id}/files/{file_id}/move` | **JSON** `FileMoveRequest` | `{ "direction" }` (เช่น up/down ตาม logic ใน `fe_job_store`) |
| POST | `/api/jobs/upload` | **multipart** | `vcd_file` (file), `firmware_file?`, `name` (str), `target_board_id?`, `priority`, `timeout_seconds` — สร้าง job แบบอัปโหลดไฟล์ |
| DELETE | `/api/jobs/{job_id}` | — | ลบ job |
| POST | `/api/jobs/run-command` | **JSON** `RunCommandPayload` | `name?`, `command` (str), `tag?`, `boards?`, `configName?`, `firmware?`, `clientId?`, `profileId?`, `profileDisplayName?` |
| POST | `/api/jobs/start` | — | เริ่ม “queue processor” ของบริการ |
| POST | `/api/jobs/stop` | — | หยุด queue processor |

**หน้า FE โดยมาก:** Jobs / Run Set / สร้าง batch

---

## 4. Job files (ฐานข้อมูล job_file — path ยาว) — prefix `/api/jobs` + path ที่ขึ้นต้น `/jobs/...`

*หมายเหตุ:* router นี้ลงทะเบียน path แบบ `/jobs/{job_id}/files` ภายใต้ prefix `/api/jobs` ดังนั้น URL เต็มคือ  
**`GET|POST|PATCH|DELETE /api/jobs/jobs/{job_id}/files` …** (มี `/jobs` สองชั้น) — ฝั่ง UI หลักมักใช้ **`/api/jobs/{job_id}/files` จาก `routers/jobs`** แทน

| Method | Path (เต็ม) | Body | รายละเอียด |
|--------|-------------|------|------------|
| GET | `/api/jobs/jobs/{job_id}/files` | — | รายการ job files |
| POST | `/api/jobs/jobs/{job_id}/files` | **JSON** `JobFileCreate` | `name`, `order?`, `vcd?`, `erom?`, `ulp?`, `try_count?`, `test_case_name?` |
| GET | `/api/jobs/jobs/{job_id}/files/{file_id}` | — | รายการเดียว |
| PATCH | `/api/jobs/jobs/{job_id}/files/{file_id}` | **JSON** `JobFileUpdate` | `status?`, `result?`, `order?` |
| DELETE | `/api/jobs/jobs/{job_id}/files/{file_id}` | — | ลบ |
| POST | `/api/jobs/jobs/{job_id}/files/sync` | `status` (query) | sync สถานะไฟล์ตาม job |

---

## 5. Results — `/api/results`

| Method | Path | Query / Body | รายละเอียด |
|--------|------|----------------|------------|
| GET | `/api/results` | `board_id?`, `passed?`, `limit` (default 50, max 200), `offset` | `List[TestResult]` |
| GET | `/api/results/{result_id}` | — | `TestResult` (id, job_id, job_name, board_*, passed, vcd_*, error_message, waveform_available, …) |
| GET | `/api/results/{result_id}/waveform` | — | `WaveformData` |
| GET | `/api/results/{result_id}/download` | — | ไฟล์ HDF5 (binary) |
| GET | `/api/results/{result_id}/log` | — | `{ "log": "..." }` |
| DELETE | `/api/results/{result_id}` | — | ลบผลลัพธ์ |

**หน้า FE โดยมาก:** หน้าผลลัพธ์ / รายงาน

---

## 6. System — `/api/system`

| Method | Path | Body | รายละเอียด |
|--------|------|------|------------|
| GET | `/api/system/health` | — | สรุป boards + storage ฯลฯ |
| GET | `/api/system/storage` | — | usage disk |
| GET | `/api/system/board-api/status` | — | สถานะม็อก |
| POST | `/api/system/backfill-file-ids` | — | ม็อก/legacy message |
| GET | `/api/system/file-id-cutover-readiness` | — | สถานะ migration ไฟล์ |

---

## 7. Files (ไลบรารีไฟล์) — `/api/files`

| Method | Path | Body / Query | รายละเอียด |
|--------|------|----------------|------------|
| GET | `/api/files` | — | รายการไฟล์ใน library |
| GET | `/api/files/{file_id}` | — | metadata |
| GET | `/api/files/{file_id}/content` | — | raw bytes (download/view) |
| POST | `/api/files/upload` | **multipart** | `file` (file), `metadata?` (str), `force_new?`, `owner_id?`, `owner_display_name?`, `visibility?` (`private` \| `team` \| `public`) |
| POST | `/api/files/check` | **JSON** `FileCheckPayload` | `filename?`, `signature?` (checksum), `size?`, `modifyDate?` — ตรวจ duplicate ก่อน upload |
| PATCH | `/api/files/{file_id}/library-tags` | **JSON** `FileLibraryTagsUpdate` | `tags?`, `tagColor?` |
| DELETE | `/api/files/{file_id}` | — | 409 ถ้าไฟล์ถูกอ้างอิงใน batch ที่ run/pending |

**หน้า FE โดยมาก:** File Library

---

## 8. Sets (ไฟล์ต่อ set ตาม set_id) — `/api/sets`

| Method | Path | Body | รายละเอียด |
|--------|------|------|------------|
| POST | `/api/sets/{set_id}/files/save` | **JSON** `{ "file_ids": [string, ...] }` | คัดลอกไฟล์จาก library เข้า set |
| GET | `/api/sets/{set_id}/files` | — | รายการไฟล์ของ set |
| POST | `/api/sets/{set_id}/files/restore-to-library` | — | กู้กลับเข้า library |
| DELETE | `/api/sets/{set_id}` | — | ลบไฟล์ที่ผูก set_id นี้ |

**หน้า FE โดยมาก:** บันทึก/โหลดไฟล์กับ “Save Set” / Run Set

---

## 9. Profiles (ข้อมูลหลักของ Test Cases ใน Zustand) — `/api/profiles`

| Method | Path | Body | รายละเอียด |
|--------|------|------|------------|
| GET | `/api/profiles` | — | รายการ profile: `id`, `name`, `data` (JSON ใหญ่), `updated_at` |
| GET | `/api/profiles/all-test-cases` | — | `{ "savedTestCases": [...], "savedTestCaseSets": [...] }` รวมทุก profile + `_ownerId`, `_ownerName` |
| POST | `/api/profiles` | **JSON** `ProfileCreate` | `name`, `data?` (object) |
| GET | `/api/profiles/{profile_id}` | — | profile เดียว |
| GET | `/api/profiles/{profile_id}/data` | — | เฉพาะ `data` (object) |
| PUT | `/api/profiles/{profile_id}/data` | **JSON** object ใดๆ ที่ merge เข้า `data` | รวม `savedTestCases`, `savedTestCaseSets` ฯลฯ — อาจ 409 ถ้าชื่อ TC / ชุดไฟล์ซ้ำใน profile |
| PATCH | `/api/profiles/{profile_id}` | **JSON** `ProfileUpdate` | `name?`, `data?` (merge) |
| DELETE | `/api/profiles/{profile_id}` | — | ลบ profile |
| POST | `/api/profiles/sync-normalized` | — | rebuild ตาราง normalize (admin) |

**หน้า FE โดยมาก:** ทุกหน้าที่ sync profile — Test Cases, File Library, Setup

---

## 10. Notifications — `/api/notifications`

| Method | Path | Query / Body | รายละเอียด |
|--------|------|--------------|------------|
| GET | `/api/notifications` | `read?`, `limit?`, `user_id?` | รายการแจ้งเตือน |
| POST | `/api/notifications` | **JSON** `NotificationCreateBody` | `title`, `message?`, `type` (e.g. success/error/info), `user_id?`, `data?` (object) |
| POST | `/api/notifications/{notification_id}/read` | — | ทำเครื่องหมายอ่าน |
| POST | `/api/notifications/read-all` | `user_id?` | อ่านทั้งหมด |
| DELETE | `/api/notifications/{notification_id}` | — | ลบ |

---

## 11. Test Management (ORM/SQLite legacy path) — prefix `/api/test-management` + path ในรายการ

| Method | Path (เต็ม) | Query / Body | รายละเอียด |
|--------|-------------|--------------|------------|
| GET | `/api/test-management/test-cases` | — | รายการ |
| POST | `/api/test-management/test-cases` | **JSON** `TestCaseCreate` | `name`, `vcd_file_id?`, `firmware_filename?`, `tags?` |
| GET | `/api/test-management/test-cases/{test_case_id}` | — | รายการเดียว |
| PATCH | `/api/test-management/test-cases/{test_case_id}` | **query** `name?`, `vcd_file_id?`, `firmware_filename?`, `tags?` | อัปเดต |
| DELETE | `/api/test-management/test-cases/{test_case_id}` | — | ลบ |
| GET | `/api/test-management/test-sets` | — | รายการ set |
| POST | `/api/test-management/test-sets` | **JSON** `TestSetCreate` | `name`, `tags?` |
| GET | `/api/test-management/test-sets/{test_set_id}` | — | รายละเอียด set |
| GET | `/api/test-management/test-sets/{test_set_id}/items` | — | รายการ item |
| POST | `/api/test-management/test-sets/{test_set_id}/items` | **query** `test_case_id`, `execution_order` | เพิ่ม TC เข้า set |
| PATCH | `/api/test-management/test-sets/{test_set_id}` | **query** `name?`, `tags?` | อัปเดต set |
| DELETE | `/api/test-management/test-sets/{test_set_id}` | — | ลบ set |
| DELETE | `/api/test-management/test-sets/{test_set_id}/items/{test_case_id}` | — | เอา TC ออกจาก set |
| PATCH | `/api/test-management/test-sets/{test_set_id}/items/{test_case_id}/order` | **query** `new_order` (int) | เรียงลำดับ |

*หมายเหตุ:* การใช้งานหลักของแอปมักจะ sync ผ่าน **`/api/profiles`** มากกว่า endpoint กลุ่มนี้

---

## 12. Test commands & file tags — prefix `/api/test-commands` + path ด้านล่าง

*หมายเหตุ:* router กำหนด path เป็น `/test-commands` / `/file-tags` อีกที จึงได้ URL คู่ prefix เช่น **`/api/test-commands/test-commands`**

| Method | Path (เต็ม) | Query / Body | รายละเอียด |
|--------|-------------|--------------|------------|
| GET | `/api/test-commands/test-commands` | `user_id?` | รายการคำสั่ง |
| POST | `/api/test-commands/test-commands` | **JSON** `TestCommandCreate` + `user_id?` | `name`, `command`, `description?` |
| GET | `/api/test-commands/test-commands/{command_id}` | — | รายละเอียด |
| PATCH | `/api/test-commands/test-commands/{command_id}` | **JSON** `TestCommandUpdate` | ฟิลด์ optional |
| DELETE | `/api/test-commands/test-commands/{command_id}` | — | ลบ |
| GET | `/api/test-commands/file-tags` | `user_id?` | รายการ tag |
| POST | `/api/test-commands/file-tags` | **JSON** `FileTagCreate` + `user_id?` | `tag`, `color?` |
| GET | `/api/test-commands/file-tags/{tag_id}` | — | รายละเอียด |
| PATCH | `/api/test-commands/file-tags/{tag_id}` | **JSON** `FileTagUpdate` | `tag?`, `color?` |
| DELETE | `/api/test-commands/file-tags/{tag_id}` | — | ลบ |

---

## 13. Agent (บอร์ด / Zybo agent) — `/api/agent`

| Method | Path | Body | รายละเอียด |
|--------|------|------|------------|
| POST | `/api/agent/register` | **JSON** `BoardRegisterRequest` | `board_id`, `name?`, `mac_address?`, `firmware_version?`, `model?`, `tag?` — IP มาจาก request |
| POST | `/api/agent/heartbeat` | **JSON** `HeartbeatRequest` | `board_id`, `cpu_temp`, `cpu_load`, `ram_usage`, `status` (IDLE/BUSY/ERROR), `fpga_status?`, `arm_status?` |

---

## 14. WebSocket & waveform

| ประเภท | Path | รายละเอียด |
|--------|------|------------|
| WS | `/ws/system` | ส่ง `system_health` ทุก ~5s |
| WS | `/ws/boards` | ส่ง `board_update` ทุก ~5s |
| WS | `/ws/jobs` | ส่ง `job_progress` ทุก ~5s |
| WS | `/ws/waveform` | รับ waveform แบบ real-time จาก chunk |
| POST | `/api/waveform/chunk` | **JSON** `WaveformChunkBody` — `samples?`, `channels?` (array `{ id, samples }`), `fs`, `freq_hz`, `index?` — broadcast ไปยัง client WS ที่เชื่อม |

*ฝั่ง WebSocket ไม่มี prefix `/api` (ลงทะเบียนใน `main` แบบไม่ใส่ prefix)*

---

## 15. แมป “หน้า UI หลัก” → กลุ่ม API (อ้างอิง)

| หน้า / ฟีเจอร์ (โดยมาก) | API หลักที่ใช้ |
|------------------------|-----------------|
| Jobs / คิว run | `/api/jobs/*`, `/api/files` (อ้างอิงไฟล์), `/api/boards` |
| File Library | `/api/files/*`, `/api/profiles`, `/api/profiles/all-test-cases` |
| Test Cases / Set builder | `/api/profiles/*`, `/api/sets/*`, `/api/files/*` |
| Run Set | `/api/jobs/*`, `/api/profiles` |
| Boards / Dashboard | `/api/boards/*`, `/api/system/health`, WS `/ws/*` |
| Board agent (ฮาร์ดแวร์) | `/api/agent/*` |
| ผลลัพธ์ / waveform | `/api/results/*`, `/api/waveform/chunk`, WS `/ws/waveform` |

---

## 16. หมายเหตุสำหรับ Lead / นำไปทำ Word

1. รายการนี้สรุปจาก source **FastAPI routers** ใน `backend/routers/` + `main.py` — field ละเอียดเพิ่มเติมดูได้ที่ **`/docs`**.  
2. กลุ่ม **`/api/profiles` + `data`** เป็นที่เก็บ state หลักของ test cases / sets ใน production (JSON ใหญ่)  
3. มี **route ซ้ำใน `jobs.py`** (เช่น `GET /status/summary`, `POST .../reorder`) — ฝั่ง implementation อาจ override กัน; ยึด **OpenAPI ที่รันจริง** เป็นหลัก  
4. **`job_files` router** สร้าง path แบบ `/api/jobs/jobs/...` — ระวังไม่สับสนกับ `/api/jobs/{job_id}/files` ของ `jobs` router  

---
*เอกสารนี้สร้างเพื่อส่งต่อ (เช่น คัดลอกไป Microsoft Word) — ไม่รับผิดชอบแทนการทดสอบ integration จริง*
