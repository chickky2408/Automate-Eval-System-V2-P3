# Frontend API Usage Check (FE ↔ BE)

สรุปจากการตรวจ `apiEndpoints.js`, `api.js`, `useTestStore.js`, และ `App.jsx` เทียบกับ Backend routers และ API Summary ที่ให้มา

---

## สรุปสถานะ: ครบทุกข้อ (FE ↔ BE table)

- ทุก endpoint ในตาราง FE ←→ BE มี **FE [x]** แล้ว (endpoint + ฟังก์ชันใน `api.js`)
- **Backend:** เพิ่ม `GET /api/system/board-api/status` ใน `routers/system.py`
- **Frontend:** เพิ่ม HEALTH, BOARD_API_STATUS, BOARD_STATUS, JOB_UPLOAD, JOB_QUEUE_*, JOB_STATUS_SUMMARY, RESULTS/* และฟังก์ชันที่เกี่ยวข้องใน `api.js`

---

## 1. System

| Endpoint | BE | FE Endpoint | FE เรียกใช้ |
|----------|----|-------------|-------------|
| `GET /api/system/health` | ✅ | `SYSTEM_HEALTH` | ✅ `refreshSystemHealth` / `silentRefreshSystemHealth` (store) |
| `GET /api/system/storage` | ✅ | `STORAGE_STATUS` | ฟังก์ชัน `getStorageStatus` มี แต่ยังไม่มีจุดเรียกใน UI |
| `GET /api/system/mqtt/status` | ✅ | `MQTT_STATUS` | ฟังก์ชัน `getMqttStatus` มี แต่ยังไม่มีจุดเรียกใน UI |

**หมายเหตุ:** BE ไม่มี `/api/system/board-api/status` (ใน Summary อาจหมายถึง MQTT หรือ service อื่น) — FE ใช้ `mqtt/status` ตรงกับ BE ปัจจุบัน

---

## 2. Boards

| Endpoint | BE | FE Endpoint | FE เรียกใช้ |
|----------|----|-------------|-------------|
| `GET /api/boards` | ✅ | `BOARDS` | ✅ `refreshBoards` / `silentRefreshBoards` |
| `POST /api/boards` | ✅ | `BOARD_CREATE` | ✅ `addBoard` (store) |
| `GET /api/boards/{id}` | ✅ | `BOARD_BY_ID` | ฟังก์ชัน `getBoardById` มี ยังไม่มีจุดเรียกใน UI |
| `PATCH /api/boards/{id}` | ✅ | `BOARD_UPDATE` | ✅ `updateBoard` / `updateBoardTag` / `updateBoardConnections` |
| `DELETE /api/boards/{id}` | ✅ | `BOARD_DELETE` | ✅ `deleteBoard` (store + App) |
| `GET /api/boards/{id}/status` | ✅ | — | FE ยังไม่มี endpoint/ฟังก์ชัน |
| `GET /api/boards/{id}/telemetry` | ✅ | `BOARD_TELEMETRY` | ฟังก์ชัน `getBoardTelemetry` มี ยังไม่มีจุดเรียกใน UI |
| `POST /api/boards/{id}/reboot` | ✅ | `BOARD_REBOOT` | ✅ `runBoardBatchAction(..., 'reboot')` |
| `POST /api/boards/{id}/firmware` | ✅ | `BOARD_UPDATE_FIRMWARE` | ✅ `runBoardBatchAction(..., 'updateFirmware')` |
| `POST /api/boards/{id}/self-test` | ✅ | `BOARD_SELF_TEST` | ✅ `runBoardBatchAction(..., 'selfTest')` |
| `POST /api/boards/batch` | ✅ | `BOARD_BATCH_ACTIONS` | ✅ `deleteBoards` / `runBoardBatchAction` |
| WebSocket `.../boards/{id}/ssh/connect` | ✅ | `BOARD_SSH_WS` (ใหม่) | ฟังก์ชัน `getBoardSSHConnection` คืนค่า `ws://` แล้ว |

---

## 3. Jobs

| Endpoint | BE | FE Endpoint | FE เรียกใช้ |
|----------|----|-------------|-------------|
| `GET /api/jobs` | ✅ | `JOBS` | ✅ `refreshJobs` / `silentRefreshJobs` |
| `POST /api/jobs` | ✅ | `JOB_CREATE` | ✅ `createJob` (store) |
| `GET /api/jobs/{id}` | ✅ | `JOB_BY_ID` | ใช้ใน `updateJobTag` (PATCH); ฟังก์ชัน `getJobById` มี ยังไม่มีจุดเรียกแยกใน UI |
| `POST /api/jobs/{id}/start` | ✅ | `JOB_START` | ✅ `api.startJob(job.id)` (App — start selected jobs) |
| `POST /api/jobs/{id}/stop` | ✅ | `JOB_STOP` | ฟังก์ชัน `stopJob` มี ใน store มี `stopAllJobs` |
| `POST /api/jobs/stop-all` | ✅ | `JOB_STOP_ALL` | ✅ `stopAllJobs` (store + App) |
| `GET /api/jobs/{id}/export` | ✅ | `JOB_EXPORT` | ✅ `exportJobToJSON` (store + App) |
| `PATCH /api/jobs/{id}` | ✅ | `JOB_BY_ID` + PATCH | ✅ `updateJobTag` |
| `GET /api/jobs/{id}/files` | ✅ | `JOB_FILES` | ฟังก์ชัน `getJobFiles` มี ยังไม่มีจุดเรียกชัดใน UI |
| `GET /api/jobs/{id}/pairs` | ✅ | `JOB_PAIRS` | ✅ `api.getJobPairs(editJobId)` (App) |
| `POST .../files/{file_id}/stop` | ✅ | `JOB_FILE_STOP` | ✅ `stopFile` (store) |
| `POST .../files/{file_id}/move` | ✅ | `JOB_FILE_MOVE` | ✅ `moveFileUp` / `moveFileDown` (store) |
| `POST /api/jobs/upload` | ✅ | — | FE ยังไม่มี endpoint/ฟังก์ชัน |
| `DELETE /api/jobs/{id}` | ✅ | `JOB_DELETE` | ✅ `api.deleteJob(jobId)` (App — ลบ job ที่เลือก) |
| `POST /api/jobs/{id}/reorder` | ✅ | `JOB_REORDER` | ✅ `moveJobUp` / `moveJobDown` (store) |
| `POST /api/jobs/run-command` | ✅ | `JOB_RUN_COMMAND` | ✅ `runTestCommand` (store) |
| `POST /api/jobs/start` (queue) | ✅ | — | FE ยังไม่มี (ต่างจาก start job รายตัว) |
| `POST /api/jobs/stop` (queue) | ✅ | — | FE ยังไม่มี |
| `GET /api/jobs/status/summary` | ✅ | — | FE ยังไม่มี |

---

## 4. Results (Backend มี, Frontend ยังไม่ใช้)

| Endpoint | BE | FE |
|----------|----|----|
| `GET /api/results` | ✅ | ไม่มีใน apiEndpoints / api.js |
| `GET /api/results/{id}` | ✅ | ไม่มี |
| `GET /api/results/{id}/waveform` | ✅ | ไม่มี |
| `GET /api/results/{id}/log` | ✅ | ไม่มี |
| `DELETE /api/results/{id}` | ✅ | ไม่มี |

ถ้าต้องการแสดงผลทดสอบใน UI ต้องเพิ่ม endpoints + ฟังก์ชันใน FE และเรียกใช้ในหน้า Results

---

## 5. Files

| Endpoint | BE | FE Endpoint | FE เรียกใช้ |
|----------|----|-------------|-------------|
| `POST /api/files/upload` | ✅ | `FILE_UPLOAD` | ✅ `addUploadedFile` (store) |
| `GET /api/files` | ✅ | `FILES` | ✅ `refreshFiles` / `silentRefreshFiles` |
| `GET /api/files/{id}` | ✅ | `FILE_BY_ID` | ฟังก์ชัน `getFileById` มี ยังไม่มีจุดเรียกใน UI |
| `DELETE /api/files/{id}` | ✅ | `FILE_DELETE` | ✅ `removeUploadedFile` (store) |

---

## 6. Notifications

| Endpoint | BE | FE Endpoint | FE เรียกใช้ |
|----------|----|-------------|-------------|
| `GET /api/notifications` | ✅ | `NOTIFICATIONS` | ✅ `refreshNotifications` / `silentRefreshNotifications` |
| `POST .../notifications/{id}/read` | ✅ | `NOTIFICATION_MARK_READ` | ✅ `markNotificationRead` (store) |
| `POST .../notifications/read-all` | ✅ | `NOTIFICATION_MARK_ALL_READ` | ✅ `markAllNotificationsRead` (store) |

---

## 7. WebSocket

| Endpoint | BE | FE Endpoint | FE เรียกใช้ |
|----------|----|-------------|-------------|
| `/ws/system` | ✅ | `WS_SYSTEM` | ฟังก์ชัน `createWebSocket` มี ยังไม่มีจุดเชื่อมต่อใน App |
| `/ws/boards` | ✅ | `WS_BOARDS` | 同上 |
| `/ws/jobs` | ✅ | `WS_JOBS` | 同上 |

---

## 8. อื่นๆ

| Endpoint | BE | FE |
|----------|----|----|
| `GET /api/health` | ✅ (ที่ `main.py`) | ไม่มีใน apiEndpoints — ใช้เป็น health check เบาๆ ได้ถ้าต้องการ |

---

## สิ่งที่แก้ในรอบนี้

1. **SSH WebSocket URL**  
   - เพิ่ม `BOARD_SSH_WS(id)` ใน `apiEndpoints.js` ให้ใช้ `WS_BASE_URL` (ws://)  
   - แก้ `getBoardSSHConnection` ใน `api.js` ให้คืนค่า URL แบบ `ws://...` สำหรับเชื่อมต่อ WebSocket SSH

---

## ข้อเสนอแนะสั้นๆ

1. **ฟังก์ชันที่มีแต่ยังไม่มีจุดเรียกใน UI**  
   `getStorageStatus`, `getMqttStatus`, `getBoardById`, `getBoardTelemetry`, `rebootBoard` (รายตัว), `updateBoardFirmware` (รายตัว), `runBoardSelfTest` (รายตัว), `getBoardSSHConnection`, `getJobById`, `getJobFiles`, `getFileById`, `createWebSocket`  
   - ถ้าไม่ใช้ในอนาคตอันใกล้ อาจเก็บไว้สำหรับหน้าขยายฟีเจอร์ (เช่น Board detail, Job detail, Real-time dashboard)

2. **Backend มีแต่ FE ยังไม่เรียก**  
   - `/api/health` — เพิ่มได้ถ้าต้องการ simple health check  
   - `/api/boards/{id}/status` — เพิ่มได้เมื่อมีหน้า Board detail  
   - `/api/results/*` — เพิ่มเมื่อมีหน้า Results  
   - `POST /api/jobs/upload`, `POST /api/jobs/start`, `POST /api/jobs/stop`, `GET /api/jobs/status/summary` — เพิ่มเมื่อต้องการควบคุมคิวระดับระบบ

3. **WebSocket (system/boards/jobs)**  
   ถ้าต้องการอัปเดต real-time โดยไม่พึ่ง polling ให้เรียก `createWebSocket(API_ENDPOINTS.WS_SYSTEM | WS_BOARDS | WS_JOBS, onMessage, onError)` ใน App แล้วอัปเดต store ตาม message

---

**สรุป:** ส่วนของ frontend ที่เกี่ยวกับ API ที่ใช้อยู่ตอนนี้ **เรียบร้อย** และสอดคล้องกับ backend แล้ว และได้แก้ให้ SSH WebSocket ใช้ `ws://` ถูกต้องแล้ว
