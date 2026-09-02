"""Job queue API endpoints."""
from __future__ import annotations

import asyncio
import random
import time

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from pydantic import BaseModel
from typing import Dict, List, Optional
from datetime import datetime
import os
import uuid

from models.job import JobCreate, JobState
from services.job_queue import job_queue_service
from services.fe_job_store import fe_job_store
from services.board_manager import board_manager
from services.file_store import file_store
from services.profile_lookup import batch_profile_names_by_ids

router = APIRouter()
_job_sim_tasks: Dict[str, asyncio.Task] = {}
_job_sim_runtime: Dict[str, dict] = {}
STRICT_FILE_CHECKSUM_ON_START = os.getenv("STRICT_FILE_CHECKSUM_ON_START", "0").strip().lower() in {"1", "true", "yes", "on"}

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


class JobFileCreate(BaseModel):
    name: str
    order: Optional[int] = None
    vcd: Optional[str] = None  # VCD file name
    erom: Optional[str] = None  # ERoM (BIN) file name
    ulp: Optional[str] = None   # ULP (LIN) file name
    try_count: Optional[int] = None   # Number of test rounds
    testCaseName: Optional[str] = None  # Display name for test case (e.g. from set)


class JobCreatePayload(BaseModel):
    name: str
    tag: Optional[str] = None
    tagColor: Optional[str] = None
    tags: Optional[List[dict]] = None
    firmware: Optional[str] = None
    boards: Optional[List[str]] = None
    files: Optional[List[JobFileCreate]] = None
    configName: Optional[str] = None
    clientId: Optional[str] = None
    profileId: Optional[str] = None
    profileDisplayName: Optional[str] = None  # snapshot at create/update (shown as Owner for all viewers)
    pairsData: Optional[List[dict]] = None  # เก็บ pairs data สำหรับ edit batch
    saveAsDraft: bool = False  # ถ้า True → สร้าง job ด้วย state=draft โดยไม่รันทันที


class JobTagUpdate(BaseModel):
    tag: Optional[str] = None
    tagColor: Optional[str] = None
    tags: Optional[List[dict]] = None


class FileMoveRequest(BaseModel):
    direction: str


class RunCommandPayload(BaseModel):
    name: Optional[str] = None
    command: str
    tag: Optional[str] = None
    boards: Optional[List[str]] = None
    configName: Optional[str] = None
    firmware: Optional[str] = None
    clientId: Optional[str] = None
    profileId: Optional[str] = None
    profileDisplayName: Optional[str] = None


def _model_to_dict(item: BaseModel) -> dict:
    if hasattr(item, "model_dump"):
        return item.model_dump()
    return item.dict()


def _library_name_to_id_prefer_newest(library_files: List[dict]) -> Dict[str, str]:
    """Map filename -> library file id when the same name exists more than once.

    ``file_store.list_files()`` returns rows ordered by ``uploaded_at DESC`` (newest first).
    A plain dict comprehension overwrites keys so the *last* row wins — that is the *oldest*
    duplicate, which breaks checksum checks after re-uploading the same filename.
    We keep the first occurrence of each name (newest upload).
    """
    out: Dict[str, str] = {}
    for f in library_files or []:
        n = f.get("name")
        tid = f.get("id")
        if n is None or tid is None:
            continue
        ns = str(n).strip()
        if not ns:
            continue
        if ns not in out:
            out[ns] = str(tid)
    return out


def _resolve_job_file_ids(file_payloads: List[dict], fallback_firmware: Optional[str], library_files: List[dict]) -> tuple[Optional[str], Optional[str], str, str]:
    name_to_id = _library_name_to_id_prefer_newest(library_files)
    first_name = file_payloads[0]["name"] if file_payloads else ""
    fw_name = fallback_firmware or ""
    vcd_id = name_to_id.get(first_name) or None
    fw_id = name_to_id.get(fw_name) or None
    return vcd_id, fw_id, first_name, fw_name


def _map_job_state(state: JobState) -> str:
    if state == JobState.DRAFT:
        return "draft"
    if state == JobState.PENDING:
        return "pending"
    if state in {JobState.CONFIGURING, JobState.FLASHING, JobState.RUNNING}:
        return "running"
    if state == JobState.COMPLETED:
        return "completed"
    return "stopped"


def _to_iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    return dt.isoformat() + "Z"


def _file_is_error(file_item) -> bool:
    status = str(getattr(file_item, "status", "") or "").lower()
    result = str(getattr(file_item, "result", "") or "").lower()
    return status == "error" or result == "fail"


