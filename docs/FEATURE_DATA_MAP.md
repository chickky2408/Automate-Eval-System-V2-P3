# Feature → Data Map (ก่อนเขียนโค้ด feature ไหน ใช้ข้อมูลยังไงบ้าง)

ใช้เอกสารนี้ก่อนเขียนหรือแก้ feature: ดูว่า feature นั้นเรียก API อะไร และ API นั้นอ่าน/เขียนข้อมูลจากที่ไหน

---

## 1. System / Dashboard

| Feature | API ที่เรียก | ข้อมูลที่ใช้ | หมายเหตุ |
|--------|----------------|--------------|----------|
| Health check | GET /api/health | ไม่ใช้ DB | แค่ return status, version |
| System health (boards count, storage) | GET /api/system/health | **boards** (aggregate), disk usage | board_manager.get_all_boards() + shutil.disk_usage |
| Storage status | GET /api/system/storage | disk เท่านั้น | ไม่อ่านตาราง |
| Board API status | GET /api/system/board-api/status | ไม่ใช้ DB | hardcode online |
| WebSocket system | WS /ws/system | **boards** | board_manager.get_all_boards() ทุก 5 วินาที |

---

## 2. Boards / Devices

| Feature | API ที่เรียก | ข้อมูลที่ใช้ | หมายเหตุ |
|--------|----------------|--------------|----------|
| รายการบอร์ด + filter | GET /api/boards?status=&model=&firmware= | **boards** | board_manager.get_all_boards() แล้ว filter ใน router |
| สร้างบอร์ด | POST /api/boards | **boards** (insert) | board_manager.create_board() |
| ดู/แก้/ลบบอร์ด | GET/PATCH/DELETE /api/boards/{id} | **boards** | get_board, update_board, delete_board |
| Status / Telemetry | GET /api/boards/{id}/status, /telemetry | **boards** | อ่านจาก board เดียว |
| Reboot / Firmware / Self-test / Ping | POST /api/boards/{id}/... | **boards** (อ่าน; reboot/update อาจอัปเดต state) | get_board แล้วเรียก action |
| Batch action | POST /api/boards/batch | **boards** | loop board_ids, reboot/updateFirmware/delete ฯลฯ |
| SSH connect | WS /api/boards/{id}/ssh/connect | ไม่ใช้ DB | echo only |
| WebSocket boards | WS /ws/boards | **boards** | get_all_boards() ทุก 5 วินาที |
| Agent register | POST /api/agent/register | **boards** (insert/update) | create_board ด้วย IP จาก request |
| Agent heartbeat | POST /api/agent/heartbeat | **boards** (update) | update_heartbeat (state, temp ฯลฯ) |

---

## 3. Files (Upload / Library)

| Feature | API ที่เรียก | ข้อมูลที่ใช้ | หมายเหตุ |
|--------|----------------|--------------|----------|
| อัปโหลดไฟล์ | POST /api/files/upload | **files** (insert) + disk | file_store.add_file() → DB + เขียน uploads/ |
| รายการไฟล์ | GET /api/files | **files** | file_store.list_files() |
| ดู/ลบไฟล์ | GET/DELETE /api/files/{id} | **files** (+ ลบไฟล์บน disk) | get_file, delete_file |

Job สร้างจาก UI อาจอ้างอิง "ชื่อไฟล์" หรือ file id; ตาราง **jobs** มี vcd_file_id, firmware_file_id (FK ไป files) และ legacy vcd_filename, firmware_filename

---

## 4. Jobs / Batches

