"""Notification management API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from services.notification_store import notification_store

router = APIRouter()


@router.get("")
async def list_notifications(
    read: Optional[bool] = Query(None),
    limit: Optional[int] = Query(None, ge=1),
    user_id: Optional[str] = Query(None),
):
    """List notifications."""
    return await notification_store.list_notifications(read=read, limit=limit, user_id=user_id)


@router.post("")
async def create_notification(
    title: str,
    message: str,
    notif_type: str,
    user_id: Optional[str] = None,
    data: Optional[dict] = None,
):
    """Create a new notification."""
    return await notification_store.add_notification(
        title=title,
        message=message,
        notif_type=notif_type,
        user_id=user_id,
        data=data,
    )


@router.post("/{notification_id}/read")
async def mark_notification_read(notification_id: str):
    """Mark a notification as read."""
    record = await notification_store.mark_read(notification_id)
    if not record:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"success": True}


@router.post("/read-all")
async def mark_all_read(user_id: Optional[str] = Query(None)):
    """Mark all notifications as read."""
    count = await notification_store.mark_all_read(user_id=user_id)
    return {"success": True, "count": count}


@router.delete("/{notification_id}")
async def delete_notification(notification_id: str):
    """Delete a notification."""
    success = await notification_store.delete_notification(notification_id)
    if not success:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"success": True}
