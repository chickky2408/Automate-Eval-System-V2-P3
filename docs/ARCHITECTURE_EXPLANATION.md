# ธิบายโครงสร้างไฟล์และระบบ (Architecture Explanation)

## ภาพรวมระบบ (System Overview)

ระบบ Frontend Management สำหรับ Semiconductor Test Platform ใช้ **React 18** + **Vite** + **Zustand** สำหรับ State Management

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND APPLICATION                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │   UI     │  │  State   │  │  API     │  │  Hooks   │  │
│  │ (App.jsx)│→ │ (Store)  │→ │ Service │→ │ (Custom) │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND API                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │  REST    │  │  WebSocket│ │ Board REST│                  │
│  │  API     │  │  (Real-time)│ │   API    │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

---

##  โครงสร้างไฟล์ (File Structure)

```
src/
├── main.jsx                    # จุดเริ่มต้นของแอปพลิเคชัน
├── App.jsx                     # Component หลัก + Routing + UI Pages
├── index.css                   # Global Styles (Tailwind CSS)
│
├── store/
│   └── useTestStore.js         # Zustand Store - จัดการ State ทั้งหมด
│
├── services/
│   ├── api.js                  # API Service Layer - เรียก Backend APIs
│   └── mockApi.js              # Mock API สำหรับ Development
│
├── hooks/
│   ├── useApi.js               # Custom Hook สำหรับเรียก API พร้อม Loading/Error
│   ├── useFileUpload.js        # Hook สำหรับจัดการ Upload ไฟล์
│   ├── useJobQueue.js          # Hook สำหรับจัดการ Job Queue
│   └── useJsonConfig.js        # Hook สำหรับสร้าง JSON Config
│
├── components/
│   ├── JobManagement/
│   │   └── JobCard.jsx         # Component แสดง Job Card
│   ├── TestWorkspace/
│   │   └── Workspace.jsx       # Component สำหรับ Setup Test
│   └── ResourceLibrary/
│       └── ResourceLibrary/
│           └── Sidebar.jsx     # Component แสดง Resource Library
│
└── utils/
    ├── apiEndpoints.js         # กำหนด API Endpoints ทั้งหมด
    ├── errorHandler.js         # จัดการ Error จาก API
    ├── sessionStorage.js       # Helper สำหรับ Session Storage
    ├── constants.js            # Constants ที่ใช้ในระบบ
    └── fileHelpers.js          # Helper Functions สำหรับไฟล์
```

---

## รายละเอียดไฟล์แต่ละไฟล์ (File Details)

### 1. **main.jsx** - จุดเริ่มต้นของแอปพลิเคชัน
**หน้าที่:**
- Render React App ลงใน DOM
- ใช้ `React.StrictMode` สำหรับ Development
- Import CSS Global

**เชื่อมต่อกับ:**
- `App.jsx` - Component หลัก
- `index.css` - Global Styles

---

### 2. **App.jsx** - Component หลักและ UI Pages
**หน้าที่:**
- จัดการ Routing ระหว่าง Pages (Dashboard, Setup, Jobs, Boards, History, Overview)
- กำหนด Layout หลัก (Sidebar, Header, Main Content)
- ประกอบด้วย Pages หลัก:
  - `DashboardPage` - แสดง System Health, System Summary, Active Campaigns
  - `SetupPage` - Setup Test (Upload Files หรือ Test Commands)
  - `JobsPage` - จัดการ Jobs/Batches ที่กำลังรัน
  - `BoardsPage` - แสดงสถานะ Boards ทั้งหมด
  - `HistoryPage` - ประวัติการทดสอบที่เสร็จแล้ว
  - `BoardOverviewPage` - ภาพรวม Boards

**เชื่อมต่อกับ:**
- `useTestStore` - ดึงข้อมูล State
- Components ต่างๆ (NotificationBell, TestCommandsManagerModal, etc.)
- Hooks (useState, useEffect)

---

