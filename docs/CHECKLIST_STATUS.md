# สถานะ Checklist — ทำแล้ว / ยังขาด

อัปเดตจาก codebase ล่าสุด

---

## ✅ ทำแล้ว / ครบแล้ว

### Modal error notification for each test case
- **ทำแล้ว:** มี `testCaseErrorModal` แยกต่อ test case (state: `{ file, job, index }`)
- ปุ่ม "View error" ใน FileRow เปิด modal แสดง error ของ test case นั้น
- Modal มีปุ่ม Export error log, ปิด

### Test case history (use to run in which case?)
- **ทำแล้ว:** มี `getTestCaseHistory(tc)` และ modal "Test case history"
- แสดงว่า test case นี้เคยถูกใช้รันใน job ไหนบ้าง (ชื่อ job, วันที่, สถานะ, order ใน batch)
- เปิดจาก Test Cases ผ่าน setTestCaseHistoryFor

### Modal UI ให้เลือก per-file ว่าจะ upload ใหม่ or Reuse ทีละ file
- **ทำแล้ว:** คอมโพเนนต์ `UploadChoiceModal` — เลือกทีละไฟล์ "Reuse ของเดิม" หรือ "Upload ใหม่"
- ใช้ทั้งใน Setup (File select) และ Save to library (เมื่อมีไฟล์ซ้ำ)
- Backend: POST /files/check (ส่ง metadata), POST /files/upload รองรับ force_new

### ถ้ามีการ modify หน้าเครื่อง/database ต้องรู้ — run ควร error/warning
- **ทำแล้ว (flow หลัก):** Backend ตรวจ checksum ก่อน start job (`verify_file_checksum`), ถ้าไฟล์ถูกแก้หลังอัปโหลดจะ return 409 + code `FILE_MODIFIED`
- Frontend: แสดง toast / message เมื่อได้ 409 FILE_MODIFIED (ใน handleRunSelectedJobs, createJob, startJob ฯลฯ)

### Re-run test case (fails) — select erom/ulp/VCD ต่อ test case ที่ fail
- **ทำแล้ว:** Modal "Re-run failed test cases" + `rerunSelections` (เลือก VCD/ERoM/ULP จาก Library ต่อแต่ละ failed file)
- Store: `rerunFailedFiles(jobId, fileIds, fileSelections)` ใช้ทั้งใน Job Management และ Test Cases Progress

### Bug: Reorder
- **ทำแล้ว (ส่วนที่เกี่ยวข้อง):** ปุ่มขึ้น–ลงใน Set for run + `reorderRunPreview`; ใน Job Management มี move up/down ต่อไฟล์ + `moveJobToIndex` ต่อ job column; Backend `reorder_job` ทำ full reorder และ reassign queue_position

### Batch & Test — checkbox download → Report แยกต่อ test case
- **ทำแล้ว:** ใน Job Management (Details): checkbox ต่อแถว, Select all / Clear, ปุ่ม "Download report (selected)" และปุ่ม "Report" ต่อ test case
- State: `selectedReportFileIds`, `downloadReportForJob(jobId, fileIds?)`, `downloadSingleFileReport(job, file)`

### Payload / Config
- **มีโครงแล้ว:** Backend รับ `JobCreatePayload` (name, tag, firmware, boards, files, configName, clientId, pairsData); ส่งคืน configName ใน job response; มี priority ใน payload

### เลือก board ไว้และเลือก board ที่ busy ได้ไหม?
- **เลือก board ได้และเก็บไว้:** มี boardSelectionMode (auto/manual), selectedBoardIds
- **เลือก board ที่ busy ได้:** ข้อความใน UI บอกว่า "You can select busy boards; jobs will queue until the board is free" และ selectableBoards ใช้ `status === 'online'` (busy ก็เลือกได้ถ้า online)

### Test History
- **มี History page แล้ว:** `HistoryPage`, activePage === 'history', แสดง batch ที่ completed และปุ่มดู job ใน Job Management

### Detail — จัดลำดับใน Detail, เช็ค Detail ได้ (Job management) (EVAL-51)
- **ทำแล้ว:** คลิกการ์ด job = เปิด Details (Firmware, Boards, Progress, Files); มีปุ่ม Details; ใน Details มี Test Cases in Batch พร้อม move up/down ต่อไฟล์; แสดงรายละเอียดไฟล์ (size, date จาก Library); ปุ่ม "Open in Library" ไปโฟกัสไฟล์ใน File Library; scroll ได้ (max-h 400px)

---

## ⚠️ ยังไม่ครบ / ต้องตรวจหรือปรับปรุง

