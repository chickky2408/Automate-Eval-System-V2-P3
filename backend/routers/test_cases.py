"""Test Case and Test Set API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from services.test_case_store import test_case_store
from models.test_case import TestCaseCreate, TestSetCreate, RunSetCreate

router = APIRouter()


# ========== Test Cases ==========

@router.get("/test-cases")
async def list_test_cases():
    """Get all test cases."""
    return await test_case_store.list_test_cases()


@router.post("/test-cases")
async def create_test_case(data: TestCaseCreate):
    """Create a new test case."""
    return await test_case_store.create_test_case(data)


@router.get("/test-cases/orphaned")
async def get_orphaned_test_cases():
    """Get all orphaned test cases (unlinked and with no run history)."""
    return await test_case_store.get_orphaned_test_cases()


@router.get("/test-cases/{test_case_id}")
async def get_test_case(test_case_id: str):
    """Get a specific test case."""
    test_case = await test_case_store.get_test_case(test_case_id)
    if not test_case:
        raise HTTPException(status_code=404, detail="Test case not found")
    return test_case


@router.patch("/test-cases/{test_case_id}")
async def update_test_case(
    test_case_id: str,
    name: Optional[str] = None,
    vcd_file_id: Optional[str] = None,
    firmware_filename: Optional[str] = None,
    tags: Optional[str] = None,
):
    """Update a test case."""
    success = await test_case_store.update_test_case(
        test_case_id, name=name, vcd_file_id=vcd_file_id,
        firmware_filename=firmware_filename, tags=tags,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Test case not found")
    return {"success": True}


@router.delete("/test-cases/{test_case_id}")
async def delete_test_case(test_case_id: str):
    """Delete a test case."""
    success = await test_case_store.delete_test_case(test_case_id)
    if not success:
        raise HTTPException(status_code=404, detail="Test case not found")
    return {"success": True}


# ========== Test Sets ==========

@router.get("/test-sets")
async def list_test_sets():
    """Get all test sets."""
    return await test_case_store.list_test_sets()


@router.post("/test-sets")
async def create_test_set(data: TestSetCreate):
    """Create a new test set."""
    return await test_case_store.create_test_set(data)


@router.get("/test-sets/{test_set_id}")
async def get_test_set(test_set_id: str):
    """Get a specific test set."""
    test_set = await test_case_store.get_test_set(test_set_id)
    if not test_set:
        raise HTTPException(status_code=404, detail="Test set not found")
    return test_set


@router.get("/test-sets/{test_set_id}/items")
async def list_test_set_items(test_set_id: str):
    """Get all items in a test set."""
    return await test_case_store.list_test_set_items(test_set_id)


@router.post("/test-sets/{test_set_id}/items")
async def add_test_case_to_set(test_set_id: str, test_case_id: str, execution_order: int):
    """Add a test case to a test set."""
    return await test_case_store.add_test_case_to_set(test_set_id, test_case_id, execution_order)


@router.patch("/test-sets/{test_set_id}")
async def update_test_set(
    test_set_id: str,
    name: Optional[str] = None,
    tags: Optional[str] = None,
):
    """Update a test set."""
    success = await test_case_store.update_test_set(test_set_id, name=name, tags=tags)
    if not success:
        raise HTTPException(status_code=404, detail="Test set not found")
    return {"success": True}


@router.delete("/test-sets/{test_set_id}")
async def delete_test_set(test_set_id: str):
    """Delete a test set."""
    success = await test_case_store.delete_test_set(test_set_id)
    if not success:
        raise HTTPException(status_code=404, detail="Test set not found")
    return {"success": True}


@router.delete("/test-sets/{test_set_id}/items/{test_case_id}")
async def remove_test_case_from_set(test_set_id: str, test_case_id: str):
    """Remove a test case from a test set."""
    success = await test_case_store.remove_test_case_from_set(test_set_id, test_case_id)
    if not success:
        raise HTTPException(status_code=404, detail="Test case not found in set")
    return {"success": True}


@router.patch("/test-sets/{test_set_id}/items/{test_case_id}/order")
async def update_test_case_order(test_set_id: str, test_case_id: str, new_order: int):
    """Update the execution order of a test case in a test set."""
    success = await test_case_store.update_test_case_order(test_set_id, test_case_id, new_order)
    if not success:
        raise HTTPException(status_code=404, detail="Test case not found in set")
    return {"success": True}


# ========== Run Sets ==========

@router.get("/run-sets")
async def list_run_sets():
    """Get all run sets."""
    return await test_case_store.list_run_sets()


@router.post("/run-sets")
async def create_run_set(data: RunSetCreate):
    """Create a new run set."""
    return await test_case_store.create_run_set(data)


@router.get("/run-sets/{run_set_id}")
async def get_run_set(run_set_id: str):
    """Get a specific run set."""
    run_set = await test_case_store.get_run_set(run_set_id)
    if not run_set:
        raise HTTPException(status_code=404, detail="Run set not found")
    return run_set


@router.patch("/run-sets/{run_set_id}")
async def update_run_set(
    run_set_id: str,
    name: Optional[str] = None,
    test_case_ids: Optional[list] = None,
):
    """Update a run set."""
    success = await test_case_store.update_run_set(run_set_id, name=name, test_case_ids=test_case_ids)
    if not success:
        raise HTTPException(status_code=404, detail="Run set not found")
    return {"success": True}


@router.delete("/run-sets/{run_set_id}")
async def delete_run_set(run_set_id: str):
    """Delete a run set."""
    success = await test_case_store.delete_run_set(run_set_id)
    if not success:
        raise HTTPException(status_code=404, detail="Run set not found")
    return {"success": True}
