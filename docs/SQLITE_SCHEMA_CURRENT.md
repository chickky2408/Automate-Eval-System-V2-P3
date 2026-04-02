# ตาราง Database SQLite ปัจจุบัน

ไฟล์: **`backend/eval_system_demo.db`**  
(ดึง schema เมื่อรัน `sqlite3 eval_system_demo.db ".schema"`)

---

## สรุปตารางและจำนวนแถว (ตัวอย่าง)

| ตาราง    | จำนวนแถว (ตัวอย่าง) |
|----------|------------------------|
| boards   | 2                      |
| files    | 8                      |
| jobs     | 4                      |
| results  | 0                      |

---

## CREATE TABLE ทั้งหมด (Schema จริง)

### 1. ตาราง `files`

```sql
CREATE TABLE files (
	id VARCHAR(36) NOT NULL, 
	filename VARCHAR(255) NOT NULL, 
	file_type VARCHAR(8) NOT NULL, 
	storage_path VARCHAR(512) NOT NULL, 
	checksum_sha256 VARCHAR(64), 
	size_bytes BIGINT, 
	uploaded_at DATETIME, 
	PRIMARY KEY (id)
);
```

---

### 2. ตาราง `boards`

```sql
CREATE TABLE boards (
	id VARCHAR(64) NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	ip_address VARCHAR(64), 
	mac_address VARCHAR(64), 
	firmware_version VARCHAR(128), 
	model VARCHAR(128), 
	tag VARCHAR(128), 
	connections JSON, 
	state VARCHAR(32), 
	cpu_temp FLOAT, 
	cpu_load FLOAT, 
	ram_usage FLOAT, 
	current_job_id VARCHAR(32), 
	last_heartbeat DATETIME, 
	created_at DATETIME, 
	PRIMARY KEY (id)
);
```

---

### 3. ตาราง `jobs`

```sql
CREATE TABLE jobs (
	id VARCHAR(32) NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	vcd_file_id VARCHAR(36), 
	firmware_file_id VARCHAR(36), 
	vcd_filename VARCHAR(255), 
	firmware_filename VARCHAR(255), 
	target_board_id VARCHAR(32), 
	assigned_board_id VARCHAR(32), 
	priority INTEGER, 
	queue_position INTEGER, 
	timeout_seconds INTEGER, 
	retries INTEGER, 
	enable_picoscope BOOLEAN, 
	save_to_db BOOLEAN, 
	state VARCHAR(32), 
	progress INTEGER, 
	current_step VARCHAR(255), 
	error_message TEXT, 
	created_at DATETIME, 
	started_at DATETIME, 
	completed_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(vcd_file_id) REFERENCES files (id), 
	FOREIGN KEY(firmware_file_id) REFERENCES files (id)
);
```

---

### 4. ตาราง `results`

```sql
CREATE TABLE results (
	id VARCHAR(32) NOT NULL, 
	job_id VARCHAR(32) NOT NULL, 
	job_name VARCHAR(255) NOT NULL, 
	board_id VARCHAR(32) NOT NULL, 
	board_name VARCHAR(255) NOT NULL, 
	passed BOOLEAN NOT NULL, 
	started_at DATETIME NOT NULL, 
	completed_at DATETIME NOT NULL, 
	duration_seconds FLOAT NOT NULL, 
	vcd_filename VARCHAR(255) NOT NULL, 
	firmware_filename VARCHAR(255), 
	error_message TEXT, 
	packet_count INTEGER, 
	crc_errors INTEGER, 
	console_log TEXT, 
	waveform_hdf5_path VARCHAR(512), 
	metrics JSON, 
	PRIMARY KEY (id)
);
```

---

## วิธีดู schema เองจาก terminal

```bash
cd backend
sqlite3 eval_system_demo.db ".schema"
```

ดูเฉพาะชื่อตาราง:

```bash
sqlite3 eval_system_demo.db ".tables"
```

ดูจำนวนแถวแต่ละตาราง:

```bash
sqlite3 eval_system_demo.db "SELECT 'files:', COUNT(*) FROM files; SELECT 'boards:', COUNT(*) FROM boards; SELECT 'jobs:', COUNT(*) FROM jobs; SELECT 'results:', COUNT(*) FROM results;"
```