def _pick_file_duration_seconds(total_files: int) -> float:
    # Roughly target ~30s total run with jitter, clamped for UX.
    per_file = 30.0 / max(1, total_files)
    jitter = random.uniform(0.75, 1.35)
    return max(2.5, min(12.0, per_file * jitter))


async def _cancel_job_simulation(job_id: str):
    task = _job_sim_tasks.pop(job_id, None)
    _job_sim_runtime.pop(job_id, None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def _ensure_job_simulation(job_id: str):
    existing = _job_sim_tasks.get(job_id)
    if existing and not existing.done():
        return
    task = asyncio.create_task(_simulate_job(job_id))
    _job_sim_tasks[job_id] = task


async def _start_job_internal(job_id: str):
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    job_state = _map_job_state(job.status.state)

    # Draft jobs are valid to start — they are simply promoted to pending.
    # Treat draft the same as "stopped" for the purposes of checksum validation
    # (skip verify so draft->start is fast; pending/running jobs are always verified).

    meta = fe_job_store.ensure_meta(
        job.id,
        default_file_name=getattr(job, "vcd_filename", None),
        pairs_data=getattr(job, "pairs_data", None),
    )
    job_files = fe_job_store.list_files(job.id)
    file_names = set()
    for f in job_files:
        # Validate only files that are about to run now.
        f_status = str(getattr(f, "status", "") or "").lower()
        if f_status not in {"pending", "running"}:
            continue
        if getattr(f, "vcd", None):
            file_names.add(f.vcd)
        if getattr(f, "erom", None):
            file_names.add(f.erom)
        if getattr(f, "ulp", None):
            file_names.add(f.ulp)

    modified = []
    should_verify_checksums = job_state not in {"stopped", "draft"}
    if file_names and should_verify_checksums:
        library = await file_store.list_files(set_id=None)
        name_to_id = _library_name_to_id_prefer_newest(library)
        for name in file_names:
            fid = name_to_id.get(name)
            if fid and not await file_store.verify_file_checksum(fid):
                modified.append(name)
        if modified and STRICT_FILE_CHECKSUM_ON_START:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "FILE_MODIFIED",
                    "message": "One or more files were modified after upload. Re-upload or restore files before running.",
                    "files": modified,
                },
            )

    # If the real queue processor is active, let it handle the queue!
    if job_queue_service._running:
        from db.database import async_session
        from sqlalchemy import update
        from db.orm_models import JobORM, JobTargetORM, ResultORM
        async with async_session() as session:
            # Set job status to pending
            await session.execute(
                update(JobORM).where(JobORM.id == job_id).values(
                    state="pending",
                    progress=0,
                    current_step="Pending in queue",
                    started_at=None,
                    completed_at=None,
                    error_message=None
                )
            )
            # Set job targets to pending
            await session.execute(
                update(JobTargetORM).where(JobTargetORM.job_id == job_id).values(
                    status="pending",
                    started_at=None,
                    completed_at=None
                )
            )
            # Reset all results to pending so they run again
            await session.execute(
                update(ResultORM).where(ResultORM.job_id == job_id).values(
                    status="pending",
                    passed=None,
                    error_message=None,
                    started_at=None,
                    completed_at=None
                )
            )
            await session.commit()
        fe_job_store.sync_files_for_status(job_id, "pending")
        return {"success": True, "message": "Job queued in active processing queue"}

    assigned_board_id = None
    boards_for_meta: List[str] = list(meta.get("boards") or [])
    if not boards_for_meta:
        b = await board_manager.get_available_board(target_board_id=getattr(job, "target_board_id", None))
        if b is not None:
            assigned_board_id = b.id
            meta["boards"] = [b.name or b.id]
            await board_manager.set_board_busy(b.id, job.id)

    await job_queue_service.update_job_status(
        job_id,
        JobState.RUNNING,
        progress=0,
        started_at=datetime.utcnow(),
        assigned_board_id=assigned_board_id,
    )
    fe_job_store.sync_files_for_status(job_id, "running")
    await _ensure_job_simulation(job_id)
    return {"success": True, "message": "Job started"}


async def _autostart_next_pending():
    if job_queue_service._running:
        return False
    jobs = await job_queue_service.get_all_jobs()
    if any(_map_job_state(j.status.state) == "running" for j in jobs):
        return False
    next_pending = next((j for j in jobs if _map_job_state(j.status.state) == "pending"), None)
    if not next_pending:
        return False
    await _start_job_internal(next_pending.id)
    return True


