# รายงานรายละเอียด API ทั้งหมด (Exhaustive API Function Report)
**จำนวนทั้งหมด:** 84 ฟังก์ชัน | **สถานะ:** ตรวจสอบแล้วตรงกับ Source Code ปัจจุบัน; ไม่ใช่ Target Contract หลัง redesign

[กลับสู่หน้าหลักสถาปัตยกรรมระบบ (System Architecture & Data Mapping)](./FE_MENU_API_DB_MAPPING.md)

---

## 0. สรุปแนวทางลด API ที่เกินความจำเป็น

เอกสารนี้ยังคงเก็บรายชื่อ API ทั้งหมดที่มีอยู่ใน source code เพื่อใช้ audit และ migration แต่ API บางส่วนไม่ควรถูกถือเป็น contract ระยะยาว เพราะผูกกับ schema legacy หรือยังซ้ำกับ endpoint กลุ่มอื่น

### API Contract ระยะยาวที่ควรคงไว้

| กลุ่ม | Endpoint Group | เหตุผล |
| :--- | :--- | :--- |
| System | `/api/health`, `/api/system/health` | แยก liveness เบื้องต้นกับ health สำหรับ dashboard |
| Boards | `/api/boards` | จัดการ inventory และอ่านสถานะจาก `board_status` |
| Files | `/api/files` | เป็น file registry กลาง |
| Test Definition | `/api/test-management/test-cases`, `/api/test-management/test-sets` | อ่าน/เขียนจาก normalized test tables |
| Jobs | `/api/jobs` | จัดการ queue และ execution aggregate |
| Job Items | `/api/jobs/{job_id}/items` *(target หลัง redesign)* | แทน job file APIs เดิม |
| Results | `/api/results` | อ่านผลลัพธ์จาก `results` และ output จาก `result_files` |
| Profiles | `/api/profiles` | เก็บ profile metadata และ preferences เท่านั้น |
| Notifications | `/api/notifications` | event สำหรับ frontend |
| WebSocket | `/ws/system`, `/ws/boards`, `/ws/jobs` | real-time event stream |

### API ที่ควรลดบทบาท / Deprecated หลัง migration

| API / Function | สถานะที่แนะนำ | เหตุผล |
| :--- | :--- | :--- |
| `getJobFiles()`, `stopJobFile()`, `rerunJobFile()`, `moveJobFile()`, `deleteJobFile()` | เปลี่ยนเป็น Job Item APIs | `job_files` ซ้ำกับ `job_items` ใน redesign |
| `getJobPairs()` | Deprecated | `pairs_data` เป็น cache/input ชั่วคราว ไม่ควรเป็น source of truth |
| `getAllTestCasesFromProfiles()` | Deprecated | หลัง cutover ต้องอ่านจาก `test_cases`/`test_suites` ไม่ใช่ `profiles.data` |
| `patchFileLibraryTags()`, `updateJobTag()` | ใช้ชั่วคราว | ถ้ารวม tag system แล้วควรไปที่ `tags` + `tags_map` |
| `getMqttStatus()` | Optional | ใช้เฉพาะเมื่อระบบมี MQTT จริงใน production |
| `getBoardApiStatus()` | Optional | ใช้เฉพาะกรณีต้อง monitor agent API แยกจาก board heartbeat |
| `rebootBoard()`, `shutdownBoard()`, `updateBoardFirmware()`, `runBoardSelfTest()`, `batchBoardActions()`, `getBoardSSHConnection()` | Experimental/Internal จนกว่า Agent contract เสถียร | เป็น hardware command ที่ต้องมี retry/audit/security ชัดเจนก่อนเปิดเป็น public API |

### หลักการออกแบบ API หลัง redesign

