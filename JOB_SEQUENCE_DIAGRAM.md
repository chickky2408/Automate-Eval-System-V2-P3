# System Job Sequence Diagram

> [!NOTE]
> เอกสารกระบวนการทำงานและ Sequence Diagram ฉบับเต็มได้รับการบันทึกและอ้างอิงไว้ที่:
> 📖 **[docs/architecture/JOB_SEQUENCE_DIAGRAM.md](../docs/architecture/JOB_SEQUENCE_DIAGRAM.md)**

```mermaid
sequenceDiagram
    autonumber
    actor User as Engineer / Web Frontend
    participant BE as Central Backend (FastAPI)
    participant DB as PostgreSQL Database
    participant FS as Storage (uploads/WAVEFORM)
    participant AG as KR260 Board Agent
    participant PL as FPGA PL (DMA Engine)
    participant DUT as DUT (Silicon IC)

    Note over User,AG: 1. สร้างงานและส่งคำสั่งทดสอบ (Job Dispatch)
    User->>BE: POST /api/jobs {name, test_case_id, target_board_id}
    BE->>DB: INSERT INTO jobs, job_targets, results
    BE->>AG: POST http://{board_ip}:8000/execute {job_id, result_id, stimulus_url}
    AG-->>BE: 200 OK {"accepted": true}

    Note over AG,DUT: 2. การรันบนฮาร์ดแวร์จริง (Physical Execution)
    AG->>PL: Setup AXI DMA Ring & Drive Stimulus
    PL->>DUT: Digital/Analog Stimulus Signals
    DUT-->>PL: Hardware Pin Response
    PL->>AG: Stream Samples into DDR RAM (~77.7 MB)

    Note over AG,BE: 3. การแปลงระดับขอบบอร์ดสู่ FST (Edge FST Ingestion: bin -> FST บน KR260)
    AG->>AG: Native C Engine (fast_bin2vcd + vcd2fst) แปลง bin -> scope_capture.fst (130 ms, ~114 KB)
    AG->>AG: ลบ Raw Binary ใน RAM ทิ้งทันที (ไม่สะสมข้อมูลใน RAM ของบอร์ด)
    AG->>BE: POST /api/boards/{id}/upload-fst [scope_capture.fst] (<120 KB, <1 ms over LAN)
    AG->>BE: POST /api/boards/{id}/measurements {job_id, result_id, passed, metrics}
    BE->>DB: UPDATE results SET passed=true, ...
    BE->>FS: จัดเก็บ FST Archive -> uploads/WAVEFORM/YYYY/MM/{result_id}.fst
    BE->>DB: INSERT INTO files (file_type='WAVEFORM', storage_path='...')
    BE-->>AG: 200 OK {"status": "completed"} (ปลดล็อกบอร์ดทันที)

    Note over BE,FS: 4. การตรวจสอบและการวิเคราะห์คลื่นสัญญาณ (Verification & Inspection)
    BE->>FS: อ่านไฟล์ FST คำนวณ Edge-Based F1 & Majority Voting (Direct FST Verification)
    BE->>DB: UPDATE results SET f1_score=99.85, verification_status='PASS'
    User->>BE: POST /api/v1/waveform/sessions (เปิดดูผ่าน Web GTKWave Broadway)
    BE-->>User: สตรีม Interactive Waveform UI แสดง Analog Step & Dual Golden บน Canvas
```