async def _simulate_job(job_id: str):
    try:
        while True:
            job = await job_queue_service.get_job(job_id)
            if not job:
                break
            if _map_job_state(job.status.state) != "running":
                break

            files = sorted(fe_job_store.list_files(job_id), key=lambda f: f.order)
            if not files:
                break

            runtime = _job_sim_runtime.setdefault(job_id, {"running": {}})
            running_meta: Dict[int, dict] = runtime["running"]

            # Clean stale runtime slots (e.g. file stopped/deleted while ticking).
            for fid in list(running_meta.keys()):
                file_item = next((f for f in files if f.id == fid), None)
                if not file_item or str(file_item.status).lower() != "running":
                    running_meta.pop(fid, None)

            running_files = [f for f in files if str(f.status).lower() == "running"]
            pending_files = [f for f in files if str(f.status).lower() == "pending"]

            if not running_files and pending_files:
                next_file = pending_files[0]
                fe_job_store.update_file(job_id, next_file.id, status="running")
                running_files = [next_file]
                running_meta[next_file.id] = {
                    "started_at": time.monotonic(),
                    "duration": _pick_file_duration_seconds(len(files)),
                }

            # Finalize job if no remaining executable files.
            if not running_files and not pending_files:
                any_error = any(_file_is_error(f) for f in files)
                any_stopped = any(str(f.status).lower() == "stopped" for f in files)
                done_count = sum(1 for f in files if str(f.status).lower() == "completed")
                progress = 100 if files else 0
                end_state = JobState.CANCELLED if any_stopped and done_count == 0 else JobState.COMPLETED
                await job_queue_service.update_job_status(
                    job_id,
                    end_state,
                    progress=progress,
                    current_step="Stopped" if end_state == JobState.CANCELLED else ("Completed with errors" if any_error else "Completed"),
                    completed_at=datetime.utcnow(),
                )
                if end_state == JobState.COMPLETED:
                    await _autostart_next_pending()
                break

            changed = False
            now_mono = time.monotonic()

            for file_item in list(running_files):
                slot = running_meta.get(file_item.id)
                if not slot:
                    slot = {
                        "started_at": now_mono,
                        "duration": _pick_file_duration_seconds(len(files)),
                    }
                    running_meta[file_item.id] = slot
                if now_mono - slot["started_at"] < float(slot["duration"]):
                    continue

                # Randomize pass/fail to mimic real-world execution variance.
                failed = random.random() < 0.2
                fe_job_store.update_file(
                    job_id,
                    file_item.id,
                    status="completed",
                    result="fail" if failed else "pass",
                )
                running_meta.pop(file_item.id, None)
                changed = True

            if changed:
                files_after = fe_job_store.list_files(job_id)
                completed_count = sum(1 for f in files_after if str(f.status).lower() == "completed")
                progress = int((completed_count / max(1, len(files_after))) * 100)
                await job_queue_service.update_job_status(
                    job_id,
                    JobState.RUNNING,
                    progress=progress,
                    current_step=f"Executing {completed_count}/{len(files_after)}",
                )

            await asyncio.sleep(0.5)
    except asyncio.CancelledError:
        raise
    finally:
        _job_sim_tasks.pop(job_id, None)
        _job_sim_runtime.pop(job_id, None)


def _collect_job_board_ids(job) -> List[str]:
    """IDs to show when meta.boards is empty: assigned, explicit target, and broadcast targets."""
    ids: List[str] = []
    aid = getattr(job, "assigned_board_id", None)
    if aid:
        ids.append(str(aid))
    tid = getattr(job, "target_board_id", None)
    if tid:
        ids.append(str(tid))
    raw_list = getattr(job, "target_board_ids", None) or []
    if isinstance(raw_list, list):
        for x in raw_list:
            if x:
                ids.append(str(x))
    seen = set()
    out: List[str] = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


async def _resolve_boards(job, meta: dict) -> List[str]:
    boards = list(meta.get("boards") or [])
    if boards:
        return boards

    resolved: List[str] = []
    for board_id in _collect_job_board_ids(job):
        board = await board_manager.get_board(board_id)
        resolved.append(board.name if board else board_id)
    return resolved


def _serialize_files(files) -> List[dict]:
    return [
        {
            "id": file_item.id,
            "name": file_item.name,
            "status": file_item.status,
            "result": file_item.result,
            "order": file_item.order,
            "vcd": getattr(file_item, "vcd", None),  # VCD file name
            "erom": getattr(file_item, "erom", None),  # ERoM (BIN) file name
            "ulp": getattr(file_item, "ulp", None),   # ULP (LIN) file name
            "try_count": getattr(file_item, "try_count", None),  # Number of test rounds
            "testCaseName": getattr(file_item, "test_case_name", None),  # Display name from set
        }
        for file_item in sorted(files, key=lambda f: f.order)
    ]


