# รายละเอียดโครงสร้างฐานข้อมูลเชิงลึก (Authoritative Database Schema)
**วันที่อัปเดต:** 18 พฤษภาคม 2026 | **อ้างอิง:** `backend/db/orm_models.py` | **สถานะ:** Current Schema ไม่ใช่ Target Redesign

[กลับสู่หน้าหลักสถาปัตยกรรมระบบ (System Architecture & Data Mapping)](./FE_MENU_API_DB_MAPPING.md)

---

## 0. หมายเหตุเรื่อง Current Schema vs Target Schema

เอกสารนี้อธิบาย schema ที่มีอยู่จริงใน source code ปัจจุบัน เพื่อใช้ตรวจสอบ migration และ API compatibility เท่านั้น ไม่ควรถือว่าทุกตาราง/ฟิลด์ในเอกสารนี้ต้องคงอยู่ระยะยาว

รายการที่ควรลดบทบาทหลัง redesign:

- `job_files` จะถูกแทนด้วย `job_items`
- `jobs.pairs_data` จะเป็น input/cache ชั่วคราว ไม่ใช่ source of truth
- real-time fields ใน `boards` จะถูกย้ายไป `board_status`
- `profiles.data.savedTestCases` และ `profiles.data.savedTestCaseSets` จะถูก backfill ไป `test_cases`, `test_sets`, `test_set_items`
- tag fields ที่กระจายในหลายตารางควรถูกรวมเป็น `tags` + `tags_map` เมื่อ execution model เสถียรแล้ว
- output ขนาดใหญ่ เช่น log/waveform/report ควรแยกไป `result_files` แทนการเก็บรวมใน `results`

ดู target schema และ migration strategy ได้ที่ [PROPOSED_DATABASE_REDESIGN.md](./PROPOSED_DATABASE_REDESIGN.md)

---

## 1. ตาราง `boards` (Hardware Inventory)
| Column | Type | Constraints | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `id` | String(64) | Primary Key | MAC Address หรือ Unique ID |
| `name` | String(255) | NOT NULL | ชื่อบอร์ด |
| `ip_address` | String(64) | default "" | IP ล่าสุด |
| `mac_address` | String(64) | NULL | MAC Address จริง |
| `firmware_version`| String(128) | NULL | เวอร์ชัน Software |
| `model` | String(128) | NULL | รุ่นของบอร์ด |
| `tag` | String(128) | NULL | ป้ายกำกับบอร์ด |
| `connections` | JSON | NULL | ข้อมูลการเชื่อมต่อเสริม |
| `state` | String(32) | default 'offline'| สถานะปัจจุบัน |
| `cpu_temp` | Float | NULL | อุณหภูมิ CPU |
| `cpu_load` | Float | NULL | โหลด CPU |
| `ram_usage` | Float | NULL | การใช้ RAM |
| `current_job_id` | String(32) | NULL | Job ที่กำลังรันอยู่ |
| `last_heartbeat` | DateTime | NULL | เวลาที่ติดต่อล่าสุด |
| `fpga_status` | String(32) | NULL | สถานะ FPGA |
| `arm_status` | String(32) | NULL | สถานะ ARM Processor |
| `created_at` | DateTime | default utcnow | |

## 2. ตาราง `board_status` (Real-time Telemetry)
*ใช้สำหรับแยกข้อมูลที่มีการอัปเดตบ่อย (Heartbeat) ออกจากข้อมูลหลัก*
| Column | Type | Constraints | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `board_id` | String(64) | PK, FK | เชื่อมไปยัง `boards.id` |
| `state` | String(32) | NULL | สถานะการทำงาน |
| `cpu_temp` | Float | NULL | |
| `cpu_load` | Float | NULL | |
| `ram_usage` | Float | NULL | |
| `current_job_id` | String(32) | NULL | |
| `last_heartbeat` | DateTime | NULL | |
| `fpga_status` | String(32) | NULL | |
| `arm_status` | String(32) | NULL | |
| `updated_at` | DateTime | default utcnow | เวลาที่อัปเดตข้อมูลล่าสุด |

## 3. ตาราง `jobs` (Execution Queue)
| Column | Type | Constraints | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `id` | String(32) | Primary Key | |
| `name` | String(255) | NOT NULL | ชื่อโปรเจกต์/งาน |
| `vcd_file_id` | String(36) | Foreign Key | เชื่อมไปยัง `files.id` |
| `firmware_file_id`| String(36) | Foreign Key | เชื่อมไปยัง `files.id` |
| `target_board_id` | String(32) | NULL | |
| `target_board_ids` | JSON | NULL | |
| `assigned_board_id`| String(32) | NULL | |
| `priority` | Integer | default 0 | |
| `queue_position` | Integer | default 0 | |
| `timeout_seconds` | Integer | default 60 | |
| `retries` | Integer | default 0 | |
| `enable_picoscope` | Boolean | default False | |
| `save_to_db` | Boolean | default True | |
| `state` | String(32) | default 'pending'| |
| `progress` | Integer | default 0 | |
| `current_step` | String(255) | NULL | |
| `error_message` | Text | NULL | |
| `tag` | String(255) | NULL | |
| `tag_color` | String(32) | NULL | |
| `client_id` | String(128) | NULL | |
| `profile_id` | String(128) | NULL | |
| `profile_display_name`| String(255)| NULL | |
| `config_name` | String(255) | NULL | |
| `pairs_data` | JSON | NULL | |
| `created_at` | DateTime | default utcnow | |
| `started_at` | DateTime | NULL | |
| `completed_at` | DateTime | NULL | |

