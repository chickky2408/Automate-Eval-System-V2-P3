"""
File Store Service with PostgreSQL and Disk persistence.
Supports main library (set_id=None) and per-set storage (set_id=set_id).
"""
from __future__ import annotations
from typing import List, Optional
from datetime import datetime
import os
import uuid
import hashlib
import aiofiles
from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import FileORM, FileType
from utils.file_type_utils import classify_file_type_from_filename

class FileStore:
    def __init__(self, base_path: str = "uploads") -> None:
        self.base_path = base_path
        os.makedirs(self.base_path, exist_ok=True)

    @staticmethod
    def _meta_from_orm(f: FileORM) -> dict:
        """uploadDate = first upload; updatedAt = last metadata change (tags, name patch, etc.)."""
        upload = f.uploaded_at.isoformat() + "Z"
        upd = getattr(f, "updated_at", None) or f.uploaded_at
        return {
            "id": f.id,
            "name": f.filename,
            "size": f.size_bytes,
            "type": f.file_type.value,
            "uploadDate": upload,
            "updatedAt": upd.isoformat() + "Z",
            "checksum": f.checksum_sha256,
            "set_id": f.set_id,
            "ownerId": getattr(f, "owner_id", None),
            "ownerDisplayName": getattr(f, "owner_display_name", None),
            "visibility": getattr(f, "visibility", None) or "public",
            "tags": getattr(f, "library_tags", None),
            "tagColor": getattr(f, "tag_color", None),
        }

    def _get_storage_path(self, file_type: str, filename: str, file_uuid: str) -> str:
        """Generate a structured path: uploads/TYPE/YYYY/MM/uid_filename"""
        now = datetime.utcnow()
        type_dir = file_type.upper()
        year_dir = now.strftime("%Y")
        month_dir = now.strftime("%m")
        
        directory = os.path.join(self.base_path, type_dir, year_dir, month_dir)
        os.makedirs(directory, exist_ok=True)
        
        safe_filename = "".join(c for c in filename if c.isalnum() or c in "._-")
        return os.path.join(directory, f"{file_uuid}_{safe_filename}")

    def _checksum_bytes(self, content: bytes) -> str:
        """Calculate SHA256 checksum of content in memory."""
        return hashlib.sha256(content).hexdigest()

    async def calculate_checksum(self, file_path: str) -> str:
        """Calculate SHA256 checksum of a file asynchronously."""
        sha256 = hashlib.sha256()
        async with aiofiles.open(file_path, "rb") as f:
            while chunk := await f.read(8192):
                sha256.update(chunk)
        return sha256.hexdigest()

    async def find_by_checksum(self, checksum: str, set_id: Optional[str] = None) -> Optional[dict]:
        """Find an existing file with the same content (checksum) in the same scope (library or set)."""
        async with async_session() as session:
            q = select(FileORM).where(FileORM.checksum_sha256 == checksum)
            if set_id is None:
                q = q.where(FileORM.set_id.is_(None))
            else:
                q = q.where(FileORM.set_id == set_id)
            result = await session.execute(q)
            f = result.scalars().first()
            if not f:
                return None
            return self._meta_from_orm(f)

    async def find_by_name(self, name: str, set_id: Optional[str] = None) -> List[dict]:
        """Find existing file(s) with the same name in the same scope. Returns list (may be multiple)."""
        async with async_session() as session:
            q = select(FileORM).where(FileORM.filename == name)
            if set_id is None:
                q = q.where(FileORM.set_id.is_(None))
            else:
                q = q.where(FileORM.set_id == set_id)
            result = await session.execute(q)
            files = result.scalars().all()
            return [self._meta_from_orm(f) for f in files]

    async def add_file(
        self,
        name: str,
        file_type: str,  # kept for call-site compatibility; stored type is derived from `name`
        content: bytes,
        set_id: Optional[str] = None,
        force_new: bool = False,
        owner_id: Optional[str] = None,
        owner_display_name: Optional[str] = None,
        visibility: str = "public",
    ) -> dict:
        """Save file to disk and DB. set_id=None for main library; set_id=id for set storage.
        Detects duplicates: by content (checksum) returns existing record without saving, unless force_new=True;
        by name sets duplicateByName in response if same name already exists.
        Stored `file_type` is derived from the filename (VCD, EROM, ULP, TXT, …); `file_type` arg is legacy."""
        _ = file_type
        checksum = self._checksum_bytes(content)
        size = len(content)

        # Duplicate by content: return existing file (no new save) unless force_new
        existing_by_content = await self.find_by_checksum(checksum, set_id)
        if existing_by_content and not force_new:
            return {
                **{k: v for k, v in existing_by_content.items() if k != "duplicateByContent"},
                "duplicateByContent": True,
            }

        # Check duplicate by name (before adding; we will still save if content is new)
        existing_by_name = await self.find_by_name(name, set_id)

        file_uuid = str(uuid.uuid4())
        # Classify from filename so .erom/.ulp/.txt never fall through to OTHER.
        cname = classify_file_type_from_filename(name)
        try:
            ftype = FileType(cname)
        except ValueError:
            ftype = FileType.OTHER
        storage_path = self._get_storage_path(ftype.value, name, file_uuid)

        async with aiofiles.open(storage_path, "wb") as f:
            await f.write(content)

        async with async_session() as session:
            now = datetime.utcnow()
            orm = FileORM(
                id=file_uuid,
                filename=name,
                file_type=ftype,
                storage_path=storage_path,
                checksum_sha256=checksum,
                size_bytes=size,
                uploaded_at=now,
                updated_at=now,
                set_id=set_id,
                owner_id=owner_id,
                owner_display_name=(owner_display_name or "").strip() or None,
                library_tags=None,
                tag_color=None,
                visibility=visibility or "public",
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)

            out = {
                "id": orm.id,
                "name": orm.filename,
                "size": orm.size_bytes,
                "type": orm.file_type.value,
                "uploadDate": orm.uploaded_at.isoformat() + "Z",
                "updatedAt": (getattr(orm, "updated_at", None) or orm.uploaded_at).isoformat() + "Z",
                "checksum": orm.checksum_sha256,
                "set_id": orm.set_id,
                "ownerId": getattr(orm, "owner_id", None),
                "ownerDisplayName": getattr(orm, "owner_display_name", None),
                "tags": getattr(orm, "library_tags", None),
                "tagColor": getattr(orm, "tag_color", None),
                "visibility": getattr(orm, "visibility", None) or "public",
            }
            if existing_by_name:
                out["duplicateByName"] = True
            return out

    async def list_files(self, set_id: Optional[str] = None) -> List[dict]:
        """List files from DB. set_id=None => main library only (set_id IS NULL); set_id=x => files for that set."""
        async with async_session() as session:
            q = select(FileORM).order_by(FileORM.uploaded_at.desc())
            if set_id is None:
                q = q.where(FileORM.set_id.is_(None))
            else:
                q = q.where(FileORM.set_id == set_id)
            result = await session.execute(q)
            files = result.scalars().all()
            return [self._meta_from_orm(f) for f in files]

    async def update_file_library_tags(self, file_id: str, raw: dict) -> bool:
        """Patch library_tags and/or tag_color. Keys: tags, tagColor (camelCase from API)."""
        # Must match frontend `TAG_PALETTE_MAP` keys in utils/tagPalette.js
        allowed = {
            "mint", "emerald", "green", "lime", "yellow", "amber", "orange", "red",
            "rose", "pink", "fuchsia", "violet", "purple", "indigo", "blue", "sky",
            "cyan", "teal", "slate", "gray", "zinc", "neutral", "stone", "crimson",
            "coral", "gold", "olive", "ocean", "royal", "plum", "berry",
        }
        async with async_session() as session:
            result = await session.execute(select(FileORM).where(FileORM.id == file_id))
            f = result.scalar_one_or_none()
            if not f:
                return False
            if "tags" in raw:
                f.library_tags = (raw.get("tags") or "").strip() or None
            if "tagColor" in raw:
                rc = (raw.get("tagColor") or "").strip() or None
                f.tag_color = rc if rc in allowed else None
            f.updated_at = datetime.utcnow()
            await session.commit()
            return True

    async def get_file(self, file_id: str) -> Optional[dict]:
        """Get file metadata by ID."""
        async with async_session() as session:
            result = await session.execute(select(FileORM).where(FileORM.id == file_id))
            f = result.scalar_one_or_none()
            if not f:
                return None
            return {
                "id": f.id,
                "name": f.filename,
                "size": f.size_bytes,
                "type": f.file_type.value,
                "uploadDate": f.uploaded_at.isoformat() + "Z",
                "updatedAt": (getattr(f, "updated_at", None) or f.uploaded_at).isoformat() + "Z",
                "path": f.storage_path, # Internal use only
                "checksum": f.checksum_sha256
            }

    async def delete_file(self, file_id: str) -> bool:
        """Delete file from DB and Disk."""
        async with async_session() as session:
            result = await session.execute(select(FileORM).where(FileORM.id == file_id))
            f = result.scalar_one_or_none()
            if not f:
                return False
                
            storage_path = f.storage_path
            await session.delete(f)
            await session.commit()
            
            # Remove from disk
            if os.path.exists(storage_path):
                try:
                    os.remove(storage_path)
                except OSError:
                    pass # Log warning
            return True

    async def get_file_content(self, file_id: str) -> Optional[bytes]:
        """Read file content from disk. Returns None if not found."""
        rec = await self.get_file(file_id)
        if not rec or not rec.get("path"):
            return None
        path = rec["path"]
        if not os.path.exists(path):
            return None
        async with aiofiles.open(path, "rb") as f:
            return await f.read()

    async def verify_file_checksum(self, file_id: str) -> bool:
        """Verify that file on disk still matches stored checksum. Returns True if OK, False if modified or missing."""
        rec = await self.get_file(file_id)
        if not rec or not rec.get("path"):
            return False
        stored = rec.get("checksum")
        if not stored:
            return True  # no checksum to verify
        path = rec["path"]
        if not os.path.exists(path):
            return False
        current = await self.calculate_checksum(path)
        return current == stored

    async def delete_files_by_set_id(self, set_id: str) -> int:
        """Delete all files for this set (from DB and disk). Returns count deleted."""
        async with async_session() as session:
            result = await session.execute(select(FileORM).where(FileORM.set_id == set_id))
            files = result.scalars().all()
            count = 0
            for f in files:
                if os.path.exists(f.storage_path):
                    try:
                        os.remove(f.storage_path)
                    except OSError:
                        pass
                await session.delete(f)
                count += 1
            await session.commit()
            return count

    async def save_set_files(self, set_id: str, file_ids: List[str]) -> List[dict]:
        """Copy given library files (by id) into set storage. Replaces any existing set files. Returns list of new file records."""
        await self.delete_files_by_set_id(set_id)
        out = []
        for fid in file_ids:
            content = await self.get_file_content(fid)
            if content is None:
                continue
            rec = await self.get_file(fid)
            if not rec:
                continue
            name = rec["name"]
            ftype = rec.get("type", "OTHER") or "OTHER"
            new_rec = await self.add_file(name=name, file_type=ftype, content=content, set_id=set_id)
            out.append({"id": new_rec["id"], "name": new_rec["name"], "size": new_rec["size"], "type": new_rec["type"], "uploadDate": new_rec["uploadDate"]})
        return out

    async def list_set_files(self, set_id: str) -> List[dict]:
        """List files stored for this set."""
        return await self.list_files(set_id=set_id)

    async def restore_set_files_to_library(self, set_id: str) -> List[dict]:
        """Copy all set files into main library (set_id=None). Returns new file list (id, name, size, type, uploadDate)."""
        set_files = await self.list_set_files(set_id)
        out = []
        for f in set_files:
            content = await self.get_file_content(f["id"])
            if content is None:
                continue
            new_rec = await self.add_file(name=f["name"], file_type=f.get("type", "OTHER") or "OTHER", content=content, set_id=None)
            out.append({"id": new_rec["id"], "name": new_rec["name"], "size": new_rec["size"], "type": new_rec["type"], "uploadDate": new_rec["uploadDate"]})
        return out

file_store = FileStore()
