# สรุปแนวทางการแก้ปัญหา จาก Comment (หลังนำเสนอ)

สรุปจาก comment / feedback ที่นำไปสู่การปรับปรุง และแนวทางแก้ที่ทำไปแล้ว (หรือที่ควรทำต่อ)

---

## 1. ไม่ต้องการคิดเป็น “Batch” — อยากแยก “สร้าง Test Case” กับ “เลือกรัน”

**Comment (แนวทาง):**  
ไม่ต้องการเน้นที่การสร้าง batch โดยตรง อยากให้มี **สร้าง test case เก็บไว้ก่อน** แล้ว **ค่อยมาเลือก** ว่าจะรัน set ไหนบ้าง

**แนวทางแก้:**
- แยกเป็น **2 หน้า**:
  - **Test Cases** — สร้าง/เก็บ test case ไว้ (คลัง) ไม่รันทันที
  - **Run Set** — เลือก test case จากคลัง แล้วกดรัน (ส่งเข้า Jobs Manager)
- ข้อมูล test case เก็บใน **localStorage** (`appSavedTestCases`) เป็นคลัง แล้ว Run Set ดึงจากคลังนี้มาเลือกและส่งเป็น job

---

## 2. Device Progress / Board — อยากเห็นรายละเอียด (Online, Busy, กำลังรันอะไร, คิวเท่าไหร่)

**Comment:**  
อยากเห็นรายละเอียดบอร์ดแบบ Online / Busy ว่า busy แล้วรันอะไรอยู่ มี job รอคิวเยอะไหม รันเสร็จไปเท่าไหร่ เหลืออีกเท่าไหร่

