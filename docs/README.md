# Automate-Eval-System-V2-P3 Documentation Center

> [!NOTE]
> เอกสารสถาปัตยกรรมระดับระบบและข้อกำหนดโดยละเอียด ได้รับการเชื่อมโยงกับศูนย์เอกสารหลัก:
> 📖 **[d:/siliconcraft/eval_system/V2/docs](../../docs/README.md)**

---

## 📑 สารบัญเอกสารสำคัญ (Current System Documentation)

### 1. สถาปัตยกรรมและข้อกำหนดล่าสุด (Latest Architecture & Specs)
* **[Embedded Web GTKWave (Broadway) Guide](./BROADWAY_GTKWAVE_GUIDE.md)** — คู่มือและสถาปัตยกรรมระบบเปิดดูคลื่นสัญญาณผ่าน Web GTKWave, การสร้าง `.gtkw` อัตโนมัติ, การแสดงผลสัญญาณ Analog Step และ Dual-Scope Golden Comparison
* **[ADR 0004: Embedded Web GTKWave via GDK Broadway](../../docs/adr/0004-embedded-web-gtkwave-via-gdk-broadway.md)** — การตัดสินใจใช้ GDK Broadway HTML5 Backend แทน Desktop VNC หรือ WebAssembly
* **[ADR 0005: Analog Waveform Reconstruction & Dual-Mode UX](../../docs/adr/0005-analog-waveform-reconstruction-and-comparison-ux.md)** — การสร้างคลื่น Analog Step สำหรับบัส ADC/DAC และ UX การเปิดไฟล์ Actual/Golden
* **[SPEC-0004: Broadway Analog Waveform Inspection Spec](../../docs/specs/SPEC-0004-broadway-analog-waveform-inspection.md)** — ข้อกำหนดเชิงระบบ (Feature Specification) ฉบับสมบูรณ์

### 2. ภาพรวมระบบและการเชื่อมต่อฮาร์ดแวร์ (System & Hardware Integration)
* **[Handoff Documentation](../HANDOFF_DOCUMENTATION.md)** — สรุปโครงสร้างระบบ, ลำดับการรันงาน (Job Sequence), แผนผังไฟล์โค้ดสำคัญ และบันทึกการแก้ปัญหาฮาร์ดแวร์ KR260 E2E
* **[Audit Response Report](./AUDIT_RESPONSE_TH.md)** — รายงานการตรวจสอบความมั่นคงปลอดภัยและการปิดช่องโหว่ทางเทคนิค
* **[Two-Stage Pipeline Specification](../../docs/specs/SPEC-0003-two-stage-job-execution-pipeline.md)** — ข้อกำหนดการแยกขั้นตอน Setup (EROM init) ออกจาก Stimulus (DMA capture)
* **[Automated Expected Waveform Verification](../../docs/specs/SPEC-0002-expected-waveform-comparison-platform-integration.md)** — การตรวจสอบความถูกต้องของรูปคลื่นดิจิทัลด้วยอัลกอริทึม Edge-Based F1 และ Majority Voting

### 3. เอกสาร API และฐานข้อมูล (API & Database Specs)
* **[Full API Specification List](../../docs/api/FULL_API_LIST_REPORT.md)** — รายการ Endpoint ทั้งหมดของ Central Platform รวมทั้ง Endpoint ชุดใหม่ `/api/v1/waveform/sessions`
* **[Database Schema (ORM Models)](../../docs/database/DATABASE_SCHEMA_FULL.md)** — โมเดลฐานข้อมูล PostgreSQL (Jobs, Results, Boards, TestCases, Files)
* **[Domain Glossary & Lexicon](../../CONTEXT.md)** — อภิธานศัพท์และคำนิยามทางการของระบบ Eval V2

---

## 🛠️ รายการโมดูลสำคัญที่เพิ่มเข้ามาล่าสุด (Recently Added Modules)

| โมดูล / ไฟล์ | ตำแหน่ง | หน้าที่หลัก |
| :--- | :--- | :--- |
| `broadway_layout_generator.py` | `backend/services/` | สังเคราะห์ไฟล์ Layout `.gtkw` รองรับบัส Analog Step (`@20020`) และ Dual Scopes (`actual.*` vs `golden.*`) |
| `broadway_session_manager.py` | `backend/services/` | จัดการ Display Port Pool, สปอว์น/ควบคุม headless process `broadwayd` & `gtkwave`, และ Inactivity Watchdog 15 นาที |
| `waveform_sessions.py` | `backend/routers/` | REST API สำหรับสั่งเปิด ปิด และตรวจสอบสถานะเซสชัน GTKWave (`/api/v1/waveform/sessions`) |
| `BroadwayWaveformModal.jsx` | `frontend/src/components/` | หน้าต่าง Overlay Modal แสดงผล GTKWave เต็มหน้าจอผ่าน WebSocket พร้อม Toolbar ควบคุมสถานะและปุ่ม Close/Reload |
| `SplitActionLaunchDropdown.jsx` | `frontend/src/components/` | ปุ่มกดเลือกโหมดเปิดผลการทดสอบ ("Inspect Actual Only" หรือ "Inspect Actual + Golden") |