def _resolve_display_name_from_ids(job, file_name_map: Dict[str, str]) -> tuple[str, str]:
    vcd = (file_name_map.get(str(getattr(job, "vcd_file_id", "") or "")) or "").strip()
    fw = (file_name_map.get(str(getattr(job, "firmware_file_id", "") or "")) or "").strip()
    return vcd, fw


async def _build_fe_job(job, profile_name_map: Optional[Dict[str, str]] = None, file_name_map: Optional[Dict[str, str]] = None) -> dict:
    if file_name_map is None:
        lib = await file_store.list_files(set_id=None)
        file_name_map = {str(f.get("id")): str(f.get("name") or "") for f in (lib or [])}
    vcd_display, fw_display = _resolve_display_name_from_ids(job, file_name_map)
    meta = fe_job_store.ensure_meta(
        job.id,
        firmware=fw_display or None,
        default_file_name=vcd_display or None,
        pairs_data=getattr(job, "pairs_data", None),  # Restore from DB after restart
    )
    # ORM tag/tag_color are persisted; in-memory meta often has tag=None from create_from_payload.
    # setdefault() does NOT override None — merge explicitly so list_jobs returns tags after restart.
    orm_tag = (getattr(job, "tag", None) or "").strip() or None
    if orm_tag and not (meta.get("tag") or "").strip():
        meta["tag"] = orm_tag
    orm_tc = (getattr(job, "tag_color", None) or "").strip() or None
    if orm_tc and not (meta.get("tagColor") or "").strip():
        meta["tagColor"] = orm_tc
    # Rebuild tags[] for FE when only legacy DB columns exist (multi-tag JSON is not on ORM).
    tags_meta = meta.get("tags")
    if orm_tag and (not isinstance(tags_meta, list) or len(tags_meta) == 0):
        meta["tags"] = [{"tag": orm_tag, "tagColor": orm_tc or None}]
    if job.client_id:
        meta["clientId"] = job.client_id
    pid = getattr(job, "profile_id", None)
    if pid:
        meta["profileId"] = pid
    pid = meta.get("profileId") or getattr(job, "profile_id", None)
    snapshot = (getattr(job, "profile_display_name", None) or "").strip() or None
    profile_name = snapshot
    if not profile_name and pid:
        if profile_name_map is not None:
            profile_name = profile_name_map.get(pid)
        else:
            profile_name = (await batch_profile_names_by_ids({pid})).get(pid)
    status = _map_job_state(job.status.state)
    files = fe_job_store.sync_files_for_status(job.id, status)
    completed_files = sum(1 for f in files if f.status == "completed")
    boards = await _resolve_boards(job, meta)
    return {
        "id": job.id,
        "name": job.name,
        "progress": job.status.progress,
        "status": status,
        "tag": meta.get("tag"),
        "tagColor": meta.get("tagColor"),
        "tags": meta.get("tags") or [],
        "clientId": meta.get("clientId"),
        "profileId": meta.get("profileId"),
        "profileName": profile_name,
        "totalFiles": len(files),
        "completedFiles": completed_files,
        "firmware": meta.get("firmware") or fw_display or "",
        "boards": boards,
        "startedAt": _to_iso(job.started_at),
        "completedAt": _to_iso(job.completed_at),
        "files": _serialize_files(files),
    }


@router.get("")
async def list_jobs(
    status: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    clientId: Optional[str] = Query(None),
):
    """Get all jobs in the queue."""
    jobs = await job_queue_service.get_all_jobs()
    profile_ids = {getattr(j, "profile_id", None) for j in jobs if getattr(j, "profile_id", None)}
    name_map = await batch_profile_names_by_ids(profile_ids)
    file_map = {}
    for f in await file_store.list_files(set_id=None):
        file_map[str(f.get("id"))] = str(f.get("name") or "")
    payload = []
    for job in jobs:
        payload.append(await _build_fe_job(job, profile_name_map=name_map, file_name_map=file_map))

    if status:
        payload = [job for job in payload if job["status"] == status]
    if tag:
        payload = [job for job in payload if job.get("tag") == tag]
    if clientId:
        payload = [job for job in payload if job.get("clientId") == clientId]
    return payload


