"""Set-scoped file storage: save/restore files per test case set."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

from services.file_store import file_store

router = APIRouter()


class SaveSetFilesBody(BaseModel):
    file_ids: List[str]


@router.post("/{set_id}/files/save")
async def save_set_files(set_id: str, body: SaveSetFilesBody):
    """Copy given library file IDs into this set's storage. Overwrites existing set files for this set."""
    if not set_id.strip():
        raise HTTPException(status_code=400, detail="set_id required")
    if not body.file_ids:
        return {"saved": 0, "files": []}
    files = await file_store.save_set_files(set_id, body.file_ids)
    return {"saved": len(files), "files": files}


@router.get("/{set_id}/files")
async def list_set_files(set_id: str):
    """List files stored for this set."""
    if not set_id.strip():
        raise HTTPException(status_code=400, detail="set_id required")
    files = await file_store.list_set_files(set_id)
    return files


@router.post("/{set_id}/files/restore-to-library")
async def restore_set_files_to_library(set_id: str):
    """Copy all set files into main library (so they appear in File Library). Returns new file records."""
    if not set_id.strip():
        raise HTTPException(status_code=400, detail="set_id required")
    files = await file_store.restore_set_files_to_library(set_id)
    return {"restored": len(files), "files": files}


@router.delete("/{set_id}")
async def delete_set(set_id: str):
    """Delete this set from database: remove all files stored for this set_id (DB + disk)."""
    if not set_id.strip():
        raise HTTPException(status_code=400, detail="set_id required")
    count = await file_store.delete_files_by_set_id(set_id)
    return {"deleted": count}
