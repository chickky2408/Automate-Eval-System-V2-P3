# Architecture Decision Records (ADRs) & Domain Glossary

**เอกสารบันทึกการตัดสินใจทางสถาปัตยกรรมและพจนานุกรมศัพท์เฉพาะของระบบ Eval System Platform**  
**วันที่อัปเดต:** 26 สิงหาคม 2026

---

## 📚 Section 1: Architecture Decision Records (ADRs)

### ADR-001: LZ4 Compressed Ingestion & Server-Side Multi-Format Conversion Engine
* **สถานะ:** Accepted (ผ่านการทดสอบ Benchmark บนฮาร์ดแวร์จริง 26 ส.ค. 2026)
* **บริบท (Context):** จากการทดสอบ Benchmark บนบอร์ด FPGA จริง (ARM Cortex-A53) พบว่าการแปลงไฟล์ขนาด 1.5 GB เป็น Text VCD บนตัวบอร์ดกินเวลาเกือบ 3 ชั่วโมง (คอขวดรุนแรง) ในขณะที่การบีบอัดด้วย **LZ4** ทำงานได้เร็วถึง **615.9 MB/s** ย่อขนาดไฟล์ลดลงเหลือเพียง ~5-80 MB ในเวลา 2-3 วินาที
* **การตัดสินใจ (Decision):**
  1. **V2 Connected Mode:** บอร์ด Agent จะบีบอัดข้อมูลด้วย **LZ4 Compression** บน RAM แล้วส่งผ่าน Gigabit LAN สู่ **Central Platform (V2 Server)** ภายใน 3-5 วินาที แล้วให้ CPU Multi-core ของ Server เป็นผู้แปลงไฟล์เป็น `.h5` (HDF5) และ `.vcd` ทันที
  2. **Standalone Mode:** บอร์ดจะบันทึกไฟล์ Raw `capture.lz4` / `capture.bin` พร้อม `summary.csv` ลง SD Card ทันที และมีชุดคำสั่ง **Standalone On-Demand Conversion** ให้ผู้ใช้งานสั่งแปลงไฟล์เฉพาะช่วงเวลาที่สนใจหรือแปลงทั้งหมดเมื่อไม่ได้เชื่อมต่อกับเซิร์ฟเวอร์
* **ผลที่ตามมา (Consequences):** ลดเวลารอคอยของบอร์ดจาก ~3 ชั่วโมงเหลือเพียง **~5 วินาที**, ยืดอายุการใช้งานของ SD Card, และเปิดให้บอร์ดว่างพร้อมรับ Test Job ถัดไปในคิวได้ทันที

---

### ADR-002: Direct Test Vector Ingestion (Bypass VCD Compilation)
* **สถานะ:** Accepted
* **บริบท (Context):** ผู้จัดทำ Test Case สามารถสร้างไฟล์คำสั่งหรือรูปแบบสัญญาณในระดับ Binary Instructions ได้โดยตรง
* **การตัดสินใจ (Decision):** ปลดภาระงาน Server-side VCD-to-Binary pre-processing ออก โดยให้ V2 Backend และ Board Agent ทำหน้าที่เป็น Direct Vector Streamer ส่งไฟล์เข้า DMA และ Control Register ทันที
* **ผลที่ตามมา (Consequences):** ลดความซับซ้อนของ Server, เพิ่มความเร็วในการเริ่มรันงานทดสอบ (Low Latency Dispatch)

---

### ADR-003: Fault Recovery via Force Board Reboot
* **สถานะ:** Accepted
* **บริบท (Context):** เมื่อเกิดปัญหา AXI Bus Hang, DMA Ring Lockup, หรือ Kernel Driver ค้าง การ Soft-Reset อาจไม่สามารถคืน State ได้สมบูรณ์
* **การตัดสินใจ (Decision):** ใช้กลยุทธ์ **Force Board Reboot** เมื่อเกิดความผิดพลาดระดับฮาร์ดแวร์ โดย Backend จะสั่ง `POST /system/reboot` ไปยังบอร์ด และเริ่ม Cooldown Timer (35-45s) เพื่อรอ Heartbeat ตื่นใหม่ก่อนนำกลับเข้าคิว
* **ผลที่ตามมา (Consequences):** รับประกันความเสถียรและ State ความสะอาดของระบบฮาร์ดแวร์ 100% ก่อนเริ่มงานถัดไป

