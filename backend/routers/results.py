"""Test results API endpoints."""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from typing import List, Optional
from datetime import datetime

from models.result import TestResult, WaveformData
from services.result_store import result_store
from services.waveform_file import WaveformFormatError, read_waveform_preview, waveform_csv_text

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


@router.get("/{result_id}/preview")
async def preview_result_waveform(result_id: str, max_samples: int = Query(2000, ge=1, le=20000)):
    """Get downsampled waveform preview data from the stored HDF5 result file."""
    path = await result_store.get_waveform_path(result_id)
    if not path:
        raise HTTPException(status_code=404, detail="Waveform file not found")
    try:
        return read_waveform_preview(path, max_samples=max_samples)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Waveform file missing from disk")
    except WaveformFormatError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/{result_id}/export")
async def export_result_file(result_id: str, format: str = Query("h5")):
    """Export stored waveform result as canonical HDF5, VCD, or generated CSV."""
    export_format = (format or "h5").strip().lower()
    if export_format not in {"h5", "csv", "vcd"}:
        raise HTTPException(status_code=400, detail=f"Unsupported export format: {format}")

    path = await result_store.get_waveform_path(result_id)
    if not path:
        raise HTTPException(status_code=404, detail="Waveform file not found")

    import os
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Waveform file missing from disk")

    if export_format == "h5":
        return FileResponse(
            path=path,
            media_type="application/x-hdf5",
            filename=f"result_{result_id}.h5",
        )

    if export_format == "vcd":
        vcd_path = os.path.splitext(path)[0] + ".vcd"
        if os.path.exists(vcd_path):
            return FileResponse(
                path=vcd_path,
                media_type="text/plain; charset=utf-8",
                filename=f"result_{result_id}.vcd",
            )
        raise HTTPException(status_code=404, detail="VCD waveform file not found on disk for this result")

    try:
        csv_text = waveform_csv_text(path)
    except WaveformFormatError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="result_{result_id}.csv"'},
    )


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
