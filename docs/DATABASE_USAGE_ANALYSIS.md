# Database Usage Analysis Report

**Date:** 2026-03-06  
**System:** Eval System V2  
**Scope:** Frontend & Backend Database Usage Review

---

## Executive Summary

ระบบมีการใช้งาน Database โดยรวมถูกต้อง แต่พบปัญหาหลายจุดที่ต้องแก้ไข:

| หมวดหมู่ | สถานะ | รายละเอียด |
|----------|--------|----------|
| Database Connection | ✅ ถูกต้อง | SQLAlchemy async, SQLite/PostgreSQL support |
| ORM Models | ⚠️ ไม่สมบูรณ์ | ขาด FK constraints, ขาดตาราง test_cases/test_sets |
| Backend Services | ✅ ถูกต้อง | ใช้ session และ ORM อย่างถูกต้อง |
| Backend Routers | ⚠️ ไม่สมบูรณ์ | ขาด profiles router |
| Frontend API | ✅ ถูกต้อง | เรียก API อย่างถูกต้อง |
| Data Consistency | ❌ มีปัญหา | ข้อมูลบางส่วนเก็บใน memory เท่านั้น |

---

## 1. Database Structure Overview

### 1.1 Tables Defined in ORM Models

| ตาราง | File | สถานะ |
|--------|------|--------|
| `files` | [`orm_models.py:16-27`](backend/db/orm_models.py:16-27) | ✅ สมบูรณ์ |
| `boards` | [`orm_models.py:105-127`](backend/db/orm_models.py:105-127) | ✅ สมบูรณ์ |
| `jobs` | [`orm_models.py:30-64`](backend/db/orm_models.py:30-64) | ⚠️ ไม่ใช้ FK อย่างถูกต้อง |
| `results` | [`orm_models.py:66-93`](backend/db/orm_models.py:66-93) | ❌ ขาด FK constraints |
| `profiles` | [`orm_models.py:95-102`](backend/db/orm_models.py:95-102) | ✅ สมบูรณ์แต่ไม่มี router |

### 1.2 Tables Documented But Not Implemented

| ตาราง | เอกสาร | สถานะ |
|--------|---------|--------|
| `test_cases` | [`03_DATABASE_SCHEMA.md:50-61`](docs/03_DATABASE_SCHEMA.md:50-61) | ❌ ไม่ได้ implement |
| `test_sets` | [`03_DATABASE_SCHEMA.md:63-72`](docs/03_DATABASE_SCHEMA.md:63-72) | ❌ ไม่ได้ implement |
| `test_set_items` | [`03_DATABASE_SCHEMA.md:74-83`](docs/03_DATABASE_SCHEMA.md:74-83) | ❌ ไม่ได้ implement |

---

## 2. Issues Found

### 2.1 Jobs Table - Incomplete Foreign Key Usage

**Location:** [`job_queue.py:99-100`](backend/services/job_queue.py:99-100)

**Problem:**
```python
# TODO: Map filenames to IDs if possible, for now duplicate to legacy
orm = JobORM(
    id=job_id,
    name=job_data.name,
    vcd_filename=job_data.vcd_filename, # TODO: Use FileID
    firmware_filename=job_data.firmware_filename, # TODO: Use FileID
    ...
)
```

- Schema มี `vcd_file_id` และ `firmware_file_id` (FK → files.id)
- แต่โค้ดยังใช้ `vcd_filename` และ `firmware_filename` (legacy columns)
- ไม่มีการใช้ FK columns ในการสร้าง job

**Impact:**
- ข้อมูลไม่สัมพันธ์กันอย่างถูกต้อง
- ไม่สามารถ cascade delete ได้
- Query ที่ต้องการ join กับ files table จะไม่ทำงาน

**Recommendation:**
```python
# ควรใช้ File ID แทน filename
orm = JobORM(
    id=job_id,
    name=job_data.name,
    vcd_file_id=job_data.vcd_file_id,  # FK to files.id
    firmware_file_id=job_data.firmware_file_id,  # FK to files.id
    # vcd_filename และ firmware_filename ควรเป็น computed/read-only
    ...
)
```

