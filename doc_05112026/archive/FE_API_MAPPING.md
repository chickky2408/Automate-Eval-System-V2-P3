# 🔗 การเชื่อมโยง Frontend API และ Backend เชิงลึก (Detailed API-DB Mapping)
**วันที่สกัดข้อมูล:** 11 พฤษภาคม 2026
**แหล่งข้อมูล:** `frontend/src/services/api.js` และ `backend/routers/*.py`

เอกสารนี้แสดงรายละเอียดการทำงานของ API ตั้งแต่จุดที่ถูกเรียกใน UI จนถึงการเปลี่ยนแปลงระดับฐานข้อมูล

## 1. ระบบจัดการงานทดสอบ (Jobs & Queues)

> [!NOTE]
> `createJob` บันทึกลง `jobs` (DB) แต่ข้อมูลไฟล์ย่อยถูกสร้างใน **FEJobStore (Memory)** ก่อน แล้วค่อย Sync ไปยัง `job_files` (DB) ผ่าน `job_file_store`

| ฟังก์ชัน (Frontend) | เส้นทาง (Endpoint) | จุดเรียกใช้งาน (UI Trigger) | ผลกระทบต่อ DB (Action) | ตารางที่เกี่ยวข้อง | WebSocket Sync |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `getJobs()` | `GET /api/jobs` | หน้า Dashboard / History | **SELECT** เพื่อแสดงรายการงาน | `jobs` | - |
| `createJob()` | `POST /api/jobs` | ปุ่ม "Run Test" / "Create" | **INSERT** งานใหม่ + ไฟล์ย่อย | `jobs`, `job_files` + Memory | `JOB_CREATED` |
| `updateJob()` | `PUT /api/jobs/{id}` | หน้า Edit Job | **UPDATE** ข้อมูล metadata | `jobs`, `job_files` | `JOB_UPDATED` |
| `startJob()` | `POST /api/jobs/{id}/start` | ปุ่ม Play บน Dashboard | **UPDATE** state, ล็อกบอร์ด | `jobs`, `boards`, `board_status` | `JOB_PROGRESS` |
| `stopJob()` | `POST /api/jobs/{id}/stop` | ปุ่ม Stop บน Dashboard | **UPDATE** state + ปลดล็อกบอร์ด | `jobs`, `boards`, `board_status` | `JOB_UPDATED` |
| `deleteJob()` | `DELETE /api/jobs/{id}` | ปุ่มถังขยะในรายการ Job | **DELETE** Job + ปลดล็อกบอร์ด | `jobs`, `job_files`, `boards` | `JOB_DELETED` |
| `reorderJob()` | `POST /api/jobs/{id}/reorder`| ลากวางลำดับคิว (D&D) | **UPDATE** `queue_position` | `jobs` | `QUEUE_UPDATED` |

## 2. ระบบจัดการบอร์ด (Hardware Inventory)

> [!NOTE]
> `createBoard` สร้างข้อมูลใน `boards` **และ** `board_status` พร้อมกันเสมอ เพื่อให้มีแถว Telemetry พร้อมรับ Heartbeat ทันที

| ฟังก์ชัน (Frontend) | เส้นทาง (Endpoint) | จุดเรียกใช้งาน (UI Trigger) | ผลกระทบต่อ DB (Action) | ตารางที่เกี่ยวข้อง | WebSocket Sync |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `getBoards()` | `GET /api/boards` | หน้า Inventory / Dashboard | **SELECT** JOIN boards + board_status | `boards`, `board_status`| - |
| `createBoard()` | `POST /api/boards` | ปุ่ม "Add New Board" | **INSERT** ข้อมูลบอร์ดใหม่ | `boards`, `board_status`| `BOARD_ADDED` |
| `updateBoard()` | `PATCH /api/boards/{id}` | หน้า Settings ของบอร์ด | **UPDATE** ข้อมูล (แยก boards vs board_status อัตโนมัติ) | `boards` หรือ `board_status` | `BOARD_UPDATED` |
| `deleteBoard()` | `DELETE /api/boards/{id}` | ปุ่มลบบอร์ดใน Settings | **DELETE** จาก boards (Cascade board_status) | `boards`, `board_status`| `BOARD_DELETED` |
| `rebootBoard()` | `POST /api/boards/{id}/reboot`| ปุ่ม Reboot ใน UI | **NONE** (ส่งคำสั่ง HTTP ตรงไปที่ Agent) | - | - |