## 4. ตาราง `results` (Final Outcomes)
| Column | Type | Constraints | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `id` | String(32) | Primary Key | |
| `job_id` | String(32) | Foreign Key | เชื่อมไปยัง `jobs.id` |
| `job_name` | String(255) | NOT NULL | |
| `board_id` | String(64) | Foreign Key | เชื่อมไปยัง `boards.id` |
| `board_name` | String(255) | NOT NULL | |
| `passed` | Boolean | NOT NULL | |
| `started_at` | DateTime | NOT NULL | |
| `completed_at` | DateTime | NOT NULL | |
| `duration_seconds` | Float | NOT NULL | |
| `vcd_file_id` | String(36) | Foreign Key | เชื่อมไปยัง `files.id` |
| `firmware_file_id`| String(36) | Foreign Key | เชื่อมไปยัง `files.id` |
| `error_message` | Text | NULL | |
| `packet_count` | Integer | default 0 | |
| `crc_errors` | Integer | default 0 | |
| `console_log` | Text | NULL | |
| `waveform_hdf5_path`| String(512) | NULL | |
| `metrics` | JSON | NULL | |

## 5. ตาราง `job_files` (Test Items)
| Column | Type | Constraints | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `id` | String(32) | Primary Key | |
| `job_id` | String(32) | Foreign Key | เชื่อมไปยัง `jobs.id` |
| `name` | String(255) | NOT NULL | |
| `status` | String(32) | default 'pending'| |
| `result` | String(32) | NULL | |
| `order` | Integer | NOT NULL | |
| `vcd` | String(255) | NULL | |
| `erom` | String(255) | NULL | |
| `ulp` | String(255) | NULL | |
| `try_count` | Integer | NULL | |
| `test_case_name` | String(255) | NULL | |
| `created_at` | DateTime | default utcnow | |
| `updated_at` | DateTime | default utcnow | |

## 6. ตาราง `test_cases` (Definitions)
| Column | Type | Constraints | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `id` | String(32) | Primary Key | |
| `name` | String(255) | NOT NULL | |
| `vcd_file_id` | String(36) | Foreign Key | เชื่อมไปยัง `files.id` |
| `firmware_filename`| String(255) | NULL | |
| `vcd_filename` | String(255) | NULL | |
| `ulp_filename` | String(255) | NULL | |
| `mdi_text_filename`| String(255) | NULL | |
| `try_count` | Integer | NULL | |
| `status_cached` | String(64) | NULL | |
| `tags` | String(255) | NULL | |
| `owner_id` | String(128) | NULL | |
| `owner_display_name`| String(255)| NULL | |
| `visibility` | String(32) | default 'public'| |
| `created_at` | DateTime | default utcnow | |
| `updated_at` | DateTime | default utcnow | |

## 7. ตาราง `test_sets` (Suites)
| Column | Type | Constraints | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `id` | String(32) | Primary Key | |
| `name` | String(255) | NOT NULL | |
| `tags` | String(255) | NULL | |
| `owner_id` | String(128) | NULL | |
| `owner_display_name`| String(255)| NULL | |
| `visibility` | String(32) | default 'public'| |
| `created_at` | DateTime | default utcnow | |
| `updated_at` | DateTime | default utcnow | |

## 8. ตาราง `test_set_items` (Suite Mapping)
| Column | Type | Constraints | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `id` | String(32) | Primary Key | |
| `test_set_id` | String(32) | Foreign Key | เชื่อมไปยัง `test_sets.id` |
| `test_case_id` | String(32) | Foreign Key | เชื่อมไปยัง `test_cases.id` |
| `execution_order`| Integer | NOT NULL | |
| `created_at` | DateTime | default utcnow | |

---

## ตารางอื่นๆ (Auxiliary Tables)
- **`files`**: id, filename, file_type, storage_path, checksum_sha256, size_bytes, uploaded_at, updated_at, set_id, owner_id, visibility, library_tags, tag_color
- **`profiles`**: id, name, data, updated_at
- **`notifications`**: id, user_id, type, title, message, data, read, created_at
- **`test_commands`**: id, user_id, name, command, description, created_at, updated_at
- **`file_tags`**: id, user_id, tag, color, created_at, updated_at

---

[🔙 กลับไปยังแผนผังหลัก (Master Map)](./FE_MENU_API_DB_MAPPING.md)
