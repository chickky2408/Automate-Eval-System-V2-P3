# สรุป Progress ตาม Comment

## จากภาพที่ 1 (Status report)

| Comment | สถานะในระบบ | รายละเอียดสั้นๆ |
|--------|----------------|------------------|
| **Test case — Re-run (fails), select erom/ulp/VCD** | ยังไม่ครบ | มีปุ่ม Re-run ไฟล์เดียวและ Re-run failed ทั้งชุดได้ แต่ยัง **ไม่มีการให้เลือก erom/ulp/VCD ใหม่** ตอน re-run (ส่งไฟล์เดิมตาม job) |
| **แก้ Test case — กระทบ running** | ยังไม่ชัด | ระบบยังไม่ได้ออกแบบให้แก้ test case แล้ว sync กับ job ที่กำลังรันอยู่ (แก้ใน library/table ไม่กระทบ job ที่ส่งไปแล้ว) |
| **Bug — delete/select/edit/stop + message** | ทำแล้ว (EVAL-43) | ลบ batch: รองรับผลลัพธ์บางส่วน (ลบได้ X, ล้มเหลว Y), เคลียร์ selection เฉพาะที่ลบสำเร็จ; หยุด/re-run test case: มี toast สำเร็จ/ไม่สำเร็จ; ข้อความใน Jobs ใช้ภาษาไทย (ลบ/หยุด/รัน) ให้ตรงและครบ |
| **System/Profile — select forward profiles** | ทำได้แล้ว | เลือก profile ได้จาก ProfileSwitcher (create, switch, delete, rename, export/import) เก็บใน localStorage |
| **Payload/Config — Set payload ให้ถูกต้อง** | ทำแล้ว | สร้าง job จาก Run Set ส่ง payload มี name, tag, firmware, files, pairsData, configName; backend รับตาม API |

---

## จากภาพที่ 2 (Feature list)

