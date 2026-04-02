"""Job Files API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.job_file_store import job_file_store

router = APIRouter()


class JobFileCreate(BaseModel):
    name: str
    order: Optional[int] = None
    vcd: Optional[str] = None
    erom: Optional[str] = None
    ulp: Optional[str] = None
    try_count: Optional[int] = None
    test_case_name: Optional[str] = None


class JobFileUpdate(BaseModel):
    status: Optional[str] = None
    result: Optional[str] = None
    order: Optional[int] = None


@router.get("/jobs/{job_id}/files")
async def list_job_files(job_id: str):
    """List all files for a job."""
    return await job_file_store.list_job_files(job_id)


@router.post("/jobs/{job_id}/files")
async def create_job_file(job_id: str, data: JobFileCreate):
    """Create a new job file."""
    return await job_file_store.create_job_file(
        job_id=job_id,
        name=data.name,
        order=data.order,
        vcd=data.vcd,
        erom=data.erom,
        ulp=data.ulp,
        try_count=data.try_count,
        test_case_name=data.test_case_name,
    )


@router.get("/jobs/{job_id}/files/{file_id}")
async def get_job_file(job_id: str, file_id: str):
    """Get a specific job file."""
    job_file = await job_file_store.get_job_file(file_id)
    if not job_file:
        raise HTTPException(status_code=404, detail="Job file not found")
    return job_file


@router.patch("/jobs/{job_id}/files/{file_id}")
async def update_job_file(job_id: str, file_id: str, data: JobFileUpdate):
    """Update a job file."""
    success = await job_file_store.update_job_file(
        file_id=file_id,
        status=data.status,
        result=data.result,
        order=data.order,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Job file not found")
    return {"success": True}


@router.delete("/jobs/{job_id}/files/{file_id}")
async def delete_job_file(job_id: str, file_id: str):
    """Delete a job file."""
    success = await job_file_store.delete_job_file(file_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job file not found")
    return {"success": True}


@router.post("/jobs/{job_id}/files/sync")
async def sync_job_files(job_id: str, status: str):
    """Sync files status based on job status."""
    return await job_file_store.sync_files_for_status(job_id, status)