### 3. **store/useTestStore.js** - Zustand Store (State Management)
**หน้าที่:**
- จัดการ Global State ทั้งหมด:
  - `systemHealth` - สถานะระบบ (boards, storage, board REST API)
  - `boards` - ข้อมูล Boards ทั้งหมด
  - `jobs` - ข้อมูล Jobs/Batches
  - `notifications` - การแจ้งเตือน
  - `commonCommands` - คำสั่งที่ใช้บ่อย
  - `testCommands` - Test Commands ที่ User กำหนดเอง (เก็บใน localStorage)
  - `uploadedFiles` - ไฟล์ที่ Upload แล้ว

**Actions (Functions):**
- `addTestCommand`, `updateTestCommand`, `deleteTestCommand` - จัดการ Test Commands
- `exportErrorLog`, `exportAllFailedLogs` - Export Error Logs
- และอื่นๆ สำหรับจัดการ State

**เชื่อมต่อกับ:**
- ทุก Component ที่ต้องการใช้ State
- `localStorage` - เก็บ Test Commands
- `sessionStorage` - เก็บ Client ID

---

### 4. **services/api.js** - API Service Layer
**หน้าที่:**
- กำหนด Functions สำหรับเรียก Backend APIs ทั้งหมด
- จัดการ Authentication (Bearer Token)
- จัดการ Error Handling
- สร้าง WebSocket Connections

**API Categories:**
1. **System Health APIs:**
   - `getSystemHealth()` - ดึงสถานะระบบ
   - `getStorageStatus()` - ดึงสถานะ Storage
   - `getBoardApiStatus()` - ดึงสถานะ Board REST API

2. **Boards APIs:**
   - `getBoards()` - ดึงรายการ Boards
   - `getBoardById(id)` - ดึงข้อมูล Board เฉพาะ
   - `rebootBoard(id)` - Reboot Board
   - `updateBoardFirmware(id, ...)` - อัพเดท Firmware
   - `getBoardSSHConnection(id)` - เชื่อมต่อ SSH

3. **Jobs APIs:**
   - `getJobs()` - ดึงรายการ Jobs
   - `createJob(jobData)` - สร้าง Job ใหม่
   - `startJob(id)` - เริ่ม Job
   - `stopJob(id)` - หยุด Job
   - `exportJob(id)` - Export Job Data

4. **File APIs:**
   - `uploadFile(file, metadata)` - Upload ไฟล์
   - `getFiles()` - ดึงรายการไฟล์
   - `deleteFile(id)` - ลบไฟล์

5. **Notifications APIs:**
   - `getNotifications()` - ดึงการแจ้งเตือน
   - `markNotificationRead(id)` - Mark อ่านแล้ว

**เชื่อมต่อกับ:**
- `utils/apiEndpoints.js` - ใช้ Endpoints
- `utils/errorHandler.js` - จัดการ Error
- Components/Hooks ที่ต้องการเรียก API

---

### 5. **hooks/useApi.js** - Custom Hook สำหรับ API Calls
**หน้าที่:**
- จัดการ Loading State
- จัดการ Error State
- ใช้กับ API Functions จาก `services/api.js`

**Usage:**
```javascript
const { data, loading, error, execute } = useApi(getBoards);
execute(); // เรียก API
```

**เชื่อมต่อกับ:**
- `services/api.js` - รับ API Functions
- `utils/errorHandler.js` - จัดการ Error

---

### 6. **hooks/useFileUpload.js** - Hook สำหรับ Upload ไฟล์
**หน้าที่:**
- จัดการการ Upload ไฟล์ (VCD, Firmware)
- ตรวจสอบชื่อไฟล์ซ้ำและ Rename อัตโนมัติ
- เพิ่มไฟล์เข้า Store

**เชื่อมต่อกับ:**
- `useTestStore` - เพิ่มไฟล์เข้า State
- Components ที่ต้องการ Upload ไฟล์

---

### 7. **hooks/useJobQueue.js** - Hook สำหรับจัดการ Job Queue
**หน้าที่:**
- จัดการ Job Queue (Run, Stop, Reorder)
- ส่งสัญญาณไปหา Hardware/Backend