**แนวทางแก้:**
- ใน Dashboard เพิ่มส่วน **Device Progress** (การ์ดเล็กเรียงเป็น grid)
- แต่ละบอร์ดแสดง: **สถานะ (Online/Busy)**, ถ้า Busy แสดง **งานที่กำลังรัน** (config · batch #), **ความคืบหน้า** (X/Y files, Z%, เหลือ N), **คิว** (มีกี่ batch รอบอร์ดนี้)
- ใช้ข้อมูลจาก `boards` + `jobs` ใน store (ไม่ต้องแก้ backend)

---

## 3. Details รวมทุกอย่าง — ไม่ต้องมี View Progress / Show Files / Edit Tag แยก

**Comment:**  
ให้ปุ่ม **Details** กดแล้วโชว์ทุกอย่าง (รวม test cases ทั้งหมด) ไม่ต้องมีปุ่ม View Progress, Show Files แยก และให้แก้ tag โดย **คลิกที่ tag เลย** ไม่ต้องมีปุ่ม Edit Tag

**แนวทางแก้:**
- **Details** เมื่อขยายแล้วแสดง: สรุป (Firmware, Boards, Progress, Files), ปุ่ม Export JSON, **Progress view** (ตาราง/สถานะ test cases), **รายการไฟล์/ test cases ทั้งหมด**
- ลบปุ่ม **View Progress** และ **Show Files**
- **Tag**: คลิกที่ badge tag (หรือ “Add tag”) เพื่อแก้ไขได้เลย ลบปุ่ม Edit Tag

---

## 4. ฟีเจอร์เดิมใน Setup อยากได้ครบในหน้า Test Cases (Apply try, Duplicate, Move, Auto-pair ฯลฯ)

**Comment:**  
อยากได้ฟังก์ชันเดิมในหน้าเก่า (Setup) ครบในหน้าใหม่: Apply try, Duplicate, Move test case, Auto select ฯลฯ

**แนวทางแก้:**
- ย้ายฟีเจอร์ทั้งหมดมาไว้ที่หน้า **Test Cases**:
  - **File Library**: Select All, Clear, Delete selected, Start fresh, filter (All/VCD/ERoM/ULP), search, sort, drag & drop, **Auto-select ไฟล์เมื่อมีไฟล์ใหม่**
  - **Saved Test Cases**: **Pair All**, **Add Test Case**, **Clear**, **Save/Load JSON**, ตารางแก้ไขในบรรทัดได้
  - **ตาราง**: checkbox + Select all, **Bulk Apply Try**, **Duplicate** (ต่อแถว), **Move up/down**, **ลากเรียง**, ลบแถว
- เก็บ logic เดิม (เช่น Pair All = จับคู่ VCD–BIN ตามลำดับที่ใกล้กัน)

---

## 5. ตั้งชื่อ Test Case ไม่ซ้ำ + Auto-pair ไฟล์

**Comment:**  
อยากตั้งชื่อ test case ได้และ **ไม่ให้ซ้ำ** และอยากมี **auto pair ไฟล์** (เลือกไฟล์แล้วสร้างคู่ให้อัตโนมัติ)

**แนวทางแก้:**
- **ชื่อไม่ซ้ำ**:  
  - ตอนแก้ชื่อในตาราง ถ้าชื่อซ้ำกับอีกแถว แจ้งเตือนและ revert  
  - ตอนเพิ่ม (Pair All / Add Test Case / Duplicate / Load JSON) ใช้ชื่ออัตโนมัติที่ไม่ซ้ำ (เช่น "Name", "Name (2)", "Test case 1")
- **Auto-pair**: เมื่อ **เลือกไฟล์** ใน File Library (มีทั้ง VCD และ ERoM) ระบบสร้าง test case จากคู่ที่ยังไม่มีในคลังอัตโนมัติ (logic เดียวกับ Pair All)

---

## 6. Run Set — เลือกบอร์ด (Auto assign / Manual) + Prioritize

**Comment:**  
ใน Run Set อยากเลือกบอร์ดได้: **Auto assign**, **Manual select** และมีตัวเลือก **Prioritize**

**แนวทางแก้:**
- เพิ่มในหน้า **Run Set**:
  - **Board selection**: Radio **Auto assign** | **Manual select**; ถ้า Manual ให้เลือกบอร์ด (chips หรือ checkbox) และปุ่ม Select all online / Clear
  - เช็คบอก **Prioritize (high priority)**
- ตอนกด Run: ส่ง `boards: []` หรือ `boards: [ชื่อบอร์ดที่เลือก]` และ `priority: 'high'` ถ้าเลือก Prioritize; ถ้า Manual แต่ไม่เลือกบอร์ดให้แจ้งเตือน

---

## 7. Database / โครงสร้างข้อมูล

**Comment (แนวทาง):**  
อยากเห็น/เข้าใจ **database structure** และการทำ database แบบคิดเป็น **Excel** (ตาราง/ชีต)

**แนวทางแก้:**
- เขียน doc **DATABASE_STRUCTURE.md** — สรุปตารางใน DB (files, boards, jobs, results), คอลัมน์และความสัมพันธ์
- เขียน doc **DATABASE_DESIGN_LIKE_EXCEL.md** — อธิบายการออกแบบ DB แบบคิดเป็น Excel (1 ตาราง = 1 ชีต, คอลัมน์/แถว, ใช้ Excel วางแผนก่อนเขียนโค้ด)
- สรุป **SQLite schema ปัจจุบัน** ใน **SQLITE_SCHEMA_CURRENT.md** (CREATE TABLE จริงจากไฟล์ DB)

---

## 8. ทำ Prototype ใน Figma ก่อน แล้วค่อยทำ Frontend

**Comment:**  
อยากได้ **prototype ใน Figma** ก่อน นำไป approve ว่าจะออกแบบแบบนี้จริง แล้วค่อยมาทำ frontend ต่อ

**แนวทางแก้:**
- เขียน **FIGMA_PROTOTYPE_PROMPT.md** — prompt สำหรับใช้ใน Figma (หรือส่งให้ designer) ระบุ:
  - Layout ทุกหน้า (sidebar, header, main)
  - ทุกหน้าหลัก: Dashboard, Test Cases, Run Set, Jobs Manager, Board Status, Test History, Realtime Waveform
  - องค์ประกอบหลักของแต่ละหน้า + design guidelines
  - ใช้ prompt นี้สร้าง prototype → approve → แล้วค่อย implement frontend ตาม

---

## สรุปภาพรวม

| หัวข้อ | แนวทางแก้ (สรุป) |
|--------|-------------------|
| แยก Batch / Test Case | 2 หน้า: Test Cases (คลัง) + Run Set (เลือกรัน) |
| Device Progress | การ์ดเล็กใน Dashboard แสดง Online/Busy, งานที่รัน, ความคืบหน้า, คิว |
| Details รวมทุกอย่าง | Details ขยายแสดง progress + ทุก test case; แก้ tag โดยคลิกที่ tag |
| ฟีเจอร์เดิมใน Test Cases | Pair All, Apply try, Duplicate, Move, drag, Save/Load JSON, auto select ไฟล์ |
| ชื่อไม่ซ้ำ + Auto-pair | Validation ชื่อซ้ำ; auto-pair เมื่อเลือกไฟล์ (VCD+ERoM) |
| Run Set บอร์ด + Prioritize | Auto assign / Manual select บอร์ด + เช็คบอก Prioritize |
| Database | Doc โครงสร้าง DB + แนวคิดแบบ Excel + SQLite schema จริง |
| Prototype ก่อนทำ Frontend | Prompt สำหรับ Figma เพื่อสร้าง prototype → approve → แล้วค่อยทำ frontend |

ถ้ามี comment เพิ่มจากวันพุธที่ยังไม่ได้ลงใน doc นี้ (เช่น เรื่อง API, permission, หรือ flow อื่น) บอกได้เลย จะช่วยเพิ่มเป็นหัวข้อและแนวทางแก้ในไฟล์นี้ให้ต่อค่ะ
