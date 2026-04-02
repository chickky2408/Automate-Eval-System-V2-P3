"""
Notification Store Service with Database persistence.
"""
from __future__ import annotations

from typing import List, Optional
from datetime import datetime
import uuid

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import NotificationORM


class NotificationStore:
    """Manages notifications with database persistence."""

    def __init__(self) -> None:
        pass  # Database-backed, no in-memory state

    async def add_notification(
        self,
        title: str,
        message: str,
        notif_type: str,
        user_id: Optional[str] = None,
        data: Optional[dict] = None,
    ) -> dict:
        """Add a new notification."""
        notification_id = str(uuid.uuid4())
        
        async with async_session() as session:
            orm = NotificationORM(
                id=notification_id,
                user_id=user_id,
                type=notif_type,
                title=title,
                message=message,
                data=data,
                read=False,
                created_at=datetime.utcnow(),
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            
            return {
                "id": orm.id,
                "userId": orm.user_id,
                "type": orm.type,
                "title": orm.title,
                "message": orm.message,
                "data": orm.data,
                "read": orm.read,
                "createdAt": orm.created_at.isoformat() + "Z",
            }

    async def list_notifications(
        self,
        read: Optional[bool] = None,
        limit: Optional[int] = None,
        user_id: Optional[str] = None,
    ) -> List[dict]:
        """List notifications."""
        async with async_session() as session:
            query = select(NotificationORM).order_by(NotificationORM.created_at.desc())
            
            if user_id:
                query = query.where(
                    (NotificationORM.user_id == user_id) | (NotificationORM.user_id.is_(None))
                )
            
            if read is not None:
                query = query.where(NotificationORM.read == read)
            
            if limit:
                query = query.limit(limit)
            
            result = await session.execute(query)
            notifications = result.scalars().all()
            
            return [
                {
                    "id": n.id,
                    "userId": n.user_id,
                    "type": n.type,
                    "title": n.title,
                    "message": n.message,
                    "data": n.data,
                    "read": n.read,
                    "createdAt": n.created_at.isoformat() + "Z",
                }
                for n in notifications
            ]

    async def mark_read(self, notif_id: str) -> Optional[dict]:
        """Mark a notification as read."""
        async with async_session() as session:
            result = await session.execute(
                update(NotificationORM)
                .where(NotificationORM.id == notif_id)
                .values(read=True)
            )
            await session.commit()
            
            if result.rowcount == 0:
                return None
            
            # Get the updated record
            result = await session.execute(
                select(NotificationORM).where(NotificationORM.id == notif_id)
            )
            orm = result.scalar_one_or_none()
            
            return {
                "id": orm.id,
                "userId": orm.user_id,
                "type": orm.type,
                "title": orm.title,
                "message": orm.message,
                "data": orm.data,
                "read": orm.read,
                "createdAt": orm.created_at.isoformat() + "Z",
            }

    async def mark_all_read(self, user_id: Optional[str] = None) -> int:
        """Mark all notifications as read."""
        async with async_session() as session:
            query = update(NotificationORM).values(read=True)
            
            if user_id:
                query = query.where(NotificationORM.user_id == user_id)
            
            result = await session.execute(query)
            await session.commit()
            
            return result.rowcount

    async def delete_notification(self, notif_id: str) -> bool:
        """Delete a notification."""
        async with async_session() as session:
            result = await session.execute(
                delete(NotificationORM).where(NotificationORM.id == notif_id)
            )
            await session.commit()
            
            return result.rowcount > 0


notification_store = NotificationStore()
