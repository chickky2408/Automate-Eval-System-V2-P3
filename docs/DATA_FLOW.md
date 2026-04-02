# Data Flow — สรุปการไหลของข้อมูลในระบบ

## 1. แหล่งเก็บข้อมูล (Storage)

| ข้อมูล | ที่เก็บ | หมายเหตุ |
|--------|--------|----------|
| **Profile + Test Cases + Sets** | **Frontend เท่านั้น** (localStorage) | ไม่ sync กับ backend |
| **Files (Library)** | **Backend** (DB + disk) | Frontend ดึงผ่าน API แล้วเก็บใน store |
| **Files ตาม Set** | **Backend** (DB ตาม set_id) | Save Set ส่ง file_ids ไป backend |
| **Boards** | **Backend** | CRUD ผ่าน API |
| **Jobs** | **Backend** | สร้าง/เริ่ม/หยุด ผ่าน API |
| **Notifications** | **Backend** | ดึงผ่าน API |

---

## 2. Profile & Test Cases (Local Only)

```
localStorage
├── app_profiles_list          → รายการ profile [{ id, name }]
├── app_active_profile_id      → profile ที่เลือกอยู่
└── app_profile_<id>            → ข้อมูล profile แต่ละตัว
    ├── savedTestCases         → array ของ test case (ตารางบนหน้า Test Cases)
    └── savedTestCaseSets       → array ของ set แต่ละ set มี { id, name, items[], fileLibrarySnapshot }
```

- **savedTestCases** = ตาราง "Saved Test Cases" บนหน้า Test Cases (name, vcdName, binName, linName, tryCount, extraColumns, id)
- **savedTestCaseSets** = ชุดที่กด Save ไว้ (Load / Append / Duplicate / Delete set)
- ทุก action ที่แก้ savedTestCases หรือ savedTestCaseSets จะเรียก `saveProfile(activeId, { ...profile, savedTestCases })` หรือ `saveSavedTestCaseSets(next)` → บันทึกลง localStorage ทันที

---

## 3. Flow หลักของ Test Cases & Sets

### 3.1 หน้า Test Cases

- **แสดง:** `savedTestCases` จาก store (อ่านจาก profile ใน localStorage ตอนโหลด)
- **เพิ่ม/แก้/ลบ/เรียงแถว:** เรียก store เช่น `addSavedTestCase`, `updateSavedTestCase`, `removeSavedTestCase`, `reorderSavedTestCases` → store อัปเดตแล้ว `saveSavedTestCases(list)` → profile ใน localStorage อัปเดต
- **Pair All / Add Test Case / Import CSV:** เพิ่มหรือแทนที่ใน `savedTestCases` แล้ว save profile
- **Save (ปุ่ม Save):**
  1. อ่าน Set name + รายการจากตาราง (`savedTestCases`)
  2. `addSavedTestCaseSet(name, sourceList, { fileLibrarySnapshot })` → เพิ่ม set ใหม่ใน `savedTestCaseSets` + บันทึก profile
  3. ถ้ามี file ที่ set ใช้ (จาก fileLibrarySnapshot): เรียก **API** `api.saveSetFiles(newSetId, fileIds)` → backend คัดลอกไฟล์เข้า set นั้น
- **Load Set:** `applySavedTestCaseSet(set.id)` → แทนที่ `savedTestCases` ทั้งตารางด้วย set.items (สร้าง id ใหม่ให้แต่ละแถว) แล้ว save profile
- **Append Set:** `appendSavedTestCaseSet(set.id)` → เพิ่ม set.items ต่อท้าย `savedTestCases` (ตั้งชื่อไม่ซ้ำ) แล้ว save profile
- **Delete Set:** เรียก `api.deleteSet(set.id)` แล้ว `removeSavedTestCaseSet(set.id)` → ลบทั้ง backend และใน profile

### 3.2 หน้า Library (Test Case and File Library)

- **Raw Test Cases (แท็บ):**
  - แหล่งข้อมูล: `savedTestCases` (ตารางปัจจุบัน) + items จากทุก `savedTestCaseSets`
  - **ลดซ้ำ:** แสดงจากตารางก่อน แล้วจาก set เฉพาะรายการที่ key (name, vcdName, binName, linName) ยังไม่โผล่แล้ว → ไม่ซ้ำหลังกด Save