@router.get("/{job_id}")
async def get_job(job_id: str):
    """Get a specific job."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return await _build_fe_job(job)


@router.post("")
async def create_job(payload: JobCreatePayload):
    """Create a job using the frontend schema."""
    file_payloads = [_model_to_dict(file_item) for file_item in (payload.files or [])]
    library_files = await file_store.list_files(set_id=None)
    vcd_file_id, firmware_file_id, first_name, fw_name = _resolve_job_file_ids(file_payloads, payload.firmware, library_files)
    vcd_filename = first_name if first_name else f"{uuid.uuid4().hex}.vcd"
    tags_payload = payload.tags if isinstance(payload.tags, list) else None
    # keep DB tag fields synced with first tag when provided
    if tags_payload and isinstance(tags_payload[0], dict):
        first_tag = (tags_payload[0].get("tag") or tags_payload[0].get("name") or "").strip() or None
        first_color = (tags_payload[0].get("tagColor") or tags_payload[0].get("color") or "").strip() or None
        payload.tag = first_tag
        payload.tagColor = first_color

    job_data = JobCreate(
        name=payload.name,
        vcd_filename=vcd_filename,
        firmware_filename=fw_name or None,
        vcd_file_id=vcd_file_id,
        firmware_file_id=firmware_file_id,
        target_board_id=None,
        priority=0,
        timeout_seconds=60,
        pairs_data=payload.pairsData,  # Persist for restore after restart
        tag=payload.tag,
        tag_color=payload.tagColor,
        client_id=payload.clientId,
        profile_id=payload.profileId,
        profile_display_name=(payload.profileDisplayName or "").strip() or None,
        config_name=payload.configName,
        # save_to_db=False signals add_job to create with state="draft"
        save_to_db=not payload.saveAsDraft,
    )
    job = await job_queue_service.add_job(job_data)

    fe_job_store.create_from_payload(
        job.id,
        tag=payload.tag,
        tags=tags_payload,
        tag_color=payload.tagColor,
        firmware=payload.firmware,
        boards=payload.boards,
        files=file_payloads,
        client_id=payload.clientId,
        profile_id=payload.profileId,
        config_name=payload.configName,
        default_file_name=vcd_filename,
    )
    
    # เก็บ pairs data สำหรับ edit batch
    if payload.pairsData:
        fe_job_store.save_pairs_data(job.id, payload.pairsData)

    # Draft jobs are saved but NOT queued for execution yet.
    # Only attempt auto-start when the job is created as pending.
    if not payload.saveAsDraft:
        await _autostart_next_pending()
    refreshed = await job_queue_service.get_job(job.id)
    return await _build_fe_job(refreshed or job)


@router.put("/{job_id}")
async def update_job(job_id: str, payload: JobCreatePayload):
    """Update an existing job (draft or pending). Replaces files and meta from payload."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status.state not in {JobState.DRAFT, JobState.PENDING}:
        raise HTTPException(
            status_code=400,
            detail="Only draft or pending jobs can be updated. Stop the job first to edit.",
        )
    file_payloads = [_model_to_dict(f) for f in (payload.files or [])]
    library_files = await file_store.list_files(set_id=None)
    vcd_file_id, firmware_file_id, first_name, fw_name = _resolve_job_file_ids(file_payloads, payload.firmware, library_files)
    vcd_filename = first_name if first_name else getattr(job, "vcd_filename", None) or f"{job_id}.vcd"
    firmware_filename = fw_name or ""
    # If no change from payload files, keep existing IDs.
    if vcd_file_id is None and not first_name:
        vcd_file_id = getattr(job, "vcd_file_id", None)
    if firmware_file_id is None and not fw_name:
        firmware_file_id = getattr(job, "firmware_file_id", None)
    tags_payload = payload.tags if isinstance(payload.tags, list) else None
    if tags_payload and isinstance(tags_payload[0], dict):
        first_tag = (tags_payload[0].get("tag") or tags_payload[0].get("name") or "").strip() or None
        first_color = (tags_payload[0].get("tagColor") or tags_payload[0].get("color") or "").strip() or None
        payload.tag = first_tag
        payload.tagColor = first_color
    profile_display_name = None
    if payload.profileDisplayName is not None:
        profile_display_name = (payload.profileDisplayName or "").strip() or None
    await job_queue_service.update_job_meta(
        job_id,
        name=payload.name,
        vcd_file_id=vcd_file_id,
        firmware_file_id=firmware_file_id,
        pairs_data=payload.pairsData if payload.pairsData is not None else None,
        client_id=payload.clientId,
        profile_id=payload.profileId,
        profile_display_name=profile_display_name,
    )
    tag_color_val = (payload.tagColor or "").strip() or None
    await job_queue_service.update_job_tag_fields(
        job_id, {"tag": payload.tag, "tag_color": tag_color_val}
    )
    fe_job_store.create_from_payload(
        job_id,
        tag=payload.tag,
        tags=tags_payload,
        tag_color=payload.tagColor,
        firmware=payload.firmware,
        boards=payload.boards,
        files=file_payloads,
        client_id=payload.clientId,
        profile_id=payload.profileId,
        config_name=payload.configName,
        default_file_name=vcd_filename,
    )
    if payload.pairsData is not None:
        fe_job_store.save_pairs_data(job_id, payload.pairsData)
    # Only attempt auto-start when the job is not being saved as draft.
    if not payload.saveAsDraft:
        await _autostart_next_pending()
    return await _build_fe_job(await job_queue_service.get_job(job_id))