## 3. ระบบจัดการคลังไฟล์ (File Library)

| ฟังก์ชัน (Frontend) | เส้นทาง (Endpoint) | จุดเรียกใช้งาน (UI Trigger) | ผลกระทบต่อ DB (Action) | ตารางที่เกี่ยวข้อง | WebSocket Sync |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `uploadFile()` | `POST /api/files/upload` | ปุ่ม Upload / Drag & Drop | **INSERT** ทะเบียนไฟล์ใหม่ | `files` | `FILE_UPLOADED` |
| `getFiles()` | `GET /api/files` | หน้า File Library | **SELECT** รายการไฟล์ทั้งหมด | `files` | - |
| `deleteFile()` | `DELETE /api/files/{id}` | ปุ่มลบใน File Library | **DELETE** ข้อมูลและลบจาก Disk | `files` | `FILE_DELETED` |
| `patchFileLibraryTags()`| `PATCH /api/files/{id}/tags`| แก้ไข Tag หรือสีของไฟล์ | **UPDATE** `tags` หรือ `tag_color`| `files` | `FILE_UPDATED` |

## 4. ระบบวิเคราะห์ผล (Test Results & Analysis)

| ฟังก์ชัน (Frontend) | เส้นทาง (Endpoint) | จุดเรียกใช้งาน (UI Trigger) | ผลกระทบต่อ DB (Action) | ตารางที่เกี่ยวข้อง | WebSocket Sync |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `getResults()` | `GET /api/results` | หน้า Result History | **SELECT** ประวัติการทดสอบ | `results` | - |
| `getResultWaveform()`| `GET /api/results/{id}/wv` | ปุ่ม "View Waveform" | **SELECT** ดึง Path เพื่ออ่าน HDF5 | `results` | - |
| `deleteResult()` | `DELETE /api/results/{id}` | ปุ่มลบประวัติการทดสอบ | **DELETE** ประวัติและลบไฟล์ HDF5 | `results` | `RESULT_DELETED` |

## 5. ระบบโปรไฟล์และผู้ใช้งาน (Profiles & Users)

| ฟังก์ชัน (Frontend) | เส้นทาง (Endpoint) | จุดเรียกใช้งาน (UI Trigger) | ผลกระทบต่อ DB (Action) | ตารางที่เกี่ยวข้อง | WebSocket Sync |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `createProfileApi()` | `POST /api/profiles` | หน้าเลือกโปรไฟล์ / แรกเข้า | **INSERT** โปรไฟล์ใหม่ | `profiles` | - |
| `getProfileData()` | `GET /api/profiles/{id}/data`| เมื่อโหลดแอป (Load State) | **SELECT** ข้อมูลตั้งค่า | `profiles` | - |
| `updateProfileName()`| `PATCH /api/profiles/{id}` | แก้ไขชื่อใน Settings | **UPDATE** `name` | `profiles` | `PROFILE_UPDATED` |
| `putProfileData()` | `PUT /api/profiles/{id}/data`| เมื่อมีการเซฟการตั้งค่า | **UPDATE** `settings` (JSON) | `profiles` | - |

## 6. ระบบแจ้งเตือน (Notifications)