**เชื่อมต่อกับ:**
- `useTestStore` - อัพเดท Job Status
- Components ที่ต้องการจัดการ Jobs

---

### 8. **hooks/useJsonConfig.js** - Hook สำหรับสร้าง JSON Config
**หน้าที่:**
- สร้าง JSON Configuration สำหรับ Test
- รวม VCD, Firmware, และ Settings

**เชื่อมต่อกับ:**
- Components ที่ต้องการสร้าง Test Config

---

### 9. **components/JobManagement/JobCard.jsx** - Job Card Component
**หน้าที่:**
- แสดง Job Card พร้อม Progress Bar
- ปุ่ม Run/Stop
- แสดง Status และ Progress

**เชื่อมต่อกับ:**
- `JobsPage` - ใช้แสดง Jobs
- `useTestStore` - ดึงข้อมูล Job

---

### 10. **components/TestWorkspace/Workspace.jsx** - Test Workspace Component
**หน้าที่:**
- Setup Test (Drag & Drop VCD และ Firmware)
- กำหนดจำนวน Iterations
- สร้าง Job ใหม่

**เชื่อมต่อกับ:**
- `useTestStore` - เพิ่ม Job ใหม่
- `useFileUpload` - จัดการ Upload

---

### 11. **components/ResourceLibrary/ResourceLibrary/Sidebar.jsx** - Resource Library Sidebar
**หน้าที่:**
- แสดง VCD Files และ Firmware Files
- แสดง Resource ที่มีในระบบ

**เชื่อมต่อกับ:**
- `useTestStore` - ดึงข้อมูล Files

---

### 12. **utils/apiEndpoints.js** - API Endpoints Configuration
**หน้าที่:**
- กำหนด API Endpoints ทั้งหมด
- ใช้ Environment Variables (`VITE_API_BASE_URL`)
- กำหนด WebSocket URLs

**เชื่อมต่อกับ:**
- `services/api.js` - ใช้ Endpoints ในการเรียก API

---

### 13. **utils/errorHandler.js** - Error Handler
**หน้าที่:**
- จัดการ Error จาก API
- Format Error Messages
- Log Errors

**เชื่อมต่อกับ:**
- `services/api.js` - จัดการ Error
- `hooks/useApi.js` - จัดการ Error State

---

### 14. **utils/sessionStorage.js** - Session Storage Helper
**หน้าที่:**
- จัดการ Session Storage
- สร้าง Client ID
- เก็บข้อมูลชั่วคราว

**เชื่อมต่อกับ:**
- `useTestStore` - ใช้ Client ID
- Components ที่ต้องการใช้ Session Storage

---

##  Flow การทำงาน (Data Flow)

### 1. **Flow การเรียก API:**
```
Component → useApi Hook → api.js → Backend API
                ↓
         Loading/Error State
                ↓
         Update UI
```

### 2. **Flow การ Upload ไฟล์:**
```
User Upload → useFileUpload → useTestStore → State Updated
                                      ↓
                              UI Re-render
```

### 3. **Flow การสร้าง Job:**
```
User Setup → Workspace Component → useTestStore.addJob()
                                          ↓
                                    State Updated
                                          ↓
                                    JobsPage แสดง Job ใหม่
```

### 4. **Flow Real-time Updates (อนาคต):**
```
Backend → WebSocket → api.js.createWebSocket() → useTestStore
                                                         ↓
                                                  UI Update
```

---

## 🔗 การเชื่อมต่อระหว่างไฟล์ (File Connections)

### **App.jsx** เชื่อมต่อกับ:
- ✅ `store/useTestStore.js` - ดึง State
- ✅ `components/*` - ใช้ Components
- ✅ `hooks/*` - ใช้ Custom Hooks

### **useTestStore.js** เชื่อมต่อกับ:
- ✅ `utils/sessionStorage.js` - Client ID
- ✅ `localStorage` - เก็บ Test Commands
- ✅ ทุก Component ที่ต้องการ State