1. API เขียนข้อมูลเข้าตาราง canonical เท่านั้น; legacy table เขียนได้เฉพาะช่วง dual-write migration
2. Endpoint ที่อ่าน job detail ต้องประกอบข้อมูลจาก `jobs`, `job_targets`, `job_items`, `results`, `result_files`
3. Endpoint ที่เกี่ยวกับไฟล์ต้องอ้าง `files.id` หรือ `result_files.id` ไม่อ้าง filename เป็น primary reference
4. Hardware command ต้องมี audit trail และ status feedback ผ่าน WebSocket ไม่ใช่ fire-and-forget

---

## 1. ระบบสุขภาพและสถานะเซิร์ฟเวอร์ (System Health)

| ลำดับ | ชื่อฟังก์ชัน (Frontend) | รูปแบบ (Pattern) | วิธี (Method) | คำอธิบายหน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **1.1** | `getHealth()` | CRUD พื้นฐาน | GET | ตรวจสอบสถานะ Server เบื้องต้น |
| **1.2** | `getSystemHealth()` | CRUD พื้นฐาน | GET | สรุปภาพรวมบอร์ดและพื้นที่เก็บข้อมูล |
| **1.3** | `getStorageStatus()` | CRUD พื้นฐาน | GET | ตรวจสอบปริมาณการใช้ Disk Storage |
| **1.4** | `getBoardApiStatus()` | ควบคุมฮาร์ดแวร์ | GET | เช็คสถานะการเชื่อมต่อกับ REST API บอร์ด |
| **1.5** | `getMqttStatus()` | CRUD พื้นฐาน | GET | เช็คสถานะ MQTT Broker |

---

## 2. ระบบจัดการบอร์ดฮาร์ดแวร์ (Boards/Devices)

| ลำดับ | ชื่อฟังก์ชัน (Frontend) | รูปแบบ (Pattern) | วิธี (Method) | คำอธิบายหน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **2.1** | `getBoards()` | CRUD พื้นฐาน | GET | ดึงรายการบอร์ดทั้งหมด |
| **2.2** | `getBoardById()` | CRUD พื้นฐาน | GET | ดึงรายละเอียดบอร์ดรายตัว |
| **2.3** | `createBoard()` | อัปเดตแบบ Real-time | POST | ลงทะเบียนบอร์ดใหม่ (แจ้งเตือนผู้อื่นทันที) |
| **2.4** | `updateBoard()` | อัปเดตแบบ Real-time | PATCH | แก้ไขข้อมูลบอร์ด (Sync ทุกหน้าจอ) |
| **2.5** | `deleteBoard()` | อัปเดตแบบ Real-time | DELETE | ลบบอร์ดออกจากระบบ |
| **2.6** | `getBoardStatus()` | ควบคุมฮาร์ดแวร์ | GET | ดึงสถานะเชิงลึกจากบอร์ด |
| **2.7** | `getBoardTelemetry()` | ควบคุมฮาร์ดแวร์ | GET | ดึงค่า Volt, Temp, Signal ล่าสุด |
| **2.8** | `rebootBoard()` | ควบคุมฮาร์ดแวร์ | POST | สั่ง Restart บอร์ดผ่าน Agent |
| **2.9** | `shutdownBoard()` | ควบคุมฮาร์ดแวร์ | POST | สั่งปิดบอร์ด |
| **2.10** | `pauseBoardQueue()` | อัปเดตแบบ Real-time | POST | หยุดรับงาน (แจ้งสถานะไปทุกหน้าจอ) |
| **2.11** | `resumeBoardQueue()` | อัปเดตแบบ Real-time | POST | กลับมาเปิดรับงาน |
| **2.12** | `updateBoardFirmware()`| จัดการไฟล์/พื้นที่เก็บข้อมูล | POST | อัปเดต Firmware (มีการเก็บไฟล์ BIN) |
| **2.13** | `runBoardSelfTest()` | ควบคุมฮาร์ดแวร์ | POST | สั่งให้บอร์ดรันโปรแกรมตรวจสอบตัวเอง |
| **2.14** | `batchBoardActions()` | ควบคุมฮาร์ดแวร์ | POST | สั่งงานพร้อมกันหลายเครื่อง (Batch) |
| **2.15** | `getBoardSSHConnection()`| อัปเดตแบบ Real-time | WS | เชื่อมต่อหน้าจอ Terminal |

