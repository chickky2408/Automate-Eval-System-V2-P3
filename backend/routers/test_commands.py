"""Test Commands and File Tags API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.test_command_store import test_command_store

router = APIRouter()


# ========== Test Commands ==========

class TestCommandCreate(BaseModel):
    name: str
    command: str
    description: Optional[str] = None


class TestCommandUpdate(BaseModel):
    name: Optional[str] = None
    command: Optional[str] = None
    description: Optional[str] = None


@router.get("/test-commands")
async def list_test_commands(user_id: Optional[str] = None):
    """List all test commands."""
    return await test_command_store.list_test_commands(user_id=user_id)


@router.post("/test-commands")
async def create_test_command(data: TestCommandCreate, user_id: Optional[str] = None):
    """Create a new test command."""
    return await test_command_store.create_test_command(
        name=data.name,
        command=data.command,
        description=data.description,
        user_id=user_id,
    )


@router.get("/test-commands/{command_id}")
async def get_test_command(command_id: str):
    """Get a specific test command."""
    command = await test_command_store.get_test_command(command_id)
    if not command:
        raise HTTPException(status_code=404, detail="Test command not found")
    return command


@router.patch("/test-commands/{command_id}")
async def update_test_command(command_id: str, data: TestCommandUpdate):
    """Update a test command."""
    success = await test_command_store.update_test_command(
        command_id=command_id,
        name=data.name,
        command=data.command,
        description=data.description,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Test command not found")
    return {"success": True}


@router.delete("/test-commands/{command_id}")
async def delete_test_command(command_id: str):
    """Delete a test command."""
    success = await test_command_store.delete_test_command(command_id)
    if not success:
        raise HTTPException(status_code=404, detail="Test command not found")
    return {"success": True}


# ========== File Tags ==========

class FileTagCreate(BaseModel):
    tag: str
    color: Optional[str] = None


class FileTagUpdate(BaseModel):
    tag: Optional[str] = None
    color: Optional[str] = None


@router.get("/file-tags")
async def list_file_tags(user_id: Optional[str] = None):
    """List all file tags."""
    return await test_command_store.list_file_tags(user_id=user_id)


@router.post("/file-tags")
async def create_file_tag(data: FileTagCreate, user_id: Optional[str] = None):
    """Create a new file tag."""
    return await test_command_store.create_file_tag(
        tag=data.tag,
        color=data.color,
        user_id=user_id,
    )


@router.get("/file-tags/{tag_id}")
async def get_file_tag(tag_id: str):
    """Get a specific file tag."""
    tag = await test_command_store.get_file_tag(tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="File tag not found")
    return tag


@router.patch("/file-tags/{tag_id}")
async def update_file_tag(tag_id: str, data: FileTagUpdate):
    """Update a file tag."""
    success = await test_command_store.update_file_tag(
        tag_id=tag_id,
        tag=data.tag,
        color=data.color,
    )
    if not success:
        raise HTTPException(status_code=404, detail="File tag not found")
    return {"success": True}


@router.delete("/file-tags/{tag_id}")
async def delete_file_tag(tag_id: str):
    """Delete a file tag."""
    success = await test_command_store.delete_file_tag(tag_id)
    if not success:
        raise HTTPException(status_code=404, detail="File tag not found")
    return {"success": True}