### **api.js** เชื่อมต่อกับ:
- ✅ `utils/apiEndpoints.js` - ใช้ Endpoints
- ✅ `utils/errorHandler.js` - จัดการ Error
- ✅ `hooks/useApi.js` - ใช้เรียก API
- ✅ Components ที่ต้องการเรียก API

### **useApi.js** เชื่อมต่อกับ:
- ✅ `services/api.js` - รับ API Functions
- ✅ `utils/errorHandler.js` - จัดการ Error
- ✅ Components ที่ต้องการเรียก API

### **Components** เชื่อมต่อกับ:
- ✅ `store/useTestStore.js` - ดึง/อัพเดท State
- ✅ `hooks/*` - ใช้ Custom Hooks
- ✅ `services/api.js` - เรียก API (ผ่าน useApi)

---

##  Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Dashboard   │  │   Setup      │  │    Jobs      │     │
│  │    Page      │  │    Page      │  │    Page      │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          │         useTestStore (Zustand)        │
          │  ┌──────────┐  ┌──────────┐          │
          │  │  State  │  │ Actions  │          │
          │  └──────────┘  └──────────┘          │
          └──────────────────┬───────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
    ┌─────▼─────┐    ┌───────▼──────┐   ┌──────▼──────┐
    │  useApi   │    │ useFileUpload │   │ useJobQueue │
    │   Hook    │    │     Hook      │   │    Hook     │
    └─────┬─────┘    └───────┬──────┘   └──────┬──────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                    ┌────────▼────────┐
                    │   api.js        │
                    │  (API Service)  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ apiEndpoints.js │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   BACKEND API   │
                    └─────────────────┘
```

---

##  สรุป (Summary)

### **Core Files:**
1. **App.jsx** - UI และ Routing
2. **useTestStore.js** - State Management
3. **api.js** - API Communication
4. **apiEndpoints.js** - API Configuration

### **Supporting Files:**
- **Hooks** - Custom Hooks สำหรับ Logic ที่ใช้ซ้ำ
- **Components** - Reusable UI Components
- **Utils** - Helper Functions

### **Data Flow:**
```
User Action → Component → Hook/Store → API Service → Backend
                ↓
         State Update → UI Re-render
```

### **Key Principles:**
- ✅ **Separation of Concerns** - แยกหน้าที่ชัดเจน
- ✅ **Reusability** - Components และ Hooks ใช้ซ้ำได้
- ✅ **Centralized State** - ใช้ Zustand สำหรับ Global State
- ✅ **API Abstraction** - แยก API Logic ออกจาก Components

---

##  การใช้งาน (How to Use)

### 1. **เรียก API:**
```javascript
import { useApi } from '../hooks/useApi';
import { getBoards } from '../services/api';

const { data, loading, error, execute } = useApi(getBoards);
useEffect(() => {
  execute();
}, []);
```

### 2. **ใช้ State:**
```javascript
import { useTestStore } from '../store/useTestStore';

const { boards, jobs } = useTestStore();
```

### 3. **Upload ไฟล์:**
```javascript
import { useFileUpload } from '../hooks/useFileUpload';

const { uploadFile } = useFileUpload();
uploadFile(file, 'VCD');
```

### 4. **สร้าง Job:**
```javascript
import { useTestStore } from '../store/useTestStore';

const { addJob } = useTestStore();
addJob({ id: '...', name: '...', ... });
```

---

##  Backend Team

### **API Endpoints ที่ต้อง Implement:**
- ดูรายละเอียดใน `utils/apiEndpoints.js`
- ดู Request/Response Format ใน `services/api.js`

### **WebSocket:**
- ใช้สำหรับ Real-time Updates (System Health, Board Status, Job Progress)
- Endpoints: `WS_SYSTEM`, `WS_BOARDS`, `WS_JOBS`

### **Authentication:**
- ใช้ Bearer Token จาก `localStorage.getItem('authToken')`
- ส่งใน Header: `Authorization: Bearer <token>`

---