---

### 2.2 Results Table - Missing Foreign Key Constraints

**Location:** [`orm_models.py:66-93`](backend/db/orm_models.py:66-93)

**Problem:**
```python
class ResultORM(Base):
    """Result table for persisting test results."""
    __tablename__ = "results"

    id = Column(String(32), primary_key=True)
    job_id = Column(String(32), nullable=False)  # ❌ No FK constraint
    job_name = Column(String(255), nullable=False)
    board_id = Column(String(32), nullable=False)  # ❌ No FK constraint
    board_name = Column(String(255), nullable=False)
    ...
```

- `job_id` ไม่มี `ForeignKey("jobs.id")`
- `board_id` ไม่มี `ForeignKey("boards.id")`

**Impact:**
- Database ไม่ enforce referential integrity
- สามารถ insert result ที่ job_id หรือ board_id ไม่มีอยู่จริง
- Cascade delete ไม่ทำงาน

**Recommendation:**
```python
class ResultORM(Base):
    """Result table for persisting test results."""
    __tablename__ = "results"

    id = Column(String(32), primary_key=True)
    job_id = Column(String(32), ForeignKey("jobs.id"), nullable=False)  # ✅ Add FK
    job_name = Column(String(255), nullable=False)
    board_id = Column(String(32), ForeignKey("boards.id"), nullable=False)  # ✅ Add FK
    board_name = Column(String(255), nullable=False)
    ...
```

---

### 2.3 Profiles Table - No Backend Router

**Location:** [`orm_models.py:95-102`](backend/db/orm_models.py:95-102)

**Problem:**
- `ProfileORM` ถูก define ไว้แล้ว
- แต่ไม่มี router ใน [`backend/routers/`](backend/routers/) สำหรับ profiles
- Frontend มี endpoints ใน [`apiEndpoints.js:77-80`](frontend/src/utils/apiEndpoints.js:77-80):
  - `PROFILES`
  - `PROFILE_BY_ID`
  - `PROFILE_DATA`

**Impact:**
- Frontend เรียก API แต่ Backend ไม่มี implementation
- Features ที่เกี่ยวกับ profiles จะไม่ทำงาน

**Recommendation:**
สร้าง `backend/routers/profiles.py`:
```python
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from db.database import async_session
from db.orm_models import ProfileORM

router = APIRouter()

@router.get("")
async def list_profiles():
    async with async_session() as session:
        result = await session.execute(select(ProfileORM))
        profiles = result.scalars().all()
        return [{"id": p.id, "name": p.name, "data": p.data} for p in profiles]

@router.get("/{profile_id}")
async def get_profile(profile_id: str):
    async with async_session() as session:
        result = await session.execute(select(ProfileORM).where(ProfileORM.id == profile_id))
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        return {"id": profile.id, "name": profile.name, "data": profile.data}

@router.get("/{profile_id}/data")
async def get_profile_data(profile_id: str):
    async with async_session() as session:
        result = await session.execute(select(ProfileORM).where(ProfileORM.id == profile_id))
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        return profile.data
```

และ register router ใน `main.py`:
```python
from routers import profiles
app.include_router(profiles.router, prefix="/api/profiles", tags=["profiles"])
```

---

### 2.4 Test Cases/Sets - Not Implemented

**Location:** [`03_DATABASE_SCHEMA.md:47-84`](docs/03_DATABASE_SCHEMA.md:47-84)

**Problem:**
- เอกสารกำหนดให้มี 3 ตาราง:
  - `test_cases` - Test case definitions
  - `test_sets` - Groups of test cases
  - `test_set_items` - Link table for Test Sets → Test Cases
- แต่ไม่ได้ implement ใน `orm_models.py`

**Impact:**
- Saved Test Cases ถูกเก็บใน Frontend localStorage เท่านั้น (ตาม [`DATABASE_STRUCTURE.md:122-123`](docs/DATABASE_STRUCTURE.md:122-123))
- ข้อมูลไม่ persist ใน database
- ไม่สามารถ share ระหว่าง users ได้