- **Test Case Library (แท็บ):** แสดงเป็น set ละบล็อก (จาก `savedTestCaseSets`) มีปุ่ม Edit Test Cases, ลบ set (Trash2), ลบ test case ใน set
- **File in Library (แท็บ):** แสดง `uploadedFiles` จาก store (ซึ่ง sync กับ backend ผ่าน `refreshFiles`)

---

## 4. Files Flow

### 4.1 ไฟล์หลัก (Library)

- **โหลด:** หน้าเข้า Library หรือตอนเปิดแอป → `refreshFiles()` → `api.getFiles()` → นำผลมา map เป็น `uploadedFiles` (และ vcdFiles / firmwareFiles) ใน store
- **อัปโหลด:** `addUploadedFile(file)` → `api.uploadFile(file)` → ได้ file id/name จาก backend → push เข้า `uploadedFiles`
- **ลบ:** `removeUploadedFile(id)` → `api.deleteFile(id)` แล้วลบออกจาก `uploadedFiles`

### 4.2 ไฟล์ตาม Set (Backend)

- **Save Set (มีไฟล์):** หลัง `addSavedTestCaseSet(...)` เรียก `api.saveSetFiles(setId, fileIds)` → backend คัดลอกไฟล์จาก library ไปเก็บตาม set_id
- **Restore to Library:** `api.restoreSetFilesToLibrary(setId)` → backend คัดลอกไฟล์ของ set กลับเข้า library หลัก
- **ลบ Set:** `api.deleteSet(setId)` → backend ลบไฟล์ทั้งหมดของ set นั้น (DB + disk)

---

## 5. Jobs Flow

- **ดึงรายการ:** `refreshJobs()` → `api.getJobs()` → เก็บใน store เป็น `jobs`
- **สร้าง Job:** `createJob(payload, options)` → `api.createJob(payload)` (มี clientId, test cases / pairs ฯลฯ) → ถ้า `startImmediately` เรียก `api.startJob(created.id)` → จากนั้น `refreshJobs()`
- **Run Set หน้า:** เลือก set(s) หรือ Browse เลือก test case → สร้าง payload (ชื่อ, tag, board, รายการ test case) → `createJob(payload, { startImmediately: true })`
- **เริ่ม/หยุด/ลบ Job:** เรียก API ที่ตรงกับ action แล้ว `refreshJobs()` อีกครั้ง

---

## 6. Boards & System

- **Boards:** `refreshBoards()` / `silentRefreshBoards()` → `api.getBoards()` → เก็บใน `boards`
- **สร้าง/แก้/ลบ Board:** เรียก API ที่ตรงกับ action แล้ว refresh boards
- **System health / Notifications:** ดึงจาก API แล้วเก็บใน store ใช้แสดงใน UI

---

## 7. สรุป Diagram (แบบย่อ)

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Zustand store)                                        │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ savedTestCases    │  │ savedTestCaseSets │  │ uploadedFiles │ │
│  │ (จาก profile)     │  │ (จาก profile)    │  │ (จาก API)     │ │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬────────┘ │
│           │                     │                    │          │
│           └──────────┬──────────┘                    │          │
│                      ▼                              │          │
│            localStorage (profile)                  │          │
└─────────────────────────────────────────────────────┼──────────┘
                                                      │
                         ┌────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend API                                                     │
│  • GET/POST /files, DELETE /files/:id     → ไฟล์ library        │
│  • POST /sets/:id/files/save              → บันทึกไฟล์เข้า set   │
│  • GET  /sets/:id/files                  → ดูไฟล์ใน set        │
│  • POST /sets/:id/files/restore-to-library                      │
│  • DELETE /sets/:id                      → ลบ set (และไฟล์)    │
│  • /boards, /jobs, /notifications, /system/health ฯลฯ           │
└─────────────────────────────────────────────────────────────────┘
```

ถ้าต้องการลงรายละเอียด flow หน้าใดเป็นพิเศษ (เช่น แค่ Save Set หรือแค่ Run Set) บอกได้เลยค่ะ
