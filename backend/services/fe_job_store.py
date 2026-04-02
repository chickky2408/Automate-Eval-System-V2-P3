"""
In-memory store for frontend-specific job metadata and file lists.
This augments the persisted job queue with UI-required fields.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional
import itertools
import uuid


@dataclass
class JobFile:
    id: int
    name: str
    status: str
    result: Optional[str]
    order: int
    vcd: Optional[str] = None  # VCD file name
    erom: Optional[str] = None  # ERoM (BIN) file name
    ulp: Optional[str] = None   # ULP (LIN) file name
    try_count: Optional[int] = None  # Number of test rounds
    test_case_name: Optional[str] = None  # Display name (e.g. from set)


class FEJobStore:
    """Stores extra job metadata required by the frontend."""

    def __init__(self) -> None:
        self._meta: Dict[str, dict] = {}
        self._file_id = itertools.count(1)

    def _new_file(
        self,
        name: str,
        order: int,
        vcd: Optional[str] = None,
        erom: Optional[str] = None,
        ulp: Optional[str] = None,
        try_count: Optional[int] = None,
        test_case_name: Optional[str] = None,
    ) -> JobFile:
        return JobFile(
            id=next(self._file_id),
            name=name,
            status="pending",
            result=None,
            order=order,
            vcd=vcd,
            erom=erom,
            ulp=ulp,
            try_count=try_count,
            test_case_name=test_case_name,
        )

    def create_from_payload(
        self,
        job_id: str,
        *,
        tag: Optional[str],
        firmware: Optional[str],
        boards: Optional[List[str]],
        files: Optional[List[dict]],
        client_id: Optional[str],
        profile_id: Optional[str] = None,
        config_name: Optional[str],
        default_file_name: Optional[str] = None,
        tag_color: Optional[str] = None,
        tags: Optional[List[dict]] = None,
    ) -> dict:
        payload_files = files or []
        job_files: List[JobFile] = []
        for idx, file_info in enumerate(payload_files):
            order = file_info.get("order") or (idx + 1)
            file_name = file_info.get("name", f"file_{order}.vcd")
            vcd = file_info.get("vcd") if isinstance(file_info, dict) else None
            erom = file_info.get("erom") if isinstance(file_info, dict) else None
            ulp = file_info.get("ulp") if isinstance(file_info, dict) else None
            try_count = file_info.get("try_count") or file_info.get("try", 1) if isinstance(file_info, dict) else None
            test_case_name = file_info.get("testCaseName") if isinstance(file_info, dict) else None
            job_file = self._new_file(
                file_name, order, vcd=vcd, erom=erom, ulp=ulp, try_count=try_count, test_case_name=test_case_name
            )
            job_files.append(job_file)

        if not job_files:
            fallback_name = default_file_name or f"{job_id}.vcd"
            job_files.append(self._new_file(fallback_name, 1))

        normalized_tags = []
        if isinstance(tags, list):
            for t in tags:
                if not isinstance(t, dict):
                    continue
                name = (t.get("tag") or t.get("name") or "").strip()
                if not name:
                    continue
                color = (t.get("tagColor") or t.get("color") or "").strip() or None
                normalized_tags.append({"tag": name, "tagColor": color})
        if not normalized_tags and tag:
            normalized_tags = [{"tag": tag, "tagColor": tag_color or None}]

        meta = {
            "tag": tag,
            "clientId": client_id or f"client_{uuid.uuid4().hex[:6]}",
            "firmware": firmware or "",
            "boards": boards or [],
            "files": job_files,
            "configName": config_name,
            "tags": normalized_tags,
        }
        if profile_id:
            meta["profileId"] = profile_id
        if tag_color:
            meta["tagColor"] = tag_color
        self._meta[job_id] = meta
        return meta
    
    def save_pairs_data(self, job_id: str, pairs_data: List[dict]) -> bool:
        """Save pairs data (pair table history) for editing later."""
        meta = self._meta.get(job_id)
        if not meta:
            return False
        meta["pairsData"] = pairs_data  # เก็บ pairs data สำหรับ edit
        return True
    
    def get_pairs_data(self, job_id: str) -> Optional[List[dict]]:
        """Get pairs data (pair table history) for editing."""
        meta = self._meta.get(job_id)
        if not meta:
            return None
        return meta.get("pairsData")

    def ensure_meta(
        self,
        job_id: str,
        *,
        tag: Optional[str] = None,
        firmware: Optional[str] = None,
        boards: Optional[List[str]] = None,
        default_file_name: Optional[str] = None,
        pairs_data: Optional[List[dict]] = None,
    ) -> dict:
        """Ensure meta exists. Restore from pairs_data (DB) when store is empty after restart."""
        if job_id in self._meta:
            return self._meta[job_id]

        # Restore files from pairs_data when available (e.g. after server restart)
        if pairs_data and isinstance(pairs_data, list):
            files_from_pairs = []
            for idx, p in enumerate(pairs_data):
                vcd = (p.get("vcdName") or p.get("vcd") or "").strip()
                erom = (p.get("binName") or p.get("erom") or "").strip()
                ulp = (p.get("linName") or p.get("ulp") or "").strip() or None
                tc_name = (p.get("testCaseName") or "").strip() or None
                name = vcd or f"file_{idx + 1}.vcd"
                files_from_pairs.append({
                    "name": name,
                    "order": idx + 1,
                    "vcd": vcd or None,
                    "erom": erom or None,
                    "ulp": ulp,
                    "try_count": p.get("try") or p.get("try_count") or 1,
                    "testCaseName": tc_name,
                })
            if files_from_pairs:
                meta = self.create_from_payload(
                    job_id,
                    tag=tag,
                    firmware=firmware or "",
                    boards=boards or [],
                    files=files_from_pairs,
                    client_id=None,
                    profile_id=None,
                    config_name=None,
                    default_file_name=default_file_name,
                )
                self.save_pairs_data(job_id, pairs_data)
                return meta

        return self.create_from_payload(
            job_id,
            tag=tag,
            firmware=firmware,
            boards=boards,
            files=None,
            client_id=None,
            profile_id=None,
            config_name=None,
            default_file_name=default_file_name,
        )

    def get_meta(self, job_id: str) -> Optional[dict]:
        return self._meta.get(job_id)

    def remove_job(self, job_id: str) -> bool:
        """Drop in-memory FE metadata and file list for a job (e.g. after delete)."""
        if job_id not in self._meta:
            return False
        del self._meta[job_id]
        return True

    def update_tag(self, job_id: str, tag: Optional[str]) -> bool:
        meta = self._meta.get(job_id)
        if not meta:
            return False
        meta["tag"] = tag
        return True

    def apply_tag_patch(self, job_id: str, patch: dict) -> bool:
        """Merge tag / tagColor / tags into FE meta (keys: tag, tagColor, tags)."""
        meta = self._meta.get(job_id)
        if not meta:
            return False
        if "tag" in patch:
            meta["tag"] = patch["tag"]
        if "tagColor" in patch:
            meta["tagColor"] = patch["tagColor"] or None
        if "tags" in patch:
            tags = patch.get("tags") or []
            normalized = []
            if isinstance(tags, list):
                for t in tags:
                    if not isinstance(t, dict):
                        continue
                    name = (t.get("tag") or t.get("name") or "").strip()
                    if not name:
                        continue
                    color = (t.get("tagColor") or t.get("color") or "").strip() or None
                    normalized.append({"tag": name, "tagColor": color})
            meta["tags"] = normalized
        return True

    def list_files(self, job_id: str) -> List[JobFile]:
        meta = self._meta.get(job_id)
        if not meta:
            return []
        return list(meta.get("files", []))

    def update_file(self, job_id: str, file_id: int, **updates) -> Optional[JobFile]:
        meta = self._meta.get(job_id)
        if not meta:
            return None
        for file_item in meta.get("files", []):
            if file_item.id == file_id:
                for key, value in updates.items():
                    if hasattr(file_item, key):
                        setattr(file_item, key, value)
                return file_item
        return None

    def move_file(self, job_id: str, file_id: int, direction: str) -> List[JobFile]:
        meta = self._meta.get(job_id)
        if not meta:
            return []
        files = sorted(meta.get("files", []), key=lambda f: f.order)
        index = next((i for i, f in enumerate(files) if f.id == file_id), None)
        if index is None:
            return files

        if direction == "up" and index > 0:
            files[index - 1].order, files[index].order = files[index].order, files[index - 1].order
        elif direction == "down" and index < len(files) - 1:
            files[index + 1].order, files[index].order = files[index].order, files[index + 1].order

        meta["files"] = files
        return files

    def sync_files_for_status(self, job_id: str, status: str) -> List[JobFile]:
        files = self.list_files(job_id)
        if not files:
            return files

        if status == "completed":
            for file_item in files:
                file_item.status = "completed"
                if file_item.result is None:
                    file_item.result = "pass"
            return files

        if status == "stopped":
            for file_item in files:
                if file_item.status in {"running", "pending"}:
                    file_item.status = "stopped"
            return files

        if status == "running":
            if not any(f.status == "running" for f in files):
                for file_item in files:
                    if file_item.status == "pending":
                        file_item.status = "running"
                        break
        return files


fe_job_store = FEJobStore()
