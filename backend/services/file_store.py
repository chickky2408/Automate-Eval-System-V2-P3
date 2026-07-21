"""
File Store Service with relative path storage, deduplication, and manual cleanup queue.
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
from db.orm_models import FileORM, FileType, DeletionCandidateORM, TagORM, TagMapORM
from utils.file_type_utils import classify_file_type_from_filename
from utils.tag_text import normalize_comma_separated_tags

class FileStore:
    def __init__(self, base_path: str = "uploads") -> None:
        self.base_path = base_path
        # Normalize to forward slashes
        self.base_path = self.base_path.replace("\\", "/")
        os.makedirs(self.base_path, exist_ok=True)

    def resolve_path(self, path: str) -> str:
        """Convert a relative storage path to an absolute path for disk operations."""
        if not path:
            return ""
        if os.path.isabs(path):
            return path
        return os.path.abspath(os.path.join(os.getcwd(), path))

    async def _get_tags_for_file(self, session: AsyncSession, file_uuid: str) -> tuple[Optional[str], Optional[str]]:
        """Retrieve comma-separated tags and tag color for a file from centralized tag mapping."""
        q = (
            select(TagORM.name, TagORM.tag_color)
            .join(TagMapORM, TagMapORM.tag_id == TagORM.id)
            .where(
                and_(
                    TagMapORM.entity_id == file_uuid,
                    TagMapORM.entity_type == "FILE"
                )
            )
        )
        result = await session.execute(q)
        rows = result.all()
        if not rows:
            return None, None
        tags = ",".join(r[0] for r in rows)
        tag_color = rows[0][1] # use the color of the first tag as representative
        return tags, tag_color

    def _checksum_bytes(self, content: bytes) -> str:
        """Calculate SHA256 checksum of content in memory."""
        return hashlib.sha256(content).hexdigest()

    async def calculate_checksum(self, file_path: str) -> str:
        """Calculate SHA256 checksum of a file asynchronously."""
        resolved = self.resolve_path(file_path)
        sha256 = hashlib.sha256()
        async with aiofiles.open(resolved, "rb") as f:
            while chunk := await f.read(8192):
                sha256.update(chunk)
        return sha256.hexdigest()

    async def find_by_checksum(
        self,
        checksum: str,
        set_id: Optional[str] = None,
        name: Optional[str] = None,
        size: Optional[int] = None,
    ) -> Optional[dict]:
        """Find an existing file with the same content.

        When *name* and *size* are supplied the query narrows to
        SHA-256 + filename + size_bytes to avoid false-positive matches
        from rare hash collisions or files that share a checksum by
        coincidence but differ in name/length.
        """
        async with async_session() as session:
            # Build WHERE clause — always require checksum; optionally tighten
            # with filename and byte-size when the caller has that information.
            conditions = [FileORM.checksum_sha256 == checksum]
            if name is not None:
                conditions.append(FileORM.filename == name)
            if size is not None:
                conditions.append(FileORM.size_bytes == size)

            q = select(FileORM).where(and_(*conditions))
            result = await session.execute(q)
            candidates = result.scalars().all()

            for f in candidates:
                # Byte-by-byte disk verification to guard against hash collisions
                cand_path = self.resolve_path(f.storage_path)
                if os.path.exists(cand_path):
                    try:
                        actual_checksum = await self.calculate_checksum(cand_path)
                        if actual_checksum != checksum:
                            # Disk file has drifted — skip this candidate
                            continue
                    except Exception:
                        continue

                tags, tag_color = await self._get_tags_for_file(session, f.id)
                rel_path = f.storage_path.replace("\\", "/")
                return {
                    "id": f.id,
                    "name": f.filename,
                    "size": f.size_bytes,
                    "type": f.file_type.value,
                    "uploadDate": f.uploaded_at.isoformat() + "Z",
                    "updatedAt": (f.updated_at or f.uploaded_at).isoformat() + "Z",
                    "checksum": f.checksum_sha256,
                    "path": rel_path,
                    "ownerId": f.owner_id,
                    "visibility": "public",
                    "tags": tags,
                    "tagColor": tag_color,
                }
            return None

    async def find_by_name(self, name: str, set_id: Optional[str] = None) -> List[dict]:
        """Find existing file(s) with the same name."""
        async with async_session() as session:
            q = select(FileORM).where(FileORM.filename == name)
            result = await session.execute(q)
            files = result.scalars().all()
            out = []
            for f in files:
                tags, tag_color = await self._get_tags_for_file(session, f.id)
                rel_path = f.storage_path.replace("\\", "/")
                out.append({
                    "id": f.id,
                    "name": f.filename,
                    "size": f.size_bytes,
                    "type": f.file_type.value,
                    "uploadDate": f.uploaded_at.isoformat() + "Z",
                    "updatedAt": (f.updated_at or f.uploaded_at).isoformat() + "Z",
                    "checksum": f.checksum_sha256,
                    "path": rel_path,
                    "ownerId": f.owner_id,
                    "visibility": "public",
                    "tags": tags,
                    "tagColor": tag_color,
                })
            return out

    def _get_storage_path(self, file_type: str, filename: str, file_uuid: str) -> str:
        """Generate a relative structured path: uploads/TYPE/YYYY/MM/uid_filename"""
        now = datetime.utcnow()
        type_dir = file_type.upper()
        year_dir = now.strftime("%Y")
        month_dir = now.strftime("%m")
        
        # Build path using forward slashes
        rel_dir = f"{self.base_path}/{type_dir}/{year_dir}/{month_dir}"
        # Ensure physical directories exist locally
        os.makedirs(self.resolve_path(rel_dir), exist_ok=True)
        
        safe_filename = "".join(c for c in filename if c.isalnum() or c in "._-")
        return f"{rel_dir}/{file_uuid}_{safe_filename}"

    async def add_file(
        self,
        name: str,
        file_type: str,
        content: bytes,
        set_id: Optional[str] = None, # legacy
        force_new: bool = False,
        owner_id: Optional[str] = None,
        owner_display_name: Optional[str] = None, # legacy
        visibility: str = "public", # legacy
    ) -> dict:
        """Save file to disk and DB with deduplication verify."""
        checksum = self._checksum_bytes(content)
        size = len(content)

        # 1. Deduplication: Find file with matching checksum, name, and size
        if not force_new:
            async with async_session() as session:
                q = select(FileORM).where(
                    and_(
                        FileORM.checksum_sha256 == checksum,
                        FileORM.filename == name,
                        FileORM.size_bytes == size
                    )
                )
                result = await session.execute(q)
                candidates = result.scalars().all()
                for cand in candidates:
                    # Perform byte-by-byte validation to prevent collision issues
                    cand_path = self.resolve_path(cand.storage_path)
                    if os.path.exists(cand_path):
                        try:
                            async with aiofiles.open(cand_path, "rb") as cand_f:
                                cand_content = await cand_f.read()
                            if cand_content == content:
                                # Exact duplicate found, skip saving new file
                                tags, tag_color = await self._get_tags_for_file(session, cand.id)
                                rel_path = cand.storage_path.replace("\\", "/")
                                return {
                                    "id": cand.id,
                                    "name": cand.filename,
                                    "size": cand.size_bytes,
                                    "type": cand.file_type.value,
                                    "uploadDate": cand.uploaded_at.isoformat() + "Z",
                                    "updatedAt": (cand.updated_at or cand.uploaded_at).isoformat() + "Z",
                                    "checksum": cand.checksum_sha256,
                                    "path": rel_path,
                                    "ownerId": cand.owner_id,
                                    "visibility": "public",
                                    "tags": tags,
                                    "tagColor": tag_color,
                                    "duplicateByContent": True,
                                }
                        except Exception:
                            pass

        # Check duplicate by name (UI convenience flags)
        existing_by_name = await self.find_by_name(name)

        file_uuid = str(uuid.uuid4())
        cname = classify_file_type_from_filename(name)
        try:
            ftype = FileType(cname)
        except ValueError:
            ftype = FileType.OTHER

        storage_path = self._get_storage_path(ftype.value, name, file_uuid)
        resolved_storage_path = self.resolve_path(storage_path)

        async with aiofiles.open(resolved_storage_path, "wb") as f:
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
                owner_id=owner_id,
                result_id=None,
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)

            tags, tag_color = await self._get_tags_for_file(session, orm.id)
            rel_path = orm.storage_path.replace("\\", "/")
            out = {
                "id": orm.id,
                "name": orm.filename,
                "size": orm.size_bytes,
                "type": orm.file_type.value,
                "uploadDate": orm.uploaded_at.isoformat() + "Z",
                "updatedAt": (orm.updated_at or orm.uploaded_at).isoformat() + "Z",
                "checksum": orm.checksum_sha256,
                "path": rel_path,
                "ownerId": orm.owner_id,
                "visibility": "public",
                "tags": tags,
                "tagColor": tag_color,
            }
            if existing_by_name:
                out["duplicateByName"] = True
            return out

    async def list_files(self, set_id: Optional[str] = None) -> List[dict]:
        """List all files in library."""
        async with async_session() as session:
            q = select(FileORM).order_by(FileORM.uploaded_at.desc())
            result = await session.execute(q)
            files = result.scalars().all()
            out = []
            for f in files:
                tags, tag_color = await self._get_tags_for_file(session, f.id)
                rel_path = f.storage_path.replace("\\", "/")
                out.append({
                    "id": f.id,
                    "name": f.filename,
                    "size": f.size_bytes,
                    "type": f.file_type.value,
                    "uploadDate": f.uploaded_at.isoformat() + "Z",
                    "updatedAt": (f.updated_at or f.uploaded_at).isoformat() + "Z",
                    "checksum": f.checksum_sha256,
                    "path": rel_path,
                    "ownerId": f.owner_id,
                    "visibility": "public",
                    "tags": tags,
                    "tagColor": tag_color,
                })
            return out

    async def update_file_library_tags(self, file_id: str, raw: dict) -> bool:
        """Patch centralized tags and color for a library file."""
        allowed_colors = {
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
                # 1. Clean existing tags map for this file
                await session.execute(
                    delete(TagMapORM).where(
                        and_(
                            TagMapORM.entity_id == file_id,
                            TagMapORM.entity_type == "FILE"
                        )
                    )
                )

                # 2. Parse and assign new tags
                raw_tags = normalize_comma_separated_tags(raw.get("tags"))
                if raw_tags:
                    tag_list = [t.strip() for t in raw_tags.split(",") if t.strip()]
                    color = (raw.get("tagColor") or "sky").strip()
                    if color not in allowed_colors:
                        color = "sky"

                    for tag_name in tag_list:
                        # Find or create tag
                        t_q = select(TagORM).where(TagORM.name == tag_name)
                        t_res = await session.execute(t_q)
                        tag_orm = t_res.scalar_one_or_none()
                        if not tag_orm:
                            tag_orm = TagORM(
                                id=str(uuid.uuid4()),
                                name=tag_name,
                                tag_color=color,
                                created_at=datetime.utcnow()
                            )
                            session.add(tag_orm)
                            await session.flush()
                        else:
                            # Update tag color if modified
                            tag_orm.tag_color = color

                        # Map to file
                        mapping = TagMapORM(
                            tag_id=tag_orm.id,
                            entity_id=file_id,
                            entity_type="FILE",
                            created_at=datetime.utcnow()
                        )
                        session.add(mapping)

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
            tags, tag_color = await self._get_tags_for_file(session, f.id)
            rel_path = f.storage_path.replace("\\", "/")
            return {
                "id": f.id,
                "name": f.filename,
                "size": f.size_bytes,
                "type": f.file_type.value,
                "uploadDate": f.uploaded_at.isoformat() + "Z",
                "updatedAt": (f.updated_at or f.uploaded_at).isoformat() + "Z",
                "path": rel_path,
                "checksum": f.checksum_sha256,
                "ownerId": f.owner_id,
                "visibility": "public",
                "tags": tags,
                "tagColor": tag_color,
            }

    async def delete_file(self, file_id: str) -> bool:
        """Delete file from DB and Disk."""
        async with async_session() as session:
            result = await session.execute(select(FileORM).where(FileORM.id == file_id))
            f = result.scalar_one_or_none()
            if not f:
                return False
                
            storage_path = f.storage_path
            resolved_path = self.resolve_path(storage_path)

            # Clear tags map
            await session.execute(
                delete(TagMapORM).where(
                    and_(
                        TagMapORM.entity_id == file_id,
                        TagMapORM.entity_type == "FILE"
                    )
                )
            )

            await session.delete(f)
            await session.commit()
            
            # Remove from disk
            if os.path.exists(resolved_path):
                try:
                    os.remove(resolved_path)
                except OSError:
                    pass
            return True

    async def get_file_content(self, file_id: str) -> Optional[bytes]:
        """Read file content from disk."""
        rec = await self.get_file(file_id)
        if not rec or not rec.get("path"):
            return None
        path = self.resolve_path(rec["path"])
        if not os.path.exists(path):
            return None
        async with aiofiles.open(path, "rb") as f:
            return await f.read()

    async def verify_file_checksum(self, file_id: str) -> bool:
        """Verify that file on disk still matches stored checksum."""
        rec = await self.get_file(file_id)
        if not rec or not rec.get("path"):
            return False
        stored = rec.get("checksum")
        if not stored:
            return True
        path = self.resolve_path(rec["path"])
        if not os.path.exists(path):
            return False
        current = await self.calculate_checksum(path)
        return current == stored

    # ========== Manual Cleanup Candidates Registry ==========

    async def get_deletion_candidates(self) -> List[dict]:
        """List all pending deletion candidates."""
        async with async_session() as session:
            q = select(DeletionCandidateORM).order_by(DeletionCandidateORM.marked_at.desc())
            result = await session.execute(q)
            rows = result.scalars().all()
            return [
                {
                    "id": r.id,
                    "file_id": r.file_id,
                    "filename": r.filename,
                    "storage_path": r.storage_path,
                    "checksum": r.checksum_sha256,
                    "size": r.size_bytes,
                    "markedAt": r.marked_at.isoformat() + "Z",
                    "reason": r.reason
                }
                for r in rows
            ]

    async def scan_orphaned_files(self) -> dict:
        """Scan upload storage for disk files that are not registered in the files table."""
        base_abs = self.resolve_path(self.base_path)
        if not base_abs or not os.path.isdir(base_abs):
            return {"scanned": 0, "registered": 0, "candidates": []}

        cwd_abs = os.path.abspath(os.getcwd())

        def normalize(path: str) -> str:
            return path.replace("\\", "/").rstrip("/")

        def storage_path_for(abs_path: str) -> str:
            abs_norm = os.path.abspath(abs_path)
            try:
                if os.path.commonpath([cwd_abs, abs_norm]) == cwd_abs:
                    return normalize(os.path.relpath(abs_norm, cwd_abs))
            except ValueError:
                pass
            return normalize(abs_norm)

        async with async_session() as session:
            registered_result = await session.execute(select(FileORM.storage_path))
            registered_paths = set()
            for row in registered_result.all():
                raw_path = row[0]
                if not raw_path:
                    continue
                registered_paths.add(normalize(raw_path))
                registered_paths.add(normalize(self.resolve_path(raw_path)))

            pending_result = await session.execute(select(DeletionCandidateORM.storage_path))
            pending_paths = {normalize(row[0]) for row in pending_result.all() if row[0]}

        scanned = 0
        registered = 0
        candidates = []
        for dirpath, _, filenames in os.walk(base_abs):
            for filename in filenames:
                abs_path = os.path.join(dirpath, filename)
                scanned += 1
                candidate_storage_path = storage_path_for(abs_path)
                normalized_abs_path = normalize(os.path.abspath(abs_path))
                if candidate_storage_path in registered_paths or normalized_abs_path in registered_paths:
                    continue
                if candidate_storage_path in pending_paths or normalized_abs_path in pending_paths:
                    continue

                size_bytes = os.path.getsize(abs_path)
                checksum = await self.calculate_checksum(abs_path)
                candidate = await self.register_deletion_candidate(
                    filename=filename,
                    storage_path=candidate_storage_path,
                    checksum=checksum,
                    size_bytes=size_bytes,
                    reason="orphan_disk_file",
                    file_id=None,
                )
                candidates.append(candidate)
                pending_paths.add(candidate_storage_path)
                registered += 1

        return {"scanned": scanned, "registered": registered, "candidates": candidates}

    async def get_deletion_candidates_raw(self) -> List[dict]:
        """Minimal candidate dicts (id, file_id, filename, storage_path, reason)."""
        async with async_session() as session:
            result = await session.execute(select(DeletionCandidateORM))
            return [
                {
                    "id": r.id,
                    "file_id": r.file_id,
                    "filename": r.filename,
                    "storage_path": r.storage_path,
                    "reason": r.reason,
                }
                for r in result.scalars().all()
            ]

    async def get_deletion_candidate(self, candidate_id: str) -> Optional[dict]:
        """Fetch a single candidate by id (or None)."""
        async with async_session() as session:
            result = await session.execute(
                select(DeletionCandidateORM).where(DeletionCandidateORM.id == candidate_id)
            )
            r = result.scalar_one_or_none()
            if not r:
                return None
            return {
                "id": r.id,
                "file_id": r.file_id,
                "filename": r.filename,
                "storage_path": r.storage_path,
                "reason": r.reason,
            }

    async def scan_missing_files(self) -> dict:
        """Stage DB file records whose backing disk file is missing.

        reason='missing_disk_file', file_id set to the record id. Skips records
        already staged (matched by storage_path, like scan_orphaned_files).
        """
        async with async_session() as session:
            files_result = await session.execute(select(FileORM))
            files = files_result.scalars().all()
            pending_result = await session.execute(select(DeletionCandidateORM.storage_path))
            pending_paths = {row[0] for row in pending_result.all() if row[0]}

        scanned = 0
        registered = 0
        candidates: List[dict] = []
        for f in files:
            scanned += 1
            if f.storage_path in pending_paths:
                continue
            resolved = self.resolve_path(f.storage_path)
            if resolved and os.path.exists(resolved):
                continue
            candidate = await self.register_deletion_candidate(
                filename=f.filename,
                storage_path=f.storage_path,
                checksum=f.checksum_sha256 or "",
                size_bytes=f.size_bytes or 0,
                reason="missing_disk_file",
                file_id=f.id,
            )
            candidates.append(candidate)
            pending_paths.add(f.storage_path)
            registered += 1
        return {"scanned": scanned, "registered": registered, "candidates": candidates}

    async def stage_unreferenced_files(self, referenced_ids: set) -> dict:
        """Stage library files (VCD/EROM/ULP) not in referenced_ids.

        reason='unreferenced_file', file_id set. Skips files already staged.
        """
        library_types = {"VCD", "EROM", "ULP"}
        async with async_session() as session:
            files_result = await session.execute(select(FileORM))
            files = files_result.scalars().all()
            pending_result = await session.execute(select(DeletionCandidateORM.storage_path))
            pending_paths = {row[0] for row in pending_result.all() if row[0]}

        scanned = 0
        registered = 0
        candidates: List[dict] = []
        for f in files:
            type_name = f.file_type.value if hasattr(f.file_type, "value") else str(f.file_type)
            if type_name.upper() not in library_types:
                continue
            scanned += 1
            if f.id in referenced_ids:
                continue
            if f.storage_path in pending_paths:
                continue
            candidate = await self.register_deletion_candidate(
                filename=f.filename,
                storage_path=f.storage_path,
                checksum=f.checksum_sha256 or "",
                size_bytes=f.size_bytes or 0,
                reason="unreferenced_file",
                file_id=f.id,
            )
            candidates.append(candidate)
            pending_paths.add(f.storage_path)
            registered += 1
        return {"scanned": scanned, "registered": registered, "candidates": candidates}

    async def register_deletion_candidate(
        self,
        filename: str,
        storage_path: str,
        checksum: str,
        size_bytes: int,
        reason: str,
        file_id: Optional[str] = None
    ) -> dict:
        """Add a candidate to the manual deletion queue."""
        async with async_session() as session:
            # Check if already registered
            q = select(DeletionCandidateORM).where(DeletionCandidateORM.storage_path == storage_path)
            res = await session.execute(q)
            existing = res.scalar_one_or_none()
            if existing:
                return {
                    "id": existing.id,
                    "filename": existing.filename,
                    "storage_path": existing.storage_path,
                    "reason": existing.reason
                }

            orm = DeletionCandidateORM(
                id=str(uuid.uuid4()),
                file_id=file_id,
                filename=filename,
                storage_path=storage_path,
                checksum_sha256=checksum,
                size_bytes=size_bytes,
                marked_at=datetime.utcnow(),
                reason=reason
            )
            session.add(orm)
            await session.commit()
            return {
                "id": orm.id,
                "filename": orm.filename,
                "storage_path": orm.storage_path,
                "reason": orm.reason
            }

    async def approve_deletion(self, candidate_id: str) -> bool:
        """Confirm deletion: delete from disk, purge file record, and remove candidate registry entry."""
        async with async_session() as session:
            result = await session.execute(select(DeletionCandidateORM).where(DeletionCandidateORM.id == candidate_id))
            candidate = result.scalar_one_or_none()
            if not candidate:
                return False

            storage_path = candidate.storage_path
            file_id = candidate.file_id

            # 1. Purge Candidate Row
            await session.delete(candidate)
            await session.commit()

        # 2. If it is registered in Files table, delete it
        if file_id:
            await self.delete_file(file_id)
        else:
            # Delete physically from disk if orphan-disk candidate
            resolved = self.resolve_path(storage_path)
            if os.path.exists(resolved):
                try:
                    os.remove(resolved)
                except OSError:
                    pass

        return True

    # ========== Legacy set-file copies (stubs for backwards compatibility) ==========
    async def delete_files_by_set_id(self, set_id: str) -> int:
        return 0

    async def save_set_files(self, set_id: str, file_ids: List[str]) -> List[dict]:
        return []

    async def list_set_files(self, set_id: str) -> List[dict]:
        return []

    async def restore_set_files_to_library(self, set_id: str) -> List[dict]:
        return []

file_store = FileStore()
