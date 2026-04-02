# Data Structure (Database + In-Memory)

สรุปว่าข้อมูลอยู่ที่ไหน อ่าน/เขียนโดยใคร ใช้ก่อนออกแบบ feature ใหม่หรือแก้ schema

---

## 1. สรุปที่เก็บข้อมูล

| ที่เก็บ | ประเภท | ใช้โดย | หมายเหตุ |
|--------|--------|--------|----------|
| **boards** | ตาราง SQLite/PostgreSQL | board_manager, agent | Board inventory + status |
| **files** | ตาราง + disk `uploads/` | file_store | Metadata ใน DB, ไฟล์จริงใน disk |
| **jobs** | ตาราง | job_queue_service | คิวงาน, state, vcd/firmware filename |
| **results** | ตาราง + HDF5 `storage/waveforms/` | result_store | Metadata ใน DB, waveform ใน HDF5 |
| fe_job_store | In-memory (dict) | fe_job_store | tag, boards[], files[] (รายการไฟล์ใน job), pairsData, clientId, configName |
| notification_store | In-memory (list) | notification_store | รายการ notification (read/unread) |

---

## 2. ตาราง Database (ORM → ตาราง)

### 2.1 `files` (FileORM)
- **id** (UUID), **filename**, **file_type** (VCD/FIRMWARE/SCRIPT/OTHER), **storage_path**, **checksum_sha256**, **size_bytes**, **uploaded_at**
- **เขียน**: `file_store.add_file()` (upload)
- **อ่าน**: `file_store.list_files()`, `file_store.get_file()`
- **ลบ**: `file_store.delete_file()` (ลบทั้ง DB และไฟล์บน disk)
- **ความสัมพันธ์**: `jobs.vcd_file_id`, `jobs.firmware_file_id` อ้างอิง `files.id` (optional)

### 2.2 `boards` (BoardORM)
- **id**, **name**, **ip_address**, **mac_address**, **firmware_version**, **model**, **tag**, **connections** (JSON), **state**, **cpu_temp**, **cpu_load**, **ram_usage**, **current_job_id**, **last_heartbeat**, **created_at**
- **เขียน**: board_manager (create, update, update_heartbeat, delete)
- **อ่าน**: board_manager (get_all_boards, get_board)
- **เรียกจาก**: Router boards, system, agent; WebSocket ws/boards, ws/system

### 2.3 `jobs` (JobORM)
- **id**, **name**, **vcd_file_id**, **firmware_file_id**, **vcd_filename**, **firmware_filename**, **target_board_id**, **assigned_board_id**, **priority**, **queue_position**, **timeout_seconds**, **retries**, **enable_picoscope**, **save_to_db**, **state**, **progress**, **current_step**, **error_message**, **created_at**, **started_at**, **completed_at**
- **เขียน**: job_queue_service (add_job, update_job_meta, update_job_status, remove_job, reorder_job)
- **อ่าน**: job_queue_service (get_all_jobs, get_job)
- **หมายเหตุ**: รายการไฟล์ใน job (VCD/ERoM/ULP, order, try_count) อยู่ที่ **fe_job_store** ไม่ได้อยู่ในตาราง jobs

### 2.4 `results` (ResultORM)
- **id**, **job_id**, **job_name**, **board_id**, **board_name**, **passed**, **started_at**, **completed_at**, **duration_seconds**, **vcd_filename**, **firmware_filename**, **error_message**, **packet_count**, **crc_errors**, **console_log**, **waveform_hdf5_path**, **metrics** (JSON)
- **เขียน**: result_store (save_result + HDF5)
- **อ่าน**: result_store (get_results, get_result, get_waveform, get_waveform_path, get_console_log)
- **ลบ**: result_store.delete_result()

---

## 3. In-Memory Stores (ไม่มีใน DB)

### 3.1 fe_job_store
- **_meta[job_id]** = { tag, clientId, firmware, boards[], files[] (JobFile: id, name, status, result, order, vcd, erom, ulp, try_count), configName, pairsData? }
- **เขียน**: create_from_payload, update_tag, sync_files_for_status, update_file, move_file, save_pairs_data
- **อ่าน**: ensure_meta, list_files, get_pairs_data
- **ใช้เมื่อ**: สร้าง/อัปเดต job จาก frontend, แสดงรายการไฟล์ใน job, แก้ batch (pairs)
- **หมายเหตุ**: Restart backend = meta หาย; job หลักยังอยู่ใน **jobs** แต่ tag/boards/files list ต้องสร้างใหม่จาก UI หรือ default

### 3.2 notification_store
- **_notifications** = list of { id, title, message, time, type, read, createdAt }
- **เขียน**: add_notification, mark_read, mark_all_read
- **อ่าน**: list_notifications
- **หมายเหตุ**: Restart backend = notifications รีเซ็ต (มีแค่ seed "System Ready")

---

## 4. ไฟล์บน Disk (ไม่ใช่ตาราง)

| Path | ใช้โดย | เนื้อหา |
|------|--------|--------|
| **uploads/{TYPE}/{YYYY}/{MM}/{uuid}_{filename}** | file_store | ไฟล์อัปโหลด (VCD, firmware, etc.) |
| **storage/waveforms/{YYYY}/{MM}/{result_id}.h5** | result_store | HDF5 waveform ต่อ result |

---

## 5. Pydantic / API Response (สรุป)

- **Board (FE)**: id, name, status, ip, mac, firmware, model, voltage, signal, temp, currentJob, tag, connections
- **Job (FE)**: id, name, progress, status, tag, clientId, totalFiles, completedFiles, firmware, boards, startedAt, completedAt, files[]
- **File (FE)**: id, name, size, type, uploadDate
- **Result (FE)**: ตาม TestResult + waveform_available; waveform แยก endpoint /waveform, /download, /log

ถ้าจะเพิ่ม field ใหม่: ถ้าเป็นของ board/job/result/file ให้ดูว่าเก็บในตารางไหนและอัปเดต ORM + service; ถ้าเป็นแค่ UI state ของ job (เช่น tag, list of files) อาจอยู่แค่ fe_job_store ได้