@router.post("/{job_id}/start")
async def start_job(job_id: str, priority: Optional[str] = None):
    """Start a job. Verifies that referenced files have not been modified on disk since upload.
    If job is still in draft state, it will be promoted to pending before running.

    Optional query param ``priority`` ("high" | "normal") sets the job priority before
    starting so the queue (ordered by priority desc) runs high-priority jobs first.
    """
    if priority is not None:
        p = priority.strip().lower()
        if p in {"high", "normal"}:
            from db.database import async_session
            from sqlalchemy import update as sa_update
            from db.orm_models import JobORM
            async with async_session() as session:
                await session.execute(
                    sa_update(JobORM)
                    .where(JobORM.id == job_id)
                    .values(priority=10 if p == "high" else 0)
                )
                await session.commit()
    return await _start_job_internal(job_id)


@router.post("/{job_id}/save-draft")
async def save_job_as_draft(job_id: str):
    """Mark an existing job as draft (not queued).

    Allowed only when the job is in draft or pending state.
    Running / completed / failed / cancelled jobs cannot be reverted to draft.
    """
    from db.database import async_session
    from sqlalchemy import update as sa_update
    from db.orm_models import JobORM

    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status.state not in {JobState.DRAFT, JobState.PENDING}:
        raise HTTPException(
            status_code=400,
            detail="Only draft or pending jobs can be saved as draft. Stop the job first.",
        )
    async with async_session() as session:
        await session.execute(
            sa_update(JobORM)
            .where(JobORM.id == job_id)
            .values(
                state=JobState.DRAFT.value,
                current_step="Saved as draft",
            )
        )
        await session.commit()
    fe_job_store.sync_files_for_status(job_id, "draft")
    refreshed = await job_queue_service.get_job(job_id)
    return {"success": True, "job": await _build_fe_job(refreshed)}


@router.post("/{job_id}/stop")
async def stop_job(job_id: str):
    """Stop a job (mock)."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    await job_queue_service.update_job_status(
        job_id, JobState.CANCELLED, progress=job.status.progress, completed_at=datetime.utcnow()
    )
    await _cancel_job_simulation(job_id)
    fe_job_store.sync_files_for_status(job_id, "stopped")
    await _autostart_next_pending()
    return {"success": True, "message": "Job stopped"}


@router.post("/stop-all")
async def stop_all_jobs():
    """Stop all running jobs (mock)."""
    jobs = await job_queue_service.get_all_jobs()
    stopped = 0
    for job in jobs:
        if _map_job_state(job.status.state) == "running":
            await job_queue_service.update_job_status(
                job.id, JobState.CANCELLED, progress=job.status.progress, completed_at=datetime.utcnow()
            )
            await _cancel_job_simulation(job.id)
            fe_job_store.sync_files_for_status(job.id, "stopped")
            stopped += 1
    return {"success": True, "stoppedCount": stopped}


@router.post("/{job_id}/reorder")
async def reorder_job(job_id: str, new_position: int):
    """Reorder a job in the queue."""
    success = await job_queue_service.reorder_job(job_id, new_position)
    if not success:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"success": True, "new_position": new_position}


@router.get("/{job_id}/export")
async def export_job(job_id: str):
    """Export a job payload as JSON."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return await _build_fe_job(job)