---

## 3. ระบบจัดการงานและคิว (Jobs/Batches)

| ลำดับ | ชื่อฟังก์ชัน (Frontend) | รูปแบบ (Pattern) | วิธี (Method) | คำอธิบายหน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **3.1** | `getJobs()` | CRUD พื้นฐาน | GET | ดึงรายการงานในคิวและประวัติ |
| **3.2** | `getJobById()` | CRUD พื้นฐาน | GET | ดูรายละเอียดงานและไฟล์ย่อย |
| **3.3** | `createJob()` | อัปเดตแบบ Real-time | POST | สร้างงานใหม่ (แจ้งเข้าคิวทันที) |
| **3.4** | `updateJob()` | อัปเดตแบบ Real-time | PUT | แก้ไขข้อมูลงาน |
| **3.5** | `startJob()` | ควบคุมฮาร์ดแวร์ | POST | สั่งให้เริ่มรันงานบนบอร์ด |
| **3.6** | `stopJob()` | ควบคุมฮาร์ดแวร์ | POST | สั่งหยุดงานที่กำลังรันอยู่ |
| **3.7** | `stopAllJobs()` | ควบคุมฮาร์ดแวร์ | POST | สั่งหยุดงานทุกเครื่อง (Panic Stop) |
| **3.8** | `exportJob()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | GET | ส่งออกข้อมูลงานเป็น JSON |
| **3.9** | `runCommand()` | ควบคุมฮาร์ดแวร์ | POST | ส่งคำสั่งเดี่ยวไปรันแบบด่วน |
| **3.10** | `reorderJob()` | อัปเดตแบบ Real-time | POST | เปลี่ยนลำดับคิว |
| **3.11** | `updateJobTag()` | อัปเดตแบบ Real-time | PATCH | แก้ไข Tag หรือสีของงาน |
| **3.12** | `deleteJob()` | อัปเดตแบบ Real-time | DELETE | ลบงานออกจากระบบ |
| **3.13** | `uploadJob()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | POST | สร้างงานโดยการอัปโหลดไฟล์ตรง |
| **3.14** | `startJobQueue()` | ควบคุมฮาร์ดแวร์ | POST | เปิดระบบ Scheduler หลัก |
| **3.15** | `stopJobQueue()` | ควบคุมฮาร์ดแวร์ | POST | ปิดระบบ Scheduler หลัก |
| **3.16** | `getJobStatusSummary()`| CRUD พื้นฐาน | GET | สรุปจำนวนงานแยกตามสถานะ |

---

## 4. ระบบจัดการไฟล์ย่อยในงาน (Job Files)

| ลำดับ | ชื่อฟังก์ชัน (Frontend) | รูปแบบ (Pattern) | วิธี (Method) | คำอธิบายหน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **4.1** | `getJobFiles()` | CRUD พื้นฐาน | GET | ดึงรายการไฟล์ทดสอบในงาน |
| **4.2** | `getJobPairs()` | CRUD พื้นฐาน | GET | ดึงข้อมูลคู่พารามิเตอร์ของงาน |
| **4.3** | `stopJobFile()` | ควบคุมฮาร์ดแวร์ | POST | หยุดรันเฉพาะไฟล์ย่อยนี้ |
| **4.4** | `rerunJobFile()` | ควบคุมฮาร์ดแวร์ | POST | สั่งรันใหม่เฉพาะไฟล์ย่อยนี้ |
| **4.5** | `moveJobFile()` | อัปเดตแบบ Real-time | POST | เปลี่ยนลำดับไฟล์ย่อย |
| **4.6** | `deleteJobFile()` | อัปเดตแบบ Real-time | DELETE | ลบไฟล์ย่อยออกจากงาน |