### Modal error — แจ้ง error แยกเป็น modal ต่อ test case
- **หมายเหตุ:** มี modal ต่อ test case อยู่แล้ว; ถ้าหมายถึง "แจ้งแบบ notification (popup) เมื่อมี error" แทนแค่ toast — ตอนนี้มีทั้ง modal (View error) และ toast

### File modified — flow นี้
- **มี backend + frontend handle 409 แล้ว;** ถ้าต้องการ "warning ก่อน run" (เช่น เช็คเมื่อกด Run แล้วแจ้งก่อนยิง start) อาจต้องเพิ่ม pre-check API หรือเรียก check ก่อน start

### Reorder
- **หมายเหตุ:** ถ้ามี reorder อื่นนอกเหนือ Set for run + Job column + file order ใน batch ที่ยังไม่ครบ ต้องระบุจุดนั้นเพิ่ม

### Payload / Config — Set payload ให้ถูกต้อง
- **สถานะ:** โครงรับ–ส่งมีแล้ว; ถ้า "Not complete" หมายถึงการ map ค่า payload จาก UI ไป backend ให้ตรงกับ design ทุกจุด อาจต้องตรวจทีละ endpoint/หน้า

### Waveform & Config — Save config เมื่อเจอ sine wave
- **ยังไม่มีใน Waveform page:** หน้า Realtime Waveform มี buffer CH1–CH4, zoom, scale ฯลฯ แต่ยังไม่มีปุ่ม/ฟังก์ชัน "Save config" เมื่อเจอ sine wave ตามที่ระบุ ("Some part: Don't have save function")
- Workspace.jsx มี handleSaveConfig (download JSON) แต่เป็นคนละ flow กับ Waveform

### UI — Full screen, รวมทุก function, เพิ่ม copy scale แกน x
- **ยังไม่มี:** ยังไม่พบ full screen mode สำหรับ waveform/UI หลัก และยังไม่มี "copy scale แกน x" ตาม checklist

### Test case management
- **ทำครบแล้วแต่ต้องปรับปรุง:** ตามที่ระบุ "have to improve until it's work for user" — ต้อง iterate ตาม feedback การใช้งานจริง

### Test / Status — Board status, FPGA/Arm, Monitor system health (EVAL-47)
- **ทำแล้ว:** Dashboard มี System Health indicator (OK / Warning / Error), StatCard Stale boards; Board card/list แสดง FPGA/ARM status; Backend รองรับ fpga_status, arm_status ใน heartbeat + system health มี staleBoards; Agent ส่ง fpga_status, arm_status ได้ (optional)

### Test History
- **มี history page แล้ว;** "รอ requirement/design เพิ่ม" เป็นเรื่องเนื้อหา/รูปแบบที่ต้องออกแบบต่อ

### Automation — JSON → edit with json, Running/Complete edit ได้, no edit ส่วนที่ห้ามแก้
- **ยังไม่ทำ / Not in progress:** ยังไม่พบ flow ชัดเจนสำหรับ JSON config → แก้ด้วย JSON, จำกัดการแก้เฉพาะส่วนที่อนุญาต และป้องกันการแก้ส่วนที่ห้าม

### Checkin/Check out — แก้ได้แค่ hole ที่ใช้ run → [Save] → backend, id เปลี่ยนไม่ได้
- **ยังไม่ทำ / Not in progress:** ยังไม่พบ flow checkin/checkout ตามที่ระบุ

### Failed test — Test case ที่ fail → แยกออกมาเป็น batch หรือไม่
- **ยังไม่ทำตาม design:** มี Re-run failed (เลือก VCD/ERoM/ULP ต่อตัว) แต่ยังไม่มี "แยก fail ออกมาเป็น batch" โดยตรง; ระบุ "No, but need to review with team again"

### Overview — เห็น test case ที่รันซ้ำๆ ผ่านรีรัน, วิธีรันซ้ำไฟล์ (ชื่อไฟล์, edit)
- **In progress:** มี re-run และ history อยู่แล้ว; ส่วน "overview" แบบรวบรวมว่าชุดไหนรันซ้ำ/วิธีรันซ้ำไฟล์อาจยังไม่เป็นหน้าหรือ section เฉพาะ

### Split channel
- **มีใน Waveform แล้ว:** ตาม COMMENTS_PROGRESS_SUMMARY ระบุว่า "Waveform มี buffer แยก CH1–CH4 และวาดแยก channel ได้"; ใน code มี visibleSignals (ch1–ch4), bufferRef.CH1–CH4

---

## สรุปสั้น ๆ

