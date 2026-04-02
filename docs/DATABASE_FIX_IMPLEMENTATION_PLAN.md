# Database Fix Implementation Plan

**Created:** 2026-03-06  
**Based on:** [`DATABASE_USAGE_ANALYSIS.md`](DATABASE_USAGE_ANALYSIS.md)

---

## Overview

แผนการแก้ไขปัญหา Database ในระบบ Eval System V2 ตามที่วิเคราะห์ไว้

---

## Phase 1: Critical Fixes (Priority 1)

### 1.1 Fix Foreign Key Constraints in Results Table

**File:** [`backend/db/orm_models.py`](backend/db/orm_models.py:66-93)

**Changes:**
```python
# Before:
class ResultORM(Base):
    """Result table for persisting test results."""
    __tablename__ = "results"

    id = Column(String(32), primary_key=True)
    job_id = Column(String(32), nullable=False)  # ❌ No FK
    job_name = Column(String(255), nullable=False)
    board_id = Column(String(32), nullable=False)  # ❌ No FK
    board_name = Column(String(255), nullable=False)
    ...

# After:
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

**Migration Required:**
- SQLite ไม่รองรับ ALTER TABLE เพื่อเพิ่ม FK
- ต้อง recreate table หรือใช้ Alembic migration

---

### 1.2 Update Job Creation to Use File IDs

**File:** [`backend/services/job_queue.py`](backend/services/job_queue.py:84-115)

**Changes:**
```python
# Add helper method to resolve file IDs
async def _resolve_file_id(self, filename: Optional[str]) -> Optional[str]:
    """Resolve file ID from filename."""
    if not filename:
        return None
    from services.file_store import file_store
    files = await file_store.list_files()
    for f in files:
        if f["name"] == filename:
            return f["id"]
    return None

# Update add_job method
async def add_job(self, job_data: JobCreate) -> Job:
    """Add a new job to the queue."""
    job_id = str(uuid.uuid4())[:8]
    
    # Resolve file IDs
    vcd_file_id = await self._resolve_file_id(job_data.vcd_filename)
    firmware_file_id = await self._resolve_file_id(job_data.firmware_filename)
    
    async with async_session() as session:
        result = await session.execute(
            select(JobORM.queue_position).order_by(JobORM.queue_position.desc()).limit(1)
        )
        max_pos = result.scalar() or 0
        
        orm = JobORM(
            id=job_id,
            name=job_data.name,
            vcd_file_id=vcd_file_id,  # ✅ Use file ID
            firmware_file_id=firmware_file_id,  # ✅ Use file ID
            vcd_filename=job_data.vcd_filename,  # Keep for backward compatibility
            firmware_filename=job_data.firmware_filename,  # Keep for backward compatibility
            target_board_id=job_data.target_board_id,
            priority=job_data.priority,
            queue_position=max_pos + 1,
            timeout_seconds=job_data.timeout_seconds,
            retries=job_data.retries,
            enable_picoscope=job_data.enable_picoscope,
            save_to_db=job_data.save_to_db,
            state="pending",
            progress=0,
            created_at=datetime.utcnow(),
        )
        session.add(orm)
        await session.commit()
        await session.refresh(orm)
        return self._orm_to_model(orm)
