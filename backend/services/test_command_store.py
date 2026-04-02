"""
Test Command Store Service with Database persistence.
"""
from __future__ import annotations

from typing import List, Optional
from datetime import datetime
import uuid

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import TestCommandORM, FileTagORM


class TestCommandStore:
    """Manages test commands with database persistence."""

    # ========== Test Commands ==========

    async def create_test_command(
        self,
        name: str,
        command: str,
        description: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> dict:
        """Create a new test command."""
        command_id = str(uuid.uuid4())[:32]
        
        async with async_session() as session:
            orm = TestCommandORM(
                id=command_id,
                user_id=user_id,
                name=name,
                command=command,
                description=description,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            
            return {
                "id": orm.id,
                "user_id": orm.user_id,
                "name": orm.name,
                "command": orm.command,
                "description": orm.description,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def list_test_commands(self, user_id: Optional[str] = None) -> List[dict]:
        """List all test commands."""
        async with async_session() as session:
            query = select(TestCommandORM).order_by(TestCommandORM.created_at.desc())
            
            if user_id:
                query = query.where(
                    (TestCommandORM.user_id == user_id) | (TestCommandORM.user_id.is_(None))
                )
            
            result = await session.execute(query)
            commands = result.scalars().all()
            
            return [
                {
                    "id": c.id,
                    "user_id": c.user_id,
                    "name": c.name,
                    "command": c.command,
                    "description": c.description,
                    "created_at": c.created_at.isoformat() + "Z",
                    "updated_at": c.updated_at.isoformat() + "Z",
                }
                for c in commands
            ]

    async def get_test_command(self, command_id: str) -> Optional[dict]:
        """Get a specific test command."""
        async with async_session() as session:
            result = await session.execute(
                select(TestCommandORM).where(TestCommandORM.id == command_id)
            )
            orm = result.scalar_one_or_none()
            
            if not orm:
                return None
            
            return {
                "id": orm.id,
                "user_id": orm.user_id,
                "name": orm.name,
                "command": orm.command,
                "description": orm.description,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def update_test_command(
        self,
        command_id: str,
        name: Optional[str] = None,
        command: Optional[str] = None,
        description: Optional[str] = None,
    ) -> bool:
        """Update a test command."""
        async with async_session() as session:
            values = {"updated_at": datetime.utcnow()}
            if name is not None:
                values["name"] = name
            if command is not None:
                values["command"] = command
            if description is not None:
                values["description"] = description
            
            result = await session.execute(
                update(TestCommandORM).where(TestCommandORM.id == command_id).values(**values)
            )
            await session.commit()
            
            return result.rowcount > 0

    async def delete_test_command(self, command_id: str) -> bool:
        """Delete a test command."""
        async with async_session() as session:
            result = await session.execute(
                delete(TestCommandORM).where(TestCommandORM.id == command_id)
            )
            await session.commit()
            
            return result.rowcount > 0

    # ========== File Tags ==========

    async def create_file_tag(
        self,
        tag: str,
        color: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> dict:
        """Create a new file tag."""
        tag_id = str(uuid.uuid4())[:32]
        
        async with async_session() as session:
            orm = FileTagORM(
                id=tag_id,
                user_id=user_id,
                tag=tag,
                color=color or "#000000",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            
            return {
                "id": orm.id,
                "user_id": orm.user_id,
                "tag": orm.tag,
                "color": orm.color,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def list_file_tags(self, user_id: Optional[str] = None) -> List[dict]:
        """List all file tags."""
        async with async_session() as session:
            query = select(FileTagORM).order_by(FileTagORM.tag)
            
            if user_id:
                query = query.where(
                    (FileTagORM.user_id == user_id) | (FileTagORM.user_id.is_(None))
                )
            
            result = await session.execute(query)
            tags = result.scalars().all()
            
            return [
                {
                    "id": t.id,
                    "user_id": t.user_id,
                    "tag": t.tag,
                    "color": t.color,
                    "created_at": t.created_at.isoformat() + "Z",
                    "updated_at": t.updated_at.isoformat() + "Z",
                }
                for t in tags
            ]

    async def get_file_tag(self, tag_id: str) -> Optional[dict]:
        """Get a specific file tag."""
        async with async_session() as session:
            result = await session.execute(
                select(FileTagORM).where(FileTagORM.id == tag_id)
            )
            orm = result.scalar_one_or_none()
            
            if not orm:
                return None
            
            return {
                "id": orm.id,
                "user_id": orm.user_id,
                "tag": orm.tag,
                "color": orm.color,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def update_file_tag(
        self,
        tag_id: str,
        tag: Optional[str] = None,
        color: Optional[str] = None,
    ) -> bool:
        """Update a file tag."""
        async with async_session() as session:
            values = {"updated_at": datetime.utcnow()}
            if tag is not None:
                values["tag"] = tag
            if color is not None:
                values["color"] = color
            
            result = await session.execute(
                update(FileTagORM).where(FileTagORM.id == tag_id).values(**values)
            )
            await session.commit()
            
            return result.rowcount > 0

    async def delete_file_tag(self, tag_id: str) -> bool:
        """Delete a file tag."""
        async with async_session() as session:
            result = await session.execute(
                delete(FileTagORM).where(FileTagORM.id == tag_id)
            )
            await session.commit()
            
            return result.rowcount > 0


test_command_store = TestCommandStore()