| หมวด | ทำแล้ว | ยังขาด/ไม่ครบ |
|------|--------|----------------|
| Modal error per test case | ✅ | — |
| Test case history | ✅ | — |
| Per-file Upload/Reuse modal | ✅ | — |
| File modified detect (409) | ✅ | (ถ้าต้อง pre-warning เพิ่ม) |
| Board เลือกได้ + เลือก busy ได้ | ✅ | — |
| Re-run failed + select VCD/ERoM/ULP | ✅ | — |
| Reorder (Set, Job, File) | ✅ | (ถ้ามีจุดอื่นที่ยังไม่ครบ) |
| Batch & Test — Report แยกต่อ test case | ✅ | — |
| Payload/Config โครง | ✅ | (อาจต้องเช็ค mapping ทุกจุด) |
| Waveform Save config (sine) | — | ❌ ยังไม่มี |
| UI Full screen, copy scale แกน x | — | ❌ ยังไม่มี |
| Automation JSON edit (no edit ห้าม) | — | ❌ Not in progress |
| Checkin/Checkout | — | ❌ Not in progress |
| Failed test → แยกเป็น batch | — | รอ review ทีม |
| Overview (รันซ้ำ/วิธีรันซ้ำ) | ส่วนหนึ่ง | In progress |
| Split channel | ✅ (Waveform) | — |
| Test History page | ✅ มีหน้า | รอ requirement เพิ่ม |
| Detail (Job management) | ✅ | — |

---

## Re-check ตาม EVAL-xx ที่สรุปว่า "ทำสำเร็จแล้ว"

ตรวจจาก code ว่าตรงกับรายการที่สรุปว่า completed หรือมีอะไรตกหล่น