```

---

### 1.3 Create Profiles Router

**New File:** [`backend/routers/profiles.py`](backend/routers/profiles.py)

```python
"""Profile management API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import ProfileORM

router = APIRouter()


class ProfileCreate(BaseModel):
    name: str
    data: Optional[Dict[str, Any]] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


@router.get("")
async def list_profiles():
    """Get all profiles."""
    async with async_session() as session:
        result = await session.execute(select(ProfileORM))
        profiles = result.scalars().all()
        return [
            {
                "id": p.id,
                "name": p.name,
                "data": p.data,
                "updated_at": p.updated_at.isoformat() + "Z",
            }
            for p in profiles
        ]


@router.post("")
async def create_profile(payload: ProfileCreate):
    """Create a new profile."""
    import uuid
    
    profile_id = str(uuid.uuid4())
    async with async_session() as session:
        orm = ProfileORM(
            id=profile_id,
            name=payload.name,
            data=payload.data,
            updated_at=datetime.utcnow(),
        )
        session.add(orm)
        await session.commit()
        await session.refresh(orm)
        
        return {
            "id": orm.id,
            "name": orm.name,
            "data": orm.data,
            "updated_at": orm.updated_at.isoformat() + "Z",
        }


@router.get("/{profile_id}")
async def get_profile(profile_id: str):
    """Get a specific profile."""
    async with async_session() as session:
        result = await session.execute(
            select(ProfileORM).where(ProfileORM.id == profile_id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return {
            "id": profile.id,
            "name": profile.name,
            "data": profile.data,
            "updated_at": profile.updated_at.isoformat() + "Z",
        }


@router.get("/{profile_id}/data")
async def get_profile_data(profile_id: str):
    """Get profile data only."""
    async with async_session() as session:
        result = await session.execute(
            select(ProfileORM.data).where(ProfileORM.id == profile_id)
        )
        data = result.scalar_one_or_none()
        if data is None:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return data


@router.patch("/{profile_id}")
async def update_profile(profile_id: str, payload: ProfileUpdate):
    """Update a profile."""
    async with async_session() as session:
        values = {}
        if payload.name is not None:
            values["name"] = payload.name
        if payload.data is not None:
            values["data"] = payload.data
        values["updated_at"] = datetime.utcnow()
        
        result = await session.execute(
            update(ProfileORM).where(ProfileORM.id == profile_id).values(**values)
        )
        await session.commit()
        
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return {"success": True}


@router.delete("/{profile_id}")
async def delete_profile(profile_id: str):
    """Delete a profile."""
    async with async_session() as session:
        result = await session.execute(
            delete(ProfileORM).where(ProfileORM.id == profile_id)
        )
        await session.commit()
        
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return {"success": True}
```

**Register Router in [`backend/main.py`](backend/main.py):**
```python
from routers import profiles

# Add this line with other router registrations
app.include_router(profiles.router, prefix="/api/profiles", tags=["profiles"])
```

---

## Phase 2: Medium Priority Fixes

### 2.1 Implement Test Cases/Sets ORM Models

**File:** [`backend/db/orm_models.py`](backend/db/orm_models.py)

**Add after ProfileORM:**
```python
class TestCaseORM(Base):
    """Test case definitions."""
    __tablename__ = "test_cases"

    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    vcd_file_id = Column(String(36), ForeignKey("files.id"), nullable=True)
    firmware_filename = Column(String(255), nullable=True)
    tags = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TestSetORM(Base):
    """Test sets (suites)."""
    __tablename__ = "test_sets"

    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    tags = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TestSetItemORM(Base):
    """Link table for Test Sets → Test Cases."""
    __tablename__ = "test_set_items"

    id = Column(String(32), primary_key=True)
    test_set_id = Column(String(32), ForeignKey("test_sets.id"), nullable=False)
    test_case_id = Column(String(32), ForeignKey("test_cases.id"), nullable=False)
    execution_order = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
```

---

### 2.2 Add Job Metadata Columns to Jobs Table

**File:** [`backend/db/orm_models.py`](backend/db/orm_models.py:30-64)

**Add columns to JobORM:**
```python
class JobORM(Base):
    """Job table for persisting job queue."""
    __tablename__ = "jobs"

    id = Column(String(32), primary_key=True)
    name = Column(String(255), nullable=False)
    
    # Linked Files
    vcd_file_id = Column(String(36), ForeignKey("files.id"), nullable=True)
    firmware_file_id = Column(String(36), ForeignKey("files.id"), nullable=True)
    
    # Legacy fields (kept for compatibility or simple display)
    vcd_filename = Column(String(255), nullable=True)
    firmware_filename = Column(String(255), nullable=True)

    target_board_id = Column(String(32), nullable=True)
    assigned_board_id = Column(String(32), nullable=True)
    priority = Column(Integer, default=0)
    queue_position = Column(Integer, default=0)
    timeout_seconds = Column(Integer, default=60)
    retries = Column(Integer, default=0)
    enable_picoscope = Column(Boolean, default=False)
    save_to_db = Column(Boolean, default=True)
    
    # Status fields
    state = Column(String(32), default="pending")
    progress = Column(Integer, default=0)
    current_step = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    
    # ✅ NEW: Frontend metadata columns
    tag = Column(String(255), nullable=True)
    client_id = Column(String(128), nullable=True)
    config_name = Column(String(255), nullable=True)
    pairs_data = Column(JSON, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
```

---

### 2.3 Update Job Creation to Include Metadata

**File:** [`backend/services/job_queue.py`](backend/services/job_queue.py:84-115)

**Update JobCreate model in [`models/job.py`](models/job.py):**
```python
class JobCreate(BaseModel):
    name: str
    vcd_filename: Optional[str] = None
    firmware_filename: Optional[str] = None
    target_board_id: Optional[str] = None
    priority: int = 0
    timeout_seconds: int = 60
    retries: int = 0
    enable_picoscope: bool = False
    save_to_db: bool = True
    # ✅ NEW: Frontend metadata
    tag: Optional[str] = None
    client_id: Optional[str] = None
    config_name: Optional[str] = None
    pairs_data: Optional[dict] = None
```

**Update add_job method:**
```python
async def add_job(self, job_data: JobCreate) -> Job:
    """Add a new job to the queue."""
    job_id = str(uuid.uuid4())[:8]
    
    # Resolve file IDs
    vcd_file_id = await self._resolve_file_id(job_data.vcd_filename)
    firmware_file_id = await self._resolve_file_id(job_data.firmware_filename)
    
    async with async_session() as session:
        result = await session.execute(
            select(JobORM.queue_position).order_by(JobORM.queue_position.desc()).limit(1)
        )
        max_pos = result.scalar() or 0
        
        orm = JobORM(
            id=job_id,
            name=job_data.name,
            vcd_file_id=vcd_file_id,
            firmware_file_id=firmware_file_id,
            vcd_filename=job_data.vcd_filename,
            firmware_filename=job_data.firmware_filename,
            target_board_id=job_data.target_board_id,
            priority=job_data.priority,
            queue_position=max_pos + 1,
            timeout_seconds=job_data.timeout_seconds,
            retries=job_data.retries,
            enable_picoscope=job_data.enable_picoscope,
            save_to_db=job_data.save_to_db,
            state="pending",
            progress=0,
            # ✅ NEW: Frontend metadata
            tag=job_data.tag,
            client_id=job_data.client_id,
            config_name=job_data.config_name,
            pairs_data=job_data.pairs_data,
            created_at=datetime.utcnow(),
        )
        session.add(orm)
        await session.commit()
        await session.refresh(orm)
        return self._orm_to_model(orm)
```

---

### 2.4 Implement Missing Board Endpoints

**File:** [`backend/routers/boards.py`](backend/routers/boards.py)

**Add new endpoints:**
```python
@router.post("/{board_id}/pause-queue")
async def pause_board_queue(board_id: str):
    """Pause queue for a specific board."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    
    # Set board to a "paused" state (or use tag)
    updated = await board_manager.update_board(board_id, {"tag": "paused"})
    if not updated:
        raise HTTPException(status_code=400, detail="Failed to pause board queue")
    
    return {"success": True, "message": f"Queue paused for board {board_id}"}