@router.get("/status/summary")
async def get_job_status_summary():
    """Get summary of job statuses."""
    jobs = await job_queue_service.get_all_jobs()
    
    summary = {
        "total": len(jobs),
        "draft": sum(1 for j in jobs if _map_job_state(j.status.state) == "draft"),
        "pending": sum(1 for j in jobs if _map_job_state(j.status.state) == "pending"),
        "running": sum(1 for j in jobs if _map_job_state(j.status.state) == "running"),
        "completed": sum(1 for j in jobs if _map_job_state(j.status.state) == "completed"),
        "stopped": sum(1 for j in jobs if _map_job_state(j.status.state) == "stopped"),
        "failed": sum(1 for j in jobs if _map_job_state(j.status.state) == "failed"),
    }
    return summary


@router.patch("/{job_id}")
async def update_job_tag(job_id: str, payload: JobTagUpdate):
    """Update job metadata (tag and/or tagColor)."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    raw = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    if not raw:
        return {"success": True, "job": await _build_fe_job(job)}
    orm_fields: Dict[str, Optional[str]] = {}
    fe_fields: Dict[str, Optional[str] | List[dict]] = {}
    if "tag" in raw:
        orm_fields["tag"] = raw["tag"]
        fe_fields["tag"] = raw["tag"]
    if "tagColor" in raw:
        tc = (raw.get("tagColor") or "").strip() or None
        orm_fields["tag_color"] = tc
        fe_fields["tagColor"] = tc
    if "tags" in raw:
        tags_raw = raw.get("tags") or []
        fe_fields["tags"] = tags_raw if isinstance(tags_raw, list) else []
        # Keep DB "tag/tag_color" in sync with first tag for backward compatibility & persistence.
        if isinstance(tags_raw, list) and tags_raw:
            first = tags_raw[0] if isinstance(tags_raw[0], dict) else {}
            first_tag = (first.get("tag") or first.get("name") or "").strip() or None
            first_color = (first.get("tagColor") or first.get("color") or "").strip() or None
            orm_fields["tag"] = first_tag
            orm_fields["tag_color"] = first_color
            fe_fields["tag"] = first_tag
            fe_fields["tagColor"] = first_color
    if orm_fields:
        await job_queue_service.update_job_tag_fields(job_id, orm_fields)
    fe_job_store.ensure_meta(job.id, default_file_name=getattr(job, "vcd_filename", None), pairs_data=getattr(job, "pairs_data", None))
    if fe_fields:
        fe_job_store.apply_tag_patch(job_id, fe_fields)
    job = await job_queue_service.get_job(job_id)
    return {"success": True, "job": await _build_fe_job(job)}


@router.get("/{job_id}/files")
async def get_job_files(job_id: str):
    """Get files in a job."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    fe_job_store.ensure_meta(job.id, default_file_name=getattr(job, "vcd_filename", None), pairs_data=getattr(job, "pairs_data", None))
    files = fe_job_store.list_files(job.id)
    return _serialize_files(files)


@router.get("/{job_id}/pairs")
async def get_job_pairs(job_id: str):
    """Get pairs data (pair table history) for editing batch."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    # Restore from DB when fe_job_store is empty (e.g. after restart)
    fe_job_store.ensure_meta(
        job.id,
        default_file_name=getattr(job, "vcd_filename", None),
        pairs_data=getattr(job, "pairs_data", None),
    )
    pairs_data = fe_job_store.get_pairs_data(job.id)
    if pairs_data is None:
        db_pairs = getattr(job, "pairs_data", None)
        if db_pairs is not None:
            return {"pairsData": db_pairs}
        raise HTTPException(status_code=404, detail="Pairs data not found for this job")
    return {"pairsData": pairs_data}


@router.post("/{job_id}/files/{file_id}/stop")
async def stop_job_file(job_id: str, file_id: int):
    """Stop a specific file in a job."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    fe_job_store.ensure_meta(job.id, default_file_name=getattr(job, "vcd_filename", None), pairs_data=getattr(job, "pairs_data", None))
    file_item = fe_job_store.update_file(job.id, file_id, status="stopped")
    if not file_item:
        raise HTTPException(status_code=404, detail="File not found")
    return {"success": True, "file": {"id": file_item.id, "status": file_item.status}}