| Feature | API ที่เรียก | ข้อมูลที่ใช้ | หมายเหตุ |
|--------|----------------|--------------|----------|
| รายการ job + filter | GET /api/jobs?status=&tag=&clientId= | **jobs** + **fe_job_store** | job_queue_service.get_all_jobs() แล้ว build FE payload จาก fe_job_store (tag, boards, files) |
| สร้าง job | POST /api/jobs | **jobs** (insert) + **fe_job_store** | job_queue_service.add_job() + fe_job_store.create_from_payload(); pairsData → fe_job_store.save_pairs_data() |
| แก้ job (pending) | PUT /api/jobs/{id} | **jobs** (update meta) + **fe_job_store** | update_job_meta + create_from_payload + save_pairs_data |
| เริ่ม/หยุด job | POST /api/jobs/{id}/start, /stop | **jobs** (update state) + **fe_job_store** | update_job_status + sync_files_for_status |
| หยุดทั้งหมด | POST /api/jobs/stop-all | **jobs** | loop อัปเดต state + fe_job_store |
| Export / Tag | GET /api/jobs/{id}/export, PATCH /api/jobs/{id} | **jobs** + **fe_job_store** | อ่านแล้วส่ง FE format; tag อัปเดตใน fe_job_store |
| รายการไฟล์ใน job | GET /api/jobs/{id}/files | **fe_job_store** | list_files(job_id) |
| Pairs (แก้ batch) | GET /api/jobs/{id}/pairs | **fe_job_store** | get_pairs_data(job_id) |
| Stop/Rerun/Move file ใน job | POST .../files/{file_id}/stop, rerun, move | **fe_job_store** | update_file, move_file (ไม่มีใน DB) |
| อัปโหลดสร้าง job | POST /api/jobs/upload | **jobs** (insert) + เขียน disk โดย router (ไม่ผ่าน file_store สำหรับ path ใน job) | Form: vcd_file, firmware_file, name, ... → add_job |
| ลบ / Reorder job | DELETE /api/jobs/{id}, POST .../reorder | **jobs** | remove_job, reorder_job |
| Run command | POST /api/jobs/run-command | **jobs** + **fe_job_store** | add_job + create_from_payload |
| Queue start/stop | POST /api/jobs/start, /stop | ไม่เขียน DB โดยตรง | ควบคุม loop ใน job_queue_service |
| Queue status | GET /api/jobs/status/summary | **jobs** (อ่าน state) | get_status จาก service |
| WebSocket jobs | WS /ws/jobs | **jobs** + **fe_job_store** | get_all_jobs() แล้ว _build_fe_job ทุก 5 วินาที |

---

## 5. Results

| Feature | API ที่เรียก | ข้อมูลที่ใช้ | หมายเหตุ |
|--------|----------------|--------------|----------|
| รายการ result + filter | GET /api/results?board_id=&passed=&limit=&offset= | **results** | result_store.get_results() |
| ดู result | GET /api/results/{id} | **results** | result_store.get_result() |
| Waveform | GET /api/results/{id}/waveform | **results** + HDF5 file | อ่าน waveform_hdf5_path แล้วโหลดจาก disk |
| Download HDF5 | GET /api/results/{id}/download | **results** + HDF5 file | get_waveform_path → FileResponse |
| Console log | GET /api/results/{id}/log | **results** | console_log field |
| ลบ result | DELETE /api/results/{id} | **results** (+ ลบ HDF5 ถ้า implement) | result_store.delete_result() |

การเขียน **results** เกิดจาก job_queue_service / executor ตอน job เสร็จ (save_result) ไม่ได้มาจาก REST โดยตรงจาก frontend

---

## 6. Notifications

| Feature | API ที่เรียก | ข้อมูลที่ใช้ | หมายเหตุ |
|--------|----------------|--------------|----------|
| รายการแจ้งเตือน | GET /api/notifications?read=&limit= | **notification_store** (in-memory) | list_notifications |
| Mark read / Read all | POST /api/notifications/{id}/read, /read-all | **notification_store** | mark_read, mark_all_read |

ไม่มีตาราง DB; restart backend = รีเซ็ต

---

## 7. Realtime / Waveform

| Feature | API / WS | ข้อมูลที่ใช้ | หมายเหตุ |
|--------|----------|--------------|----------|
| Waveform จาก Node | POST /api/waveform/chunk | ไม่ใช้ DB | broadcast ไป WS clients |
| Frontend รับ waveform | WS /ws/waveform | ไม่ใช้ DB | รับ payload ที่ backend broadcast |

---

## 8. สรุปสั้นๆ เวลาเขียน Feature ใหม่

1. **ดูว่า feature อยู่กลุ่มไหน** (boards, jobs, files, results, system, notifications).
2. **เปิด FEATURE_DATA_MAP.md** → หา API ที่ feature จะเรียก.
3. **เปิด DATA_STRUCTURE.md** → ดูว่าข้อมูลนั้นอยู่ตารางไหน / in-memory / disk.
4. **เปิด BACKEND_STRUCTURE.md** → ดู router + service ที่ต้องแก้ถ้าต้องเพิ่ม endpoint หรือ logic.

ถ้าเป็นแค่ frontend เรียก API ที่มีอยู่แล้ว ก็ดูแค่ FEATURE_DATA_MAP + apiEndpoints/api.js; ถ้าต้องเพิ่ม field หรือ endpoint ใหม่ ต้องไปแตะ backend + ดู DATA_STRUCTURE ด้วย