---

## 5. ระบบจัดการไฟล์หลักและคลังเก็บ (Files Library)

| ลำดับ | ชื่อฟังก์ชัน (Frontend) | รูปแบบ (Pattern) | วิธี (Method) | คำอธิบายหน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **5.1** | `checkFile()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | POST | ตรวจสอบไฟล์ซ้ำจาก Metadata |
| **5.2** | `uploadFile()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | POST | อัปโหลดไฟล์ใหม่เข้าคลัง |
| **5.3** | `getFiles()` | CRUD พื้นฐาน | GET | ดูรายการไฟล์ทั้งหมดในคลัง |
| **5.4** | `getFileById()` | CRUD พื้นฐาน | GET | ดึงข้อมูลไฟล์รายตัว |
| **5.5** | `deleteFile()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | DELETE | ลบไฟล์ออกจากเซิร์ฟเวอร์ |
| **5.6** | `patchFileLibraryTags()`| อัปเดตแบบ Real-time | PATCH | แก้ไขป้ายกำกับไฟล์ (Sync หน้าจอ) |
| **5.7** | `saveSetFiles()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | POST | บันทึกกลุ่มไฟล์เป็นชุด (Set) |
| **5.8** | `listSetFiles()` | CRUD พื้นฐาน | GET | รายชื่อไฟล์ในชุดทดสอบ |
| **5.9** | `restoreSetFilesToLibrary()`| จัดการไฟล์/พื้นที่เก็บข้อมูล | POST | กู้คืนไฟล์จาก Set กลับเข้า Library |
| **5.10** | `deleteSet()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | DELETE | ลบชุดการทดสอบและไฟล์ที่เกี่ยวข้อง |

---

## 6. ระบบโปรไฟล์และการตั้งค่า (Profiles)

| ลำดับ | ชื่อฟังก์ชัน (Frontend) | รูปแบบ (Pattern) | วิธี (Method) | คำอธิบายหน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **6.1** | `createProfileApi()` | CRUD พื้นฐาน | POST | สร้างโปรไฟล์ใหม่ |
| **6.2** | `listProfiles()` | CRUD พื้นฐาน | GET | ดูรายชื่อโปรไฟล์ทั้งหมด |
| **6.3** | `getProfile()` | CRUD พื้นฐาน | GET | ดึงข้อมูลพื้นฐานโปรไฟล์ |
| **6.4** | `getAllTestCasesFromProfiles()`| CRUD พื้นฐาน | GET | ดึง Test Case จากทุกโปรไฟล์ |
| **6.5** | `getProfileData()` | CRUD พื้นฐาน | GET | ดึงข้อมูลการตั้งค่าเชิงลึก |
| **6.6** | `putProfileData()` | CRUD พื้นฐาน | PUT | บันทึก/ซิงค์ข้อมูลการตั้งค่า |
| **6.7** | `updateProfileNameApi()`| อัปเดตแบบ Real-time | PATCH | แก้ไขชื่อโปรไฟล์ |
| **6.8** | `deleteProfileApi()` | CRUD พื้นฐาน | DELETE | ลบโปรไฟล์ |

---

## 7. ระบบผลลัพธ์และการแจ้งเตือน (Results & Notifications)

| ลำดับ | ชื่อฟังก์ชัน (Frontend) | รูปแบบ (Pattern) | วิธี (Method) | คำอธิบายหน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **7.1** | `getResults()` | CRUD พื้นฐาน | GET | ดึงรายการประวัติการรันทั้งหมด |
| **7.2** | `getResultById()` | CRUD พื้นฐาน | GET | ดูรายละเอียดผลการทดสอบเชิงลึก |
| **7.3** | `getResultWaveform()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | GET | ดึงข้อมูล Waveform HDF5 |
| **7.4** | `getResultLog()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | GET | ดึง Console Log จากเซิร์ฟเวอร์ |
| **7.5** | `deleteResult()` | จัดการไฟล์/พื้นที่เก็บข้อมูล | DELETE | ลบประวัติผลและไฟล์ Waveform |
| **7.6** | `getNotifications()` | CRUD พื้นฐาน | GET | ดึงรายการแจ้งเตือน |
| **7.7** | `createNotification()` | อัปเดตแบบ Real-time | POST | สร้างรายการแจ้งเตือนใหม่ |
| **7.8** | `markNotificationRead()`| อัปเดตแบบ Real-time | POST | ทำเครื่องหมายว่าอ่านแล้ว |
| **7.9** | `markAllNotificationsRead()`| อัปเดตแบบ Real-time | POST | อ่านแจ้งเตือนทั้งหมด |

---

## 8. ระบบบริหารจัดการการทดสอบ (Test Management)

| ลำดับ | ชื่อฟังก์ชัน (Internal/Backend) | รูปแบบ (Pattern) | วิธี (Method) | คำอธิบายหน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **8.1** | `list_test_cases` | CRUD พื้นฐาน | GET | ดึงรายการ Test Case ทั้งหมด |
| **8.2** | `create_test_case` | CRUD พื้นฐาน | POST | สร้างรูปแบบการทดสอบใหม่ |
| **8.3** | `get_test_case` | CRUD พื้นฐาน | GET | ดูรายละเอียด Test Case รายตัว |
| **8.4** | `update_test_case` | CRUD พื้นฐาน | PATCH | แก้ไขข้อมูล Test Case |
| **8.5** | `delete_test_case` | CRUD พื้นฐาน | DELETE | ลบ Test Case ออกจากระบบ |
| **8.6** | `list_test_sets` | CRUD พื้นฐาน | GET | ดึงรายการชุดการทดสอบทั้งหมด |
| **8.7** | `create_test_set` | CRUD พื้นฐาน | POST | สร้างชุดการทดสอบใหม่ |
| **8.8** | `get_test_set` | CRUD พื้นฐาน | GET | ดูรายละเอียดชุดการทดสอบ |
| **8.9** | `list_test_set_items` | CRUD พื้นฐาน | GET | ดูรายชื่อไฟล์ทดสอบภายในชุด |
| **8.10** | `add_test_case_to_set` | CRUD พื้นฐาน | POST | เพิ่ม Test Case เข้าไปในชุด |
| **8.11** | `update_test_set` | CRUD พื้นฐาน | PATCH | แก้ไขข้อมูลพื้นฐานของชุด |
| **8.12** | `delete_test_set` | CRUD พื้นฐาน | DELETE | ลบชุดการทดสอบ |
| **8.13** | `remove_test_case_from_set`| CRUD พื้นฐาน | DELETE | นำไฟล์ทดสอบออกจากชุด |
| **8.14** | `update_test_case_order`| CRUD พื้นฐาน | PATCH | เปลี่ยนลำดับการรันภายในชุด |

---

## 9. ระบบช่วยเชื่อมต่อแบบ Real-time (WebSockets)

| ลำดับ | ชื่อฟังก์ชัน (Frontend) | รูปแบบ (Pattern) | วิธี (Method) | คำอธิบายหน้าที่ |
| :--- | :--- | :--- | :--- | :--- |
| **9.1** | `createWebSocket()` | อัปเดตแบบ Real-time | WS | สร้างการเชื่อมต่อเพื่อรับ Event แบบ Real-time |

---

**สรุปภาพรวม:** ระบบใช้มาตรฐานการออกแบบ **Pattern-based API** เพื่อความสม่ำเสมอในการจัดการข้อมูล โดยแบ่งออกเป็น 4 รูปแบบหลักที่สะท้อนถึงการทำงานจริงทั้งในส่วนของ Database, File System, Hardware และ WebSocket ครับ