| ID | รายการ | สถานะในโค้ด |
|----|--------|--------------|
| EVAL-2 | Bug on test case page | ✅ มี testCaseErrorModal, View error ต่อ test case; re-run failed modal |
| EVAL-4 | Profile selection & storage | ✅ มี PROFILES_LIST_KEY, activeProfileId, loadProfile/saveProfile, profile dropdown |
| EVAL-5 | Vertical layout fixing, every files can add | ✅ Layout + อัปโหลดได้หลายไฟล์; overflow-y-auto ในหลาย section |
| EVAL-6 | รองรับการ add files ซ้ำได้ | ✅ เปรียบเทียบก่อน (checkFile, duplicate detection); เลือก Reuse/Upload ใหม่ได้ |
| EVAL-8 | Test case library checkbox error | ✅ มี multi-select (shift/ctrl/drag), checkbox ใน library; ถ้ามี bug เฉพาะต้องทดสอบมือ |
| EVAL-10 | Error after save test case, edit (duplicates files) | ✅ มี flow แก้หลัง save; duplicate handling + UploadChoiceModal |
| EVAL-11 | Delete grid [+ column] | ⚠️ ไม่พบคำว่า "Delete grid" หรือ "delete column" โดยตรง; มี Remove selected files, ลบแถว — ถ้าหมายถึง column ใน grid ต้องระบุจุด |
| EVAL-12 | Auto duplicates ไม่ต้องใช้, ไม่ต้อง get file in library ทั้งหมด | ✅ ใช้ check ก่อนอัปโหลด (metadata); ไม่ดึงไฟล์ทั้งหมดมาเทียบฝั่ง frontend |
| EVAL-13 | Clear, start fresh — clear only UI/Table not server | ✅ handleStartFresh: ล้าง selectedIds, localDroppedFiles, pendingDraftTestCases; "Saved test cases in Library will remain" |
| EVAL-14 | Edit แล้วแต่ library ไม่แสดง column ⇒ click update not save set | ✅ มีปุ่ม "Update set" และ updateSavedTestCaseSet |
| EVAL-15 | Duplicate files — animation notification | ✅ มี duplicate detection + UploadChoiceModal; duplicateHighlightIds |
| EVAL-16 | Upload files ซ้ำ ต้อง compare ก่อนถึงจะ saved | ✅ POST /files/check, compare ก่อน; user เลือก Reuse/Upload ใหม่ |
| EVAL-17 | Edit test case ใน setup page ไม่ต้องแก้ใน set | ✅ แก้ใน Setup ได้; Update set อัปเดต set จาก items ปัจจุบัน |
| EVAL-18 | Status showing of test cases | ✅ getTestCaseStatusFromJobs(tc), _status ใน items |
| EVAL-19 | Modal error notification for each test case | ✅ testCaseErrorModal ต่อ file/job/index; View error ใน FileRow |
| EVAL-20 | Test case history (use to run in which case?) | ✅ getTestCaseHistory(tc), modal "Test case history" |
| EVAL-21 | Edit test case — replace, as new test case (UI) | ✅ "Update existing (replace)" และ "Save as new test case(s)"; ไฟล์ล็อกเมื่ออยู่ใน set ที่รัน |
| EVAL-22 | Scroll ขึ้นลงได้ (vertical) และจัด layout | ✅ overflow-y-auto ในหลาย block |
| EVAL-24 | อัปโหลด compare ก่อน, Frontend ส่ง filename, signature, modify date, size | ✅ checkFile API, fileSignature; UploadChoiceModal |
| EVAL-25 | เลือก board ไว้/แก้ไขได้, เลือก board ที่ busy ได้ | ✅ boardSelectionMode, selectedBoardIds; UI บอกเลือก busy ได้ |
| EVAL-26 | แก้ชื่อ set ได้; ระหว่างรันไม่ให้แก้ | ✅ isSetInUseByJobs(set); ข้อความ "Set นี้กำลังถูกใช้รันอยู่ แก้ไขชื่อไม่ได้" |
| EVAL-29/38 | Modify หน้าเครื่อง — run ควร error/warning ว่าไฟล์ถูกแก้ | ✅ verify_file_checksum, 409 FILE_MODIFIED; Frontend แสดงข้อความ |
| EVAL-31 | Load, Append test case อยู่ทั้งหน้า set up และ run | ✅ loadedSetId, Load/Append; ใช้ทั้ง Setup และ Run |
| EVAL-32 | เพิ่ม Tag ของ test case (แต่ละ test case) | ✅ extraColumns.tag, tagColor; แก้ tag ในตารางได้ |
| EVAL-33 | Filter (tag, name) ในหน้า run set — section เลือก test case | ✅ runListNameFilter, runListTagFilter; nameFilter, tagFilter |
| EVAL-35 | ลากหรือเลื่อนในการจัด sequence (Run set) | ✅ handleRowDragStart, handleRowDrop; draggable แถวใน Set for run |
| EVAL-36 | คลิกไฟล์แล้วไปที่ไฟล์ใน library (pointer) | ✅ focusFileInLibrary(rawName); คลิกชื่อไฟล์ → โฟกัสใน Library |
| EVAL-37 | แสดงว่าไฟล์นี้ run ใน test case ไหน, ถูกใช้ใน set ไหน | ⚠️ มี view by set; ถ้าต้องการโมดิฟาย "ไฟล์นี้ถูกใช้ใน test case/set ไหน" โดยตรง อาจต้องเพิ่ม |
| EVAL-39 | Protect ไฟล์/test case ที่กำลังใน process ไม่ให้แก้/ลบ | ✅ Backend: ลบไฟล์ in_use → 409; Set ที่รันอยู่ไม่ให้แก้ชื่อ |
| EVAL-40 | เวลาสั่ง run ให้ saved set อัตโนมัติ | ✅ runSelected เรียก saveCurrentRunSet ก่อน start |
| EVAL-41 | Test case run อยู่ แก้ได้แค่ duplicate และ saved as new | ✅ "Files are locked... Use Save as new test case"; Save as new ได้ |
| EVAL-42 | Re-run test case (fails) | ✅ rerunFailedModal, rerunSelections (VCD/ERoM/ULP), rerunFailedFiles |
| EVAL-43 | Bug — delete/select/edit/stop + message | ✅ ลบ batch รองรับผลบางส่วน + เคลียร์ selection; Stop/Rerun file มี toast; ข้อความ Jobs ใช้ไทย |
| EVAL-45 | Batch → Test case, checkbox download → Report | ✅ checkbox ต่อแถว, Select all/Clear, Download report (selected), Report ต่อแถว |
| EVAL-49 | Duplicate set, edit ได้, เพิ่ม pair, Drop เป็น folder | ✅ duplicateSavedTestCaseSet; drop folder; pairs_data ใน job |
| Run set Options | Create Run set → Options → เลือก board, Auto assign | ✅ boardSelectionMode, selectedBoardIds; Auto assign |
| Add column date | คอลัมน์วันที่ข้างชื่อ | ✅ แสดง createdAt ในตาราง |
| Edit (double click) | แก้ไขแต่ละ test case ได้ (double click) | ✅ Double-click แถว → edit ใน Test Cases page |

**สรุป re-check:** รายการที่สรุปว่า "ทำสำเร็จแล้ว" ส่วนใหญ่พบในโค้ดครบแล้ว (verified). จุดที่อาจตกหล่นหรือต้องระบุเพิ่ม:
- **EVAL-11 (Delete grid [+ column]):** ในโค้ดมีแค่ Remove selected files และลบแถว test case — ถ้าหมายถึงการลบ "column" ใน grid จุดใดจุดหนึ่ง ต้องระบุตำแหน่งแล้วเช็ค/เพิ่ม
- **EVAL-37 (แสดงว่าไฟล์นี้ถูกใช้ใน test case/set ไหน):** มีทางอ้อมคือ view by set (เห็นไฟล์ใน set); ถ้าต้องการหน้ารวมหรือโม달แบบ "คลิกไฟล์ → แสดงรายการ test case/set ที่ใช้ไฟล์นี้" โดยตรง ต้องเพิ่ม