@router.post("/{board_id}/resume-queue")
async def resume_board_queue(board_id: str):
    """Resume queue for a specific board."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    
    # Remove "paused" tag
    updated = await board_manager.update_board(board_id, {"tag": None})
    if not updated:
        raise HTTPException(status_code=400, detail="Failed to resume board queue")
    
    return {"success": True, "message": f"Queue resumed for board {board_id}"}


@router.post("/{board_id}/shutdown")
async def shutdown_board(board_id: str):
    """Shutdown a board."""
    success = await board_manager.reboot_board(board_id)  # Use reboot for now
    if not success:
        raise HTTPException(status_code=400, detail="Failed to shutdown board")
    
    return {"success": True, "message": f"Board {board_id} shutdown initiated"}


@router.post("/{board_id}/ssh/connect")
async def ssh_connect_board(board_id: str):
    """Get SSH connection details for a board."""
    board = await board_manager.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found")
    
    if not board.ip_address:
        raise HTTPException(status_code=400, detail="Board has no IP address")
    
    return {
        "success": True,
        "host": board.ip_address,
        "port": 22,  # Default SSH port
        "username": "root",  # Default username for Zybo
    }


@router.post("/batch")
async def batch_board_actions(payload: BatchActionRequest):
    """Perform batch actions on multiple boards."""
    results = []
    
    for board_id in payload.boardIds:
        try:
            board = await board_manager.get_board(board_id)
            if not board:
                results.append({"boardId": board_id, "success": False, "error": "Board not found"})
                continue
            
            if payload.action == "reboot":
                success = await board_manager.reboot_board(board_id)
            elif payload.action == "pause":
                await board_manager.update_board(board_id, {"tag": "paused"})
                success = True
            elif payload.action == "resume":
                await board_manager.update_board(board_id, {"tag": None})
                success = True
            else:
                success = False
            
            results.append({"boardId": board_id, "success": success})
        except Exception as e:
            results.append({"boardId": board_id, "success": False, "error": str(e)})
    
    return {"results": results}
```

---

## Phase 3: Low Priority Fixes

### 3.1 Create Notifications Table

**File:** [`backend/db/orm_models.py`](backend/db/orm_models.py)

**Add after ProfileORM:**
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

### 3.2 Create Notifications Router

**New File:** [`backend/routers/notifications.py`](backend/routers/notifications.py)

```python
"""Notification management API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import NotificationORM

