"""Test results API endpoints."""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from typing import List, Optional
from datetime import datetime

from models.result import TestResult, WaveformData
from services.result_store import result_store

router = APIRouter()


@router.get("", response_model=List[TestResult])
async def list_results(
    board_id: Optional[str] = Query(None, description="Filter by board"),
    passed: Optional[bool] = Query(None, description="Filter by pass/fail"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    """Get historical test results."""
    return await result_store.get_results(
        board_id=board_id,
        passed=passed,
        limit=limit,
        offset=offset,
    )


@router.get("/{result_id}", response_model=TestResult)
async def get_result(result_id: str):
    """Get a specific test result."""
    result = await result_store.get_result(result_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Result {result_id} not found")
    return result


@router.get("/{result_id}/waveform", response_model=WaveformData)
async def get_waveform(result_id: str):
    """Get waveform data for a test result."""
    waveform = await result_store.get_waveform(result_id)
    if not waveform:
        raise HTTPException(status_code=404, detail="Waveform data not available")
    return waveform


@router.get("/{result_id}/download")
async def download_result_file(result_id: str):
    """Download the HDF5 waveform file."""
    path = await result_store.get_waveform_path(result_id)
    if not path:
        raise HTTPException(status_code=404, detail="Waveform file not found")
    
    # Optional: Check if file physically exists
    import os
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Waveform file missing from disk")
        
    return FileResponse(
        path=path, 
        media_type="application/x-hdf5", 
        filename=f"result_{result_id}.h5"
    )


@router.get("/{result_id}/log")
async def get_console_log(result_id: str):
    """Get raw console log for a test result."""
    result = await result_store.get_result(result_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Result {result_id} not found")
    return {"log": result.console_log or ""}


@router.delete("/{result_id}")
async def delete_result(result_id: str):
    """Delete a test result."""
    success = await result_store.delete_result(result_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Result {result_id} not found")
    return {"message": f"Result {result_id} deleted"}