---

### ADR-004: Atomic Bundle (.tar.gz) Artifact Upload
* **สถานะ:** Accepted
* **บริบท (Context):** การทดสอบ 1 ครั้งให้ผลลัพธ์เป็นไฟล์ 3 รูปแบบพร้อม `manifest.json` หากส่งแยกไฟล์อาจเกิดปัญหาไฟล์ไม่ครบหากเครือข่ายหลุด
* **การตัดสินใจ (Decision):** บอร์ด Agent จะแพ็กไฟล์ทั้งหมดเป็น `run_{result_id}_bundle.tar.gz` แล้วส่งผ่าน Chunked Upload API ก้อนเดียว เมื่อ Backend ได้รับจะทำการแตกไฟล์และลงทะเบียนเข้าสู่ระบบอัตโนมัติ
* **ผลที่ตามมา (Consequences):** รับประกัน Data Atomicity (ได้ครบทั้งหมดหรือล้มเหลวแบบชัดเจน), ประหยัด Bandwidth จากการบีบอัด Gzip ได้กว่า 70-90%

---

### ADR-005: Standalone Mode Triggering & Sync-Ready Layout
* **สถานะ:** Accepted
* **บริบท (Context):** การใช้งานบอร์ดแบบ Offline/Standalone ที่หน้าแล็บโดยไม่มี V2 Server
* **การตัดสินใจ (Decision):** 
  - รองรับการสั่งงาน Standalone 2 ช่องทาง: (1) ยิง cURL HTTP API เข้าพอร์ต 8000 ผ่านสาย LAN และ (2) กดผ่าน Local WebApp บนบอร์ด (KR/KV Board WebUI)
  - จัดเก็บผลลัพธ์ลง SD Card ในโครงสร้าง `/mnt/sdcard/eval_standalone/pending_sync/` พร้อม `manifest.json` ที่มี Flag `"synced": false` เพื่อรองรับการ Sync เข้า V2 ในอนาคต

---

## 📖 Section 2: Domain Glossary (พจนานุกรมคำศัพท์เฉพาะของระบบ)

| คำศัพท์ (Term) | หมวดหมู่ | คำอธิบาย (Definition ในระบบ Eval System) |
| :--- | :---: | :--- |
| **V2 Platform (HQ)** | Server | เซิร์ฟเวอร์หลักที่จัดการ UI, Job Queue, Database, File Library, และ WebSSH Proxy |
| **Board Agent** | Edge / PS | บริการ FastAPI Daemon ที่ทำงานภายใต้สิทธิ์ Root บน PetaLinux ของบอร์ด FPGA |
| **KV/KR Board WebUI** | Edge / UI | เว็บแอปพลิเคชันภายในตัวบอร์ด (พอร์ต 8000) สำหรับสั่งรันและดูสถานะในโหมด Standalone |
| **Test Vector** | Hardware | ชุดคำสั่งหรือไบนารีแพทเทิร์นที่เตรียมไว้สำหรับส่งเข้า FPGA PL เพื่อกระตุ้น DUT |
| **S2MM DMA Ring** | Hardware | Stream-to-Memory-Mapped AXI DMA Buffer ที่ใช้เก็บข้อมูล Capture สัญญาณความเร็วสูงเข้า RAM |
| **Artifact Bundle** | Data | ไฟล์ `.tar.gz` รวมผลลัพธ์ (`.vcd`, `.h5`, `.csv`, `manifest.json`) ของการทดสอบ 1 รอบ |
| **Standalone Mode** | Architecture | สภาวะการทำงานของบอร์ด FPGA แบบอิสระ ไม่จำเป็นต้องเชื่อมต่อกับ V2 Server |
| **Force Board Reboot** | Fault Recovery | กระบวนการสั่งรีสตาร์ตระบบปฏิบัติการ PetaLinux ทั้งหมดเพื่อกู้คืนสภาวะฮาร์ดแวร์ |
| **Sync-Ready Layout** | Storage | โครงสร้างไดเรกทอรีบน SD Card ที่ออกแบบให้มี Metadata และสถานะพร้อมซิงก์ขึ้นคลาวด์ |