| Feature | สถานะ | รายละเอียดสั้นๆ |
|--------|--------|------------------|
| **Board overview — show/hide, expand** | ทำได้แล้ว | แสดงบอร์ดในแท็บ test case board ได้ มีการซ่อน/ขยายตาม UI |
| **Batch & Test — call Batch as Test case, checkbox download Report** | บางส่วน | สร้าง job (batch) จาก Run Set ได้ มีปุ่ม download report (HTML/CSV) และ Download All Error Logs สำหรับ failed; **checkbox “download to Report” แยกยังไม่มี** |
| **Waveform & Config — sine, save config, streaming** | บางส่วน | มี streaming waveform, buffer CH1–CH4; save/load config (JSON) มี; การ detect sine / save ตอน detect ต้องเช็คในโค้ด |
| **UI — full-screen, copy scale x-axis** | ยังไม่พบ | ไม่พบ full-screen mode หรือ copy scale แกน x ใน frontend |
| **Test case management** | ทำได้แล้ว | หน้า Test Cases, Run Set, Library (Raw Test Cases / Test Case Library / File in Library) จัดการ test case ได้ |
| **Progress — device %, set %** | ทำได้แล้ว | Board card แสดง progress % (completedFiles/totalFiles), job card แสดง Progress % |
| **Batch/Board — แสดงชื่อ Set แทน batch#** | ทำได้แล้ว | บอร์ดแสดง `(configName || job.name || 'Batch') · #id` แล้ว ไม่ใช่แค่ batch#id |
| **Test/Status — board, FPGA, system health** | ทำได้แล้ว | มี board status, system health, polling; FPGA/Arm ขึ้นกับ backend |
| **Test History** | มีหน้า | มีเมนูและหน้า Test History; filter/group ต้องเช็คว่ามีครบตามที่ต้องการหรือไม่ |
| **Automation — JSON, edit while/after run** | บางส่วน | แก้ pairs (config) ใน Job Manager ได้; โหลด/เซฟ config JSON ได้; การ lock field หลังจบยังไม่ชัดทั้งระบบ |
| **Checkin/Checkout — holes, backend, user ID** | ยังไม่พบ | ไม่พบ flow checkin/checkout หรือการ lock user ID ใน frontend |
| **Failed test — แยกเป็น batch** | ยังไม่มี | มี re-run failed (ใน job เดิม); **ยังไม่มีการแยก failed ออกเป็น batch ใหม่** |
| **Workflow — Test case → Run set → Job** | ทำได้แล้ว | Flow ชัด: สร้าง test case → Save to library / Save set (ที่ Run Set) → Run Set สร้าง job |
| **Setup & Pair — clone, edit, add pairs, drag-drop** | ทำได้แล้ว | Clone batch, แก้ pairs ใน Job, เพิ่ม pair; drag-drop ไฟล์มีใน Test Cases / Library |
| **Config JSON — edit, clone, load config** | ทำได้แล้ว | Save/Load config JSON (configName, tag, pairs), โหลดมาแก้แล้วสร้าง job ได้ |
| **Waveform — streaming, CH1–CH4, PicoScope** | บางส่วน | Streaming + CH1–CH4 ใน buffer/plot มี; อัตโนมัติจาก PicoScope ต้องดู backend/hardware |
| **Test Setup — Run set, เลือก board, auto-assign** | ทำได้แล้ว | หน้า Run Set: เลือก set หรือ browse, Set name, Tag, Board (Auto assign / Manual select), Run และ Save (not run) |
| **Detail — ดูไฟล์, sort, check details** | มี | Job details แสดงรายการไฟล์, สถานะ, re-run, error log; sort ตาม table |
| **Overview — duplicate passed, re-run by filename/edit** | บางส่วน | แสดง passed/failed, re-run ได้; **re-run โดยเลือก filename หรือ edit erom/ulp/VCD ยังไม่มี** |
| **เพิ่มหน้า Test Case** | ทำได้แล้ว | หน้า Test Cases มีแล้ว จัดการ test case ทั้งตาราง + SAVED sets |
| **เพิ่มใน Pair files — ชื่อแก้ได้** | ทำได้แล้ว | ในตาราง Test Cases แต่ละแถวมีช่อง Name แก้ได้; ใน Job pairs ก็แก้ชื่อ/คู่ไฟล์ได้ |
| **Show status — สถานะรายการที่ run** | ทำได้แล้ว | แต่ละไฟล์ใน job แสดง status (pending/running/completed/stopped) และ result (pass/fail) |

---

## จากภาพที่ 3 (Show status, Split channel, Keyboard)

| Comment | สถานะ | รายละเอียดสั้นๆ |
|--------|--------|------------------|
| **Show status — แสดง item run test case สถานะที่?** | ทำได้แล้ว | ใน Job details แสดงแต่ละ test case (file) ว่าอยู่สถานะอะไร (pending/running/completed/stopped) และ result (pass/fail) |
| **Split channel** | ทำได้แล้ว | Waveform มี buffer แยก CH1–CH4 และวาดแยก channel ได้ |
| **Keyboard — shortcut / input** | ยังไม่มี | ไม่พบ keyboard shortcut หรือการ bind input แบบ global ใน frontend |

---

## สรุปภาพรวม

- **ทำได้แล้ว:** Profile, Payload/Config, Board overview, Test case management, Progress, Batch/Board ชื่อ Set, Test/Status, Workflow, Setup & Pair, Config JSON, Test Setup, Detail, เพิ่มหน้า Test Case, ชื่อใน Pair แก้ได้, Show status, Split channel
- **บางส่วน / ต้องเช็คเพิ่ม:** Batch & Test (checkbox report), Waveform & Config, Automation, Test History (filter/group), Overview (re-run by edit)
- **ยังไม่มี / ยังไม่ครบ:** Re-run โดยเลือก erom/ulp/VCD ใหม่, ผลกระทบแก้ test case กับ job ที่กำลังรัน, UI full-screen/copy scale, Checkin/Checkout, แยก failed เป็น batch ใหม่, Keyboard shortcut