**Recommendation:**
สร้าง ORM models ใน `backend/db/orm_models.py`:
```python
class TestCaseORM(Base):
    """Test case definitions."""
    __tablename__ = "test_cases"
    
    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    vcd_file_id = Column(String(36), ForeignKey("files.id"))
    firmware_filename = Column(String(255))
    tags = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)


class TestSetORM(Base):
    """Test sets (suites)."""
    __tablename__ = "test_sets"
    
    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    tags = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)


class TestSetItemORM(Base):
    """Link table for Test Sets → Test Cases."""
    __tablename__ = "test_set_items"
    
    id = Column(String(32), primary_key=True)
    test_set_id = Column(String(32), ForeignKey("test_sets.id"))
    test_case_id = Column(String(32), ForeignKey("test_cases.id"))
    execution_order = Column(Integer)
```

---

### 2.5 Data Inconsistency - In-Memory vs Database

**Location:** [`DATABASE_STRUCTURE.md:122-127`](docs/DATABASE_STRUCTURE.md:122-127)

**Problem:**

ข้อมูลบางส่วนถูกเก็บใน memory เท่านั้น (ไม่ persist):

| ข้อมูล | ที่เก็บ | ปัญหา |
|--------|---------|--------|
| Saved Test Cases | Frontend localStorage | ไม่อยู่ใน database |
| Job metadata (tag, clientId, firmware, boards[], files[], configName, pairsData) | Backend `fe_job_store` (in-memory) | สูญหายเมื่อ restart server |
| Notifications | In-memory (ถ้ามี) | สูญหายเมื่อ restart server |

**Impact:**
- ข้อมูลสูญหายเมื่อ server restart
- ไม่สามารถ query หรือ analyze ข้อมูลได้
- ไม่สามารถ sync ระหว่าง users ได้

**Recommendation:**

1. **Saved Test Cases** - ย้ายไป database (ดู 2.4)

2. **Job Metadata** - เพิ่ม columns ใน `jobs` table:
```python
class JobORM(Base):
    __tablename__ = "jobs"
    
    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    
    # Existing columns...
    vcd_file_id = Column(String(36), ForeignKey("files.id"))
    firmware_file_id = Column(String(36), ForeignKey("files.id"))
    ...
    
    # New columns for FE metadata
    tag = Column(String(255), nullable=True)
    client_id = Column(String(128), nullable=True)
    config_name = Column(String(255), nullable=True)
    pairs_data = Column(JSON, nullable=True)  # Store pairs data
```

3. **Notifications** - สร้าง table:
```python
class NotificationORM(Base):
    """User notifications."""
    __tablename__ = "notifications"
    
    id = Column(String(32), primary_key=True)
    user_id = Column(String(128), nullable=True)  # null = broadcast to all
    type = Column(String(50), nullable=False)  # job_completed, error, etc.
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    data = Column(JSON, nullable=True)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
```

---

### 2.6 Frontend API - Missing Backend Implementations

**Location:** [`apiEndpoints.js`](frontend/src/utils/apiEndpoints.js)

**Problem:**
บาง endpoints ใน frontend ไม่มี backend implementation:

| Endpoint | Frontend | Backend | สถานะ |
|----------|----------|---------|--------|
| `/api/profiles` | ✅ | ❌ | ขาด router |
| `/api/profiles/{id}` | ✅ | ❌ | ขาด router |
| `/api/profiles/{id}/data` | ✅ | ❌ | ขาด router |
| `/api/boards/{id}/pause-queue` | ✅ | ❌ | ขาด endpoint |
| `/api/boards/{id}/resume-queue` | ✅ | ❌ | ขาด endpoint |
| `/api/boards/{id}/shutdown` | ✅ | ❌ | ขาด endpoint |
| `/api/boards/{id}/ssh/connect` | ✅ | ❌ | ขาด endpoint |
| `/api/boards/batch` | ✅ | ❌ | ขาด endpoint |

**Recommendation:**
Implement missing endpoints ตามที่กำหนดใน frontend API specification

---

## 3. Database Connection - Correct ✅

