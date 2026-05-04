"""File upload and management endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header
from fastapi.responses import Response
from typing import Optional, Set
from datetime import datetime
from pydantic import BaseModel
from services.file_store import file_store
from utils.file_type_utils import classify_file_type_from_filename
from services.profile_lookup import batch_profile_names_by_ids
from services.job_queue import job_queue_service
from services.fe_job_store import fe_job_store
from models.job import JobState

router = APIRouter()

ACTIVE_JOB_STATES = {JobState.PENDING, JobState.CONFIGURING, JobState.FLASHING, JobState.RUNNING}


async def _file_names_in_use_by_active_jobs() -> Set[str]:
    """Return set of file names (vcd/erom/ulp) referenced by any pending or running job."""
    names: Set[str] = set()
    jobs = await job_queue_service.get_all_jobs()
    for job in jobs:
        if job.status.state not in ACTIVE_JOB_STATES:
            continue
        for f in fe_job_store.list_files(job.id):
            if f.vcd:
                names.add(f.vcd)
            if f.erom:
                names.add(f.erom)
            if f.ulp:
                names.add(f.ulp)
    return names


class FileLibraryTagsUpdate(BaseModel):
    """Library file tags (shared by all profiles). Same format as frontend: comma-separated tags + pill color."""
    tags: Optional[str] = None
    tagColor: Optional[str] = None


class FileCheckPayload(BaseModel):
    """Metadata only: for compare-before-upload. Frontend sends filename, signature (checksum), size, modifyDate."""
    filename: Optional[str] = None
    signature: Optional[str] = None  # SHA-256 checksum (or MD5/CRC per requirement)
    size: Optional[int] = None
    modifyDate: Optional[str] = None


@router.post("/check")
async def check_file(payload: FileCheckPayload):
    """Compare by signature (checksum) before upload. Returns duplicate + existing file if found."""
    checksum = (payload.signature or "").strip()
    if not checksum:
        return {"duplicate": False}
    existing = await file_store.find_by_checksum(checksum, set_id=None)
    if existing:
        return {
            "duplicate": True,
            "existing": {
                "id": existing["id"],
                "name": existing["name"],
                "size": existing["size"],
                "type": existing["type"],
                "uploadDate": existing["uploadDate"],
                "checksum": existing.get("checksum"),
            },
        }
    return {"duplicate": False}


@router.get("/{file_id}/content")
async def get_file_content(file_id: str):
    """Return raw file content (for copying to set storage or download)."""
    content = await file_store.get_file_content(file_id)
    if content is None:
        raise HTTPException(status_code=404, detail="File not found")
    record = await file_store.get_file(file_id)
    name = record.get("name", "file") if record else "file"
    return Response(content=content, media_type="application/octet-stream", headers={"Content-Disposition": f"inline; filename={name}"})

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    metadata: Optional[str] = Form(None),
    force_new: Optional[str] = Form(None),
    owner_id: Optional[str] = Form(None),
    owner_display_name: Optional[str] = Form(None),
    visibility: Optional[str] = Form(None),
):
    """Upload file. If force_new is 'true', save a new copy even when content (checksum) already exists.
    owner_id: client_id or profile_id of uploader. owner_display_name: profile display name snapshot for Owner column.
    visibility: 'private' | 'team' | 'public'."""
    content = await file.read()
    filename = file.filename or "upload.bin"
    # Stored in DB as enum: VCD, EROM, ULP, TXT, … (not raw extension / OTHER for .erom/.ulp/.txt)
    file_type = classify_file_type_from_filename(filename)
    force_save_new = str(force_new or "").lower() in ("true", "1", "yes")
    vis = (visibility or "public").lower()
    if vis not in ("private", "team", "public"):
        vis = "public"

    snap = (owner_display_name or "").strip() or None
    record = await file_store.add_file(
        name=filename,
        file_type=file_type,
        content=content,
        force_new=force_save_new,
        owner_id=owner_id,
        owner_display_name=snap,
        visibility=vis,
    )

    oid = record.get("ownerId")
    owner_name = (snap or (record.get("ownerDisplayName") or "").strip() or None)
    if not owner_name and oid:
        owner_name = (await batch_profile_names_by_ids({oid})).get(oid)

    response = {
        "id": record["id"],
        "name": record["name"],
        "size": record["size"],
        "type": record["type"],
        "uploadDate": record["uploadDate"],
        "updatedAt": record.get("updatedAt"),
        "checksum": record.get("checksum"),
        "ownerId": record.get("ownerId"),
        "ownerName": owner_name,
        "visibility": record.get("visibility", "public"),
        "tags": record.get("tags"),
        "tagColor": record.get("tagColor"),
    }
    if record.get("duplicateByContent"):
        response["duplicateByContent"] = True
    if record.get("duplicateByName"):
        response["duplicateByName"] = True
    return response


@router.get("")
async def list_files():
    files = await file_store.list_files()
    owner_ids = {f.get("ownerId") for f in files if f.get("ownerId")}
    name_map = await batch_profile_names_by_ids(owner_ids)
    result = []
    for f in files:
        oid = f.get("ownerId")
        snapshot = (f.get("ownerDisplayName") or "").strip() or None
        resolved = snapshot or (name_map.get(oid) if oid else None)
        result.append(
            {
                "id": f["id"],
                "name": f["name"],
                "size": f["size"],
                "type": f["type"],
                "uploadDate": f["uploadDate"],
                "updatedAt": f.get("updatedAt"),
                "checksum": f.get("checksum"),
                "ownerId": f.get("ownerId"),
                "ownerName": resolved,
                "visibility": f.get("visibility", "public"),
                "tags": f.get("tags"),
                "tagColor": f.get("tagColor"),
            }
        )
    return result


@router.patch("/{file_id}/library-tags")
async def patch_file_library_tags(file_id: str, payload: FileLibraryTagsUpdate):
    """Update tags and/or accent color for a library file (visible to all profiles)."""
    record = await file_store.get_file(file_id)
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    raw = payload.model_dump(exclude_unset=True)
    if not raw:
        raise HTTPException(status_code=400, detail="No fields to update")
    ok = await file_store.update_file_library_tags(file_id, raw)
    if not ok:
        raise HTTPException(status_code=404, detail="File not found")
    return {"success": True}


@router.get("/{file_id}")
async def get_file(file_id: str):
    record = await file_store.get_file(file_id)
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    return {
        "id": record["id"],
        "name": record["name"],
        "size": record["size"],
        "type": record["type"],
        "uploadDate": record["uploadDate"],
    }


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    x_acting_profile_id: Optional[str] = Header(default=None, alias="X-Acting-Profile-Id"),
    x_acting_client_id: Optional[str] = Header(default=None, alias="X-Acting-Client-Id"),
):
    record = await file_store.get_file(file_id)
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    owner_id = (record.get("ownerId") or "").strip()
    if owner_id:
        actor_profile = (x_acting_profile_id or "").strip()
        actor_client = (x_acting_client_id or "").strip()
        if actor_profile or actor_client:
            if owner_id != actor_profile and owner_id != actor_client:
                raise HTTPException(
                    status_code=403,
                    detail="Cannot delete a file owned by another profile.",
                )
    in_use = await _file_names_in_use_by_active_jobs()
    if record.get("name") and record["name"] in in_use:
        raise HTTPException(
            status_code=409,
            detail="File is in use by a running or pending batch. Wait for the batch to finish or remove the batch first.",
        )
    success = await file_store.delete_file(file_id)
    if not success:
        raise HTTPException(status_code=404, detail="File not found")
    return {"success": True}