router = APIRouter()


class NotificationCreate(BaseModel):
    user_id: Optional[str] = None
    type: str
    title: str
    message: Optional[str] = None
    data: Optional[dict] = None


@router.get("")
async def list_notifications(user_id: Optional[str] = None, unread_only: bool = False):
    """Get notifications."""
    async with async_session() as session:
        query = select(NotificationORM).order_by(NotificationORM.created_at.desc())
        
        if user_id:
            query = query.where(
                (NotificationORM.user_id == user_id) | (NotificationORM.user_id.is_(None))
            )
        
        if unread_only:
            query = query.where(NotificationORM.read == False)
        
        result = await session.execute(query)
        notifications = result.scalars().all()
        
        return [
            {
                "id": n.id,
                "userId": n.user_id,
                "type": n.type,
                "title": n.title,
                "message": n.message,
                "data": n.data,
                "read": n.read,
                "createdAt": n.created_at.isoformat() + "Z",
            }
            for n in notifications
        ]


@router.post("")
async def create_notification(payload: NotificationCreate):
    """Create a new notification."""
    notification_id = str(uuid.uuid4())
    
    async with async_session() as session:
        orm = NotificationORM(
            id=notification_id,
            user_id=payload.user_id,
            type=payload.type,
            title=payload.title,
            message=payload.message,
            data=payload.data,
            read=False,
            created_at=datetime.utcnow(),
        )
        session.add(orm)
        await session.commit()
        
        return {"id": notification_id, "success": True}


@router.post("/{notification_id}/read")
async def mark_notification_read(notification_id: str):
    """Mark notification as read."""
    async with async_session() as session:
        result = await session.execute(
            update(NotificationORM)
            .where(NotificationORM.id == notification_id)
            .values(read=True)
        )
        await session.commit()
        
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        
        return {"success": True}


@router.post("/read-all")
async def mark_all_read(user_id: Optional[str] = None):
    """Mark all notifications as read."""
    async with async_session() as session:
        query = update(NotificationORM).values(read=True)
        
        if user_id:
            query = query.where(NotificationORM.user_id == user_id)
        
        await session.execute(query)
        await session.commit()
        
        return {"success": True}


@router.delete("/{notification_id}")
async def delete_notification(notification_id: str):
    """Delete a notification."""
    async with async_session() as session:
        result = await session.execute(
            delete(NotificationORM).where(NotificationORM.id == notification_id)
        )
        await session.commit()
        
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        
        return {"success": True}
```

**Register Router in [`backend/main.py`](backend/main.py):**
```python
from routers import notifications

# Add this line with other router registrations
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])
```

---

## Migration Strategy

### Option 1: Drop and Recreate (SQLite Demo Mode)

สำหรับ demo mode ที่ใช้ SQLite สามารถ drop และ recreate tables ได้:

```python
# In backend/main.py or a migration script
async def migrate_database():
    """Drop and recreate tables with new schema."""
    from db.database import engine, Base
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    
    print("[Migration] Database recreated with new schema")
```

### Option 2: Alembic Migrations (Production)

สำหรับ production ที่ใช้ PostgreSQL ควรใช้ Alembic:

```bash
# Generate migration
alembic revision --autogenerate -m "Add FK constraints and new columns"

# Review migration file
# Edit alembic/versions/xxx_add_fk_constraints.py

# Apply migration
alembic upgrade head
```

---

## Testing Checklist

- [ ] Test Results table FK constraints (try to insert invalid job_id or board_id)
- [ ] Test Job creation with file IDs
- [ ] Test Profiles CRUD operations
- [ ] Test Test Cases/Sets CRUD operations
- [ ] Test Job metadata persistence
- [ ] Test Board batch actions
- [ ] Test Notifications CRUD operations
- [ ] Test frontend integration with all new endpoints

---

## Rollback Plan

หากมีปัญหาหลังจาก deploy:

1. Restore database from backup
2. Revert code changes using git
3. Restart services

```bash
# Example rollback commands
git checkout HEAD~1  # Revert to previous commit
# Restore database
sqlite3 eval_system_demo.db < backup.sql
```

---

## Next Steps

หลังจาก implement ทั้งหมดเสร็จ:

1. Update API documentation
2. Update frontend to use new endpoints
3. Write integration tests
4. Performance testing
5. Deploy to staging environment