**Location:** [`database.py`](backend/db/database.py)

Database connection ถูกต้อง:

```python
# Async engine setup
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
)

# Session factory
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)
```

- ✅ ใช้ async SQLAlchemy อย่างถูกต้อง
- ✅ Support SQLite (demo) และ PostgreSQL (production)
- ✅ Session factory ถูกต้อง
- ✅ Migration handling สำหรับ `set_id` column

---

## 4. Backend Services - Correct ✅

Services ทั้งหมดใช้ database อย่างถูกต้อง:

| Service | File | สถานะ |
|---------|------|--------|
| `file_store` | [`services/file_store.py`](backend/services/file_store.py) | ✅ |
| `job_queue` | [`services/job_queue.py`](backend/services/job_queue.py) | ✅ |
| `result_store` | [`services/result_store.py`](backend/services/result_store.py) | ✅ |
| `board_manager` | [`services/board_manager.py`](backend/services/board_manager.py) | ✅ |

ตัวอย่างการใช้ session อย่างถูกต้อง:
```python
async with async_session() as session:
    result = await session.execute(select(FileORM))
    files = result.scalars().all()
    return [self._orm_to_model(f) for f in files]
```

---

## 5. Frontend API - Correct ✅

Frontend เรียก API อย่างถูกต้อง:

**Location:** [`api.js`](frontend/src/services/api.js)

```javascript
const apiRequest = async (endpoint, options = {}) => {
  const response = await fetch(endpoint, config);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    const err = new Error(errorData.detail || errorData.message || `HTTP error! status: ${response.status}`);
    err.status = response.status;
    err.detail = errorData.detail || errorData.message;
    throw err;
  }
  
  return await response.json();
};
```

- ✅ Error handling ถูกต้อง
- ✅ Support authentication token
- ✅ Support FormData for file uploads
- ✅ Proper JSON serialization

---

## 6. Entity Relationship Diagram (Current State)

```mermaid
erDiagram
    files ||--o{ jobs : "vcd_file_id (NOT USED)"
    files ||--o{ jobs : "firmware_file_id (NOT USED)"
    boards ||--o{ jobs : "target_board_id"
    boards ||--o{ jobs : "assigned_board_id"
    jobs ||--o{ results : "job_id (NO FK)"
    boards ||--o{ results : "board_id (NO FK)"
    
    files {
        string id PK
        string filename
        enum file_type
        string storage_path
        string checksum_sha256
        bigint size_bytes
        datetime uploaded_at
        string set_id
    }
    
    boards {
        string id PK
        string name
        string ip_address
        string mac_address
        string firmware_version
        string model
        string tag
        json connections
        string state
        float cpu_temp
        float cpu_load
        float ram_usage
        string current_job_id
        datetime last_heartbeat
        datetime created_at
    }
    
    jobs {
        string id PK
        string name
        string vcd_file_id FK
        string firmware_file_id FK
        string vcd_filename
        string firmware_filename
        string target_board_id FK
        string assigned_board_id FK
        int priority
        int queue_position
        int timeout_seconds
        int retries
        boolean enable_picoscope
        boolean save_to_db
        string state
        int progress
        string current_step
        text error_message
        datetime created_at
        datetime started_at
        datetime completed_at
    }
    
    results {
        string id PK
        string job_id NO FK
        string job_name
        string board_id NO FK
        string board_name
        boolean passed
        datetime started_at
        datetime completed_at
        float duration_seconds
        string vcd_filename
        string firmware_filename
        text error_message
        int packet_count
        int crc_errors
        text console_log
        string waveform_hdf5_path
        json metrics
    }
    
    profiles {
        string id PK
        string name
        json data
        datetime updated_at
    }
```

---

## 7. Recommendations Summary

### Priority 1 - High Impact

1. **Fix Foreign Key Constraints in Results Table**
   - Add `ForeignKey("jobs.id")` to `results.job_id`
   - Add `ForeignKey("boards.id")` to `results.board_id`

2. **Implement Job File IDs**
   - Use `vcd_file_id` and `firmware_file_id` instead of legacy filename columns
   - Update job creation logic in `job_queue.py`