| ฟังก์ชัน (Frontend) | เส้นทาง (Endpoint) | จุดเรียกใช้งาน (UI Trigger) | ผลกระทบต่อ DB (Action) | ตารางที่เกี่ยวข้อง | WebSocket Sync |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `getNotifications()` | `GET /api/notifications` | เมื่อกดดูไอคอนกระดิ่ง | **SELECT** รายการแจ้งเตือน | `notifications` | - |
| `markNotificationRead()`| `POST /api/notifications/{id}/read`| เมื่อกดอ่านแจ้งเตือน | **UPDATE** `is_read = true` | `notifications` | `NOTIF_UPDATED` |
| `runCommand()` | `POST /api/jobs/run-command`| ปุ่มส่ง Custom Command | **INSERT** งานรันคำสั่ง | `test_commands`, `jobs` | `JOB_CREATED` |

## 7. ระบบสุขภาพของระบบ (System & Health)

| ฟังก์ชัน (Frontend) | เส้นทาง (Endpoint) | จุดเรียกใช้งาน (UI Trigger) | ผลกระทบต่อ DB (Action) | ตารางที่เกี่ยวข้อง | WebSocket Sync |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `getSystemHealth()` | `GET /api/system/health` | Dashboard Summary | **SELECT** สรุปภาพรวมระบบ | ทุกตารางหลัก | - |
| `getStorageStatus()` | `GET /api/system/storage`| หน้า Dashboard / Settings | **NONE** (อ่านค่าจาก Disk) | - | - |
| `getBoardApiStatus()`| `GET /api/system/board-api`| ตรวจสอบสถานะการเชื่อมต่อบอร์ด| **NONE** (Network Check) | - | - |

## 8. การควบคุมระดับสูง (Advanced Controls)

| ฟังก์ชัน (Frontend) | เส้นทาง (Endpoint) | จุดเรียกใช้งาน (UI Trigger) | ผลกระทบต่อ DB (Action) | ตารางที่เกี่ยวข้อง | WebSocket Sync |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `startJobQueue()` | `POST /api/jobs/queue/start`| ปุ่ม Start Queue | **UPDATE** สถานะคิวงาน | - | `QUEUE_STATUS` |
| `stopJobQueue()` | `POST /api/jobs/queue/stop` | ปุ่ม Stop Queue | **UPDATE** สถานะคิวงาน | - | `QUEUE_STATUS` |
| `batchBoardActions()`| `POST /api/boards/batch` | การสั่งงานบอร์ดแบบกลุ่ม | **UPDATE** สถานะบอร์ดหลายเครื่อง| `boards` | `BOARD_UPDATED` |
| `rerunJobFile()` | `POST /api/jobs/{id}/files/{fid}/rerun`| ปุ่มรันใหม่ในรายละเอียด Job| **UPDATE** สถานะไฟล์ย่อย | `job_files` | `JOB_PROGRESS` |
| `stopJobFile()` | `POST /api/jobs/{id}/files/{fid}/stop`| ปุ่มหยุดรันไฟล์ย่อย | **UPDATE** สถานะไฟล์ย่อย | `job_files` | `JOB_PROGRESS` |
| `saveSetFiles()` | `POST /api/sets/{id}/files`| เมื่อบันทึกชุดไฟล์ (Sets) | **INSERT** ข้อมูลชุดไฟล์ | `test_set_items` | - |

---

## 🔑 จุดสำคัญในการเชื่อมโยงข้อมูล (Key Logic)

1.  **Cascading Delete:** เมื่อมีการลบไฟล์จาก `File Library` ระบบจะตรวจสอบก่อนว่ามี `Job` ไหนใช้งานอยู่หรือไม่ เพื่อป้องกันปัญหา Broken Link
2.  **State Consistency:** การเปลี่ยนสถานะงานใน `jobs` จะมี Logic หลังบ้านไปเปลี่ยนสถานะใน `boards` เสมอ (เช่น เมื่องานจบ บอร์ดต้องกลับเป็น `online`)
3.  **Real-time Synchronization:** ทุกๆ API ที่เป็นสถานะ **Write (POST/PUT/PATCH/DELETE)** จะต้องมาคู่กับการส่งสัญญาณ **WebSocket** เสมอ เพื่อให้หน้าจอของผู้ใช้งานทุกคนในระบบเห็นข้อมูลเดียวกันทันที