@router.post("/{job_id}/files/{file_id}/rerun")
async def rerun_job_file(job_id: str, file_id: int):
    """Set a stopped/failed file back to pending so it can be run again."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    fe_job_store.ensure_meta(job.id, default_file_name=getattr(job, "vcd_filename", None), pairs_data=getattr(job, "pairs_data", None))
    files = fe_job_store.list_files(job.id)
    file_before = next((f for f in files if f.id == file_id), None)
    if not file_before:
        raise HTTPException(status_code=404, detail="File not found")
    status_before = str(file_before.status or "").lower()
    result_before = str(getattr(file_before, "result", "") or "").lower()
    can_rerun = status_before == "stopped" or (status_before in {"completed", "error"} and result_before == "fail")
    if not can_rerun:
        raise HTTPException(status_code=400, detail="Only stopped or failed files can be re-run")
    file_item = fe_job_store.update_file(job.id, file_id, status="pending", result=None)
    return {"success": True, "file": {"id": file_item.id, "status": file_item.status}}


@router.post("/{job_id}/files/{file_id}/move")
async def move_job_file(job_id: str, file_id: int, payload: FileMoveRequest):
    """Move a file up/down in the job."""
    job = await job_queue_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    fe_job_store.ensure_meta(job.id, default_file_name=getattr(job, "vcd_filename", None), pairs_data=getattr(job, "pairs_data", None))
    files = fe_job_store.move_file(job.id, file_id, payload.direction)
    return {
        "success": True,
        "files": [{"id": f.id, "order": f.order} for f in sorted(files, key=lambda f: f.order)],
    }


@router.post("/upload")
async def upload_files(
    vcd_file: UploadFile = File(...),
    firmware_file: Optional[UploadFile] = File(None),
    name: str = Form(...),
    target_board_id: Optional[str] = Form(None),
    priority: int = Form(0),
    timeout_seconds: int = Form(60),
):
    """Upload VCD/firmware files and create a job."""
    vcd_filename = f"{uuid.uuid4()}_{vcd_file.filename}"
    vcd_path = os.path.join(UPLOAD_DIR, vcd_filename)
    with open(vcd_path, "wb") as f:
        content = await vcd_file.read()
        f.write(content)

    firmware_filename = None
    if firmware_file:
        firmware_filename = f"{uuid.uuid4()}_{firmware_file.filename}"
        firmware_path = os.path.join(UPLOAD_DIR, firmware_filename)
        with open(firmware_path, "wb") as f:
            content = await firmware_file.read()
            f.write(content)

    job_data = JobCreate(
        name=name,
        vcd_filename=vcd_filename,
        firmware_filename=firmware_filename,
        target_board_id=target_board_id,
        priority=priority,
        timeout_seconds=timeout_seconds,
    )
    job = await job_queue_service.add_job(job_data)
    await _autostart_next_pending()
    return await _build_fe_job(job)


@router.delete("/{job_id}")
async def delete_job(job_id: str):
    """Remove a job from the queue and delete related results, job_files rows, and FE cache."""
    await _cancel_job_simulation(job_id)
    success = await job_queue_service.remove_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    await _autostart_next_pending()
    return {"message": f"Job {job_id} removed"}


@router.post("/{job_id}/reorder")
async def reorder_job(job_id: str, new_position: int):
    """Move a job to a new position in the queue."""
    success = await job_queue_service.reorder_job(job_id, new_position)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to reorder job")
    return {"message": f"Job {job_id} moved to position {new_position}"}


@router.post("/run-command")
async def run_command(payload: RunCommandPayload):
    """Create a job that represents a command execution."""
    job_name = payload.name or "Run Command"
    vcd_filename = f"{uuid.uuid4().hex[:8]}.cmd"

    job_data = JobCreate(
        name=job_name,
        vcd_filename=vcd_filename,
        firmware_filename=payload.firmware,
        target_board_id=None,
        priority=0,
        timeout_seconds=60,
        client_id=payload.clientId,
        profile_id=payload.profileId,
        profile_display_name=(payload.profileDisplayName or "").strip() or None,
        tag=payload.tag,
        config_name=payload.configName,
    )
    job = await job_queue_service.add_job(job_data)

    fe_job_store.create_from_payload(
        job.id,
        tag=payload.tag,
        firmware=payload.firmware,
        boards=payload.boards,
        files=[{"name": f"command_{job.id}.txt", "order": 1}],
        client_id=payload.clientId,
        profile_id=payload.profileId,
        config_name=payload.configName,
        default_file_name=vcd_filename,
    )
    return await _build_fe_job(job)


@router.post("/start")
async def start_queue():
    """Start processing the job queue."""
    await job_queue_service.start()
    return {"message": "Queue processing started"}


@router.post("/stop")
async def stop_queue():
    """Stop processing the job queue."""
    await job_queue_service.stop()
    return {"message": "Queue processing stopped"}


@router.get("/status/summary")
async def get_queue_status():
    """Get queue processing status."""
    return await job_queue_service.get_status()