3. **Create Profiles Router**
   - Implement `backend/routers/profiles.py`
   - Register in `main.py`

### Priority 2 - Medium Impact

4. **Implement Test Cases/Sets Tables**
   - Create ORM models for `test_cases`, `test_sets`, `test_set_items`
   - Create corresponding routers and services
   - Migrate data from localStorage to database

5. **Persist Job Metadata**
   - Add columns to `jobs` table: `tag`, `client_id`, `config_name`, `pairs_data`
   - Update `fe_job_store` to use database instead of in-memory

6. **Implement Missing Backend Endpoints**
   - Board pause/resume queue
   - Board shutdown
   - Board SSH connect
   - Board batch actions

### Priority 3 - Low Impact

7. **Create Notifications Table**
   - Persist notifications to database
   - Create router and service

8. **Add Database Indexes**
   - Add indexes on frequently queried columns
   - Improve query performance

---

## 8. Migration Plan

### Step 1: Fix Foreign Keys (Immediate)
```sql
-- Note: SQLite doesn't support ALTER TABLE to add FK
-- Need to recreate table

-- Backup data
CREATE TABLE results_backup AS SELECT * FROM results;

-- Drop old table
DROP TABLE results;

-- Create new table with FK
CREATE TABLE results (
    id VARCHAR(32) PRIMARY KEY,
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
    packet_count INTEGER DEFAULT 0,
    crc_errors INTEGER DEFAULT 0,
    console_log TEXT,
    waveform_hdf5_path VARCHAR(512),
    metrics JSON,
    FOREIGN KEY (job_id) REFERENCES jobs(id),
    FOREIGN KEY (board_id) REFERENCES boards(id)
);

-- Restore data
INSERT INTO results SELECT * FROM results_backup;

-- Drop backup
DROP TABLE results_backup;
```

### Step 2: Update Job Creation Logic
```python
# In job_queue.py, update add_job method
async def add_job(self, job_data: JobCreate) -> Job:
    # Resolve file IDs from filenames
    vcd_file_id = await self._resolve_file_id(job_data.vcd_filename)
    firmware_file_id = await self._resolve_file_id(job_data.firmware_filename)
    
    orm = JobORM(
        id=job_id,
        name=job_data.name,
        vcd_file_id=vcd_file_id,  # Use file ID
        firmware_file_id=firmware_file_id,  # Use file ID
        ...
    )
```

### Step 3: Create Profiles Router
- See section 2.3 for implementation details

### Step 4: Implement Test Cases/Sets
- See section 2.4 for implementation details

### Step 5: Migrate Job Metadata
```python
# Add columns to jobs table
ALTER TABLE jobs ADD COLUMN tag VARCHAR(255);
ALTER TABLE jobs ADD COLUMN client_id VARCHAR(128);
ALTER TABLE jobs ADD COLUMN config_name VARCHAR(255);
ALTER TABLE jobs ADD COLUMN pairs_data JSON;
```

---

## 9. Conclusion

ระบบ Eval System V2 มีโครงสร้าง database ที่ดีโดยรวม แต่มีปัญหาที่ต้องแก้ไข:

**สิ่งที่ทำถูกต้อง:**
- ✅ Database connection และ session management
- ✅ ORM models ส่วนใหญ่
- ✅ Services ใช้ database อย่างถูกต้อง
- ✅ Frontend API calls

**สิ่งที่ต้องแก้ไข:**
- ❌ Foreign Key constraints ใน results table
- ❌ ไม่ได้ใช้ file IDs ใน jobs table
- ❌ ขาด profiles router
- ❌ ไม่มี test_cases/test_sets implementation
- ❌ ข้อมูลบางส่วนเก็บใน memory เท่านั้น

**คำแนะนำ:**
1. เริ่มจาก Priority 1 (High Impact) ก่อน
2. ทำ migration อย่างระมัดระวัง มี backup
3. Test ทุก step ก่อน deploy
4. พิจารณาใช้ Alembic สำหรับ database migrations ใน production
