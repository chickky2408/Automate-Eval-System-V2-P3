# summary refactoring DB

## สถานะรวม
- **เสร็จตามเป้าหมายหลัก (Core refactoring complete)** สำหรับ 2 ประเด็นใหญ่
- ระบบผ่านการเช็ค schema และ sanity data บน PostgreSQL แล้ว

## 1) Jobs/Results: ตัดการอ้างอิงชื่อไฟล์แบบ legacy

### สิ่งที่ทำแล้ว
- เพิ่มและใช้งาน `vcd_file_id` / `firmware_file_id` เป็นแหล่งอ้างอิงหลัก
- Backfill ข้อมูลจากชื่อไฟล์เดิมไป `file_id` (ก่อน cutover)
- เพิ่ม readiness check และ endpoint สำหรับตรวจความพร้อมก่อนตัดคอลัมน์
- **Drop คอลัมน์ legacy สำเร็จ**:
  - `jobs.vcd_filename`, `jobs.firmware_filename`
  - `results.vcd_filename`, `results.firmware_filename`
- ปรับ ORM/Service/Router ให้ไม่พึ่งคอลัมน์ชื่อไฟล์จากตาราง `jobs/results` แล้ว

### ผลลัพธ์ที่ตรวจได้
- ไม่พบคอลัมน์ legacy ใน `jobs/results`
- `jobs/results` มีคอลัมน์ `vcd_file_id` / `firmware_file_id` ครบ
- Missing `file_id` = 0 และ orphan reference = 0

## 2) Boards: แยก static data ออกจาก telemetry

### สิ่งที่ทำแล้ว
- เพิ่มตาราง `board_status` สำหรับข้อมูล dynamic (`state`, `cpu_temp`, `cpu_load`, `ram_usage`, `last_heartbeat`, ฯลฯ)
- เพิ่ม migration + backfill จาก `boards` ไป `board_status`
- ปรับ `board_manager` ให้ heartbeat/update สถานะไปที่ `board_status` เป็นหลัก
- ปรับ read path ให้รวมข้อมูลผ่าน model/service เดิมได้ต่อเนื่อง

### ผลลัพธ์ที่คาดหวังจากการเปลี่ยนแปลง
- ลด write churn บนตาราง `boards`
- ลดความเสี่ยง bloat/lock contention สำหรับ heartbeat workload

## อาจทำต่อได้
- เอกสาร handoff แนะนำให้ใช้ `joinedload` เพื่อดึงชื่อไฟล์จาก relation ตอนแสดงผล
- เวอร์ชันปัจจุบันใช้งาน `file_id` เป็น source of truth แล้ว และ resolve ชื่อไฟล์จาก `files` สำหรับการแสดงผลได้ถูกต้อง
- หากต้องการ optimize เพิ่มเติมเชิง ORM performance สามารถต่อยอดเป็น relation + `joinedload` ได้ในรอบถัดไป


