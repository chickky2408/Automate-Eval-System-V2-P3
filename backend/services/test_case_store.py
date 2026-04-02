"""
Test Case and Test Set Service with Database persistence.
"""
from __future__ import annotations

from typing import List, Optional
from datetime import datetime
import uuid

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import TestCaseORM, TestSetORM, TestSetItemORM
from models.test_case import TestCaseCreate, TestSetCreate, TestSetItemCreate


class TestCaseStore:
    """Manages test cases and test sets with database persistence."""

    # ========== Test Cases ==========

    async def create_test_case(self, data: TestCaseCreate) -> dict:
        """Create a new test case."""
        test_case_id = str(uuid.uuid4())[:32]
        
        async with async_session() as session:
            orm = TestCaseORM(
                id=test_case_id,
                name=data.name,
                vcd_file_id=data.vcd_file_id,
                firmware_filename=data.firmware_filename,
                tags=data.tags,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            
            return {
                "id": orm.id,
                "name": orm.name,
                "vcd_file_id": orm.vcd_file_id,
                "firmware_filename": orm.firmware_filename,
                "tags": orm.tags,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def list_test_cases(self) -> List[dict]:
        """List all test cases."""
        async with async_session() as session:
            result = await session.execute(select(TestCaseORM))
            test_cases = result.scalars().all()
            
            return [
                {
                    "id": tc.id,
                    "name": tc.name,
                    "vcd_file_id": tc.vcd_file_id,
                    "firmware_filename": tc.firmware_filename,
                    "tags": tc.tags,
                    "created_at": tc.created_at.isoformat() + "Z",
                    "updated_at": tc.updated_at.isoformat() + "Z",
                }
                for tc in test_cases
            ]

    async def get_test_case(self, test_case_id: str) -> Optional[dict]:
        """Get a specific test case."""
        async with async_session() as session:
            result = await session.execute(
                select(TestCaseORM).where(TestCaseORM.id == test_case_id)
            )
            orm = result.scalar_one_or_none()
            
            if not orm:
                return None
            
            return {
                "id": orm.id,
                "name": orm.name,
                "vcd_file_id": orm.vcd_file_id,
                "firmware_filename": orm.firmware_filename,
                "tags": orm.tags,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def update_test_case(
        self, test_case_id: str, name: Optional[str] = None,
        vcd_file_id: Optional[str] = None, firmware_filename: Optional[str] = None,
        tags: Optional[str] = None,
    ) -> bool:
        """Update a test case."""
        async with async_session() as session:
            values = {"updated_at": datetime.utcnow()}
            if name is not None:
                values["name"] = name
            if vcd_file_id is not None:
                values["vcd_file_id"] = vcd_file_id
            if firmware_filename is not None:
                values["firmware_filename"] = firmware_filename
            if tags is not None:
                values["tags"] = tags
            
            result = await session.execute(
                update(TestCaseORM).where(TestCaseORM.id == test_case_id).values(**values)
            )
            await session.commit()
            
            return result.rowcount > 0

    async def delete_test_case(self, test_case_id: str) -> bool:
        """Delete a test case."""
        async with async_session() as session:
            result = await session.execute(
                delete(TestCaseORM).where(TestCaseORM.id == test_case_id)
            )
            await session.commit()
            
            return result.rowcount > 0

    # ========== Test Sets ==========

    async def create_test_set(self, data: TestSetCreate) -> dict:
        """Create a new test set."""
        test_set_id = str(uuid.uuid4())[:32]
        
        async with async_session() as session:
            orm = TestSetORM(
                id=test_set_id,
                name=data.name,
                tags=data.tags,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            
            return {
                "id": orm.id,
                "name": orm.name,
                "tags": orm.tags,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def list_test_sets(self) -> List[dict]:
        """List all test sets."""
        async with async_session() as session:
            result = await session.execute(select(TestSetORM))
            test_sets = result.scalars().all()
            
            return [
                {
                    "id": ts.id,
                    "name": ts.name,
                    "tags": ts.tags,
                    "created_at": ts.created_at.isoformat() + "Z",
                    "updated_at": ts.updated_at.isoformat() + "Z",
                }
                for ts in test_sets
            ]

    async def get_test_set(self, test_set_id: str) -> Optional[dict]:
        """Get a specific test set."""
        async with async_session() as session:
            result = await session.execute(
                select(TestSetORM).where(TestSetORM.id == test_set_id)
            )
            orm = result.scalar_one_or_none()
            
            if not orm:
                return None
            
            return {
                "id": orm.id,
                "name": orm.name,
                "tags": orm.tags,
                "created_at": orm.created_at.isoformat() + "Z",
                "updated_at": orm.updated_at.isoformat() + "Z",
            }

    async def update_test_set(
        self, test_set_id: str, name: Optional[str] = None, tags: Optional[str] = None,
    ) -> bool:
        """Update a test set."""
        async with async_session() as session:
            values = {"updated_at": datetime.utcnow()}
            if name is not None:
                values["name"] = name
            if tags is not None:
                values["tags"] = tags
            
            result = await session.execute(
                update(TestSetORM).where(TestSetORM.id == test_set_id).values(**values)
            )
            await session.commit()
            
            return result.rowcount > 0

    async def delete_test_set(self, test_set_id: str) -> bool:
        """Delete a test set."""
        async with async_session() as session:
            # First delete all items in the set
            await session.execute(
                delete(TestSetItemORM).where(TestSetItemORM.test_set_id == test_set_id)
            )
            # Then delete the set itself
            result = await session.execute(
                delete(TestSetORM).where(TestSetORM.id == test_set_id)
            )
            await session.commit()
            
            return result.rowcount > 0

    # ========== Test Set Items ==========

    async def add_test_case_to_set(
        self, test_set_id: str, test_case_id: str, execution_order: int,
    ) -> dict:
        """Add a test case to a test set."""
        item_id = str(uuid.uuid4())[:32]
        
        async with async_session() as session:
            orm = TestSetItemORM(
                id=item_id,
                test_set_id=test_set_id,
                test_case_id=test_case_id,
                execution_order=execution_order,
                created_at=datetime.utcnow(),
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            
            return {
                "id": orm.id,
                "test_set_id": orm.test_set_id,
                "test_case_id": orm.test_case_id,
                "execution_order": orm.execution_order,
                "created_at": orm.created_at.isoformat() + "Z",
            }

    async def list_test_set_items(self, test_set_id: str) -> List[dict]:
        """List all items in a test set."""
        async with async_session() as session:
            result = await session.execute(
                select(TestSetItemORM)
                .where(TestSetItemORM.test_set_id == test_set_id)
                .order_by(TestSetItemORM.execution_order)
            )
            items = result.scalars().all()
            
            return [
                {
                    "id": item.id,
                    "test_set_id": item.test_set_id,
                    "test_case_id": item.test_case_id,
                    "execution_order": item.execution_order,
                    "created_at": item.created_at.isoformat() + "Z",
                }
                for item in items
            ]

    async def remove_test_case_from_set(
        self, test_set_id: str, test_case_id: str,
    ) -> bool:
        """Remove a test case from a test set."""
        async with async_session() as session:
            result = await session.execute(
                delete(TestSetItemORM).where(
                    (TestSetItemORM.test_set_id == test_set_id) &
                    (TestSetItemORM.test_case_id == test_case_id)
                )
            )
            await session.commit()
            
            return result.rowcount > 0

    async def update_test_case_order(
        self, test_set_id: str, test_case_id: str, new_order: int,
    ) -> bool:
        """Update the execution order of a test case in a test set."""
        async with async_session() as session:
            result = await session.execute(
                update(TestSetItemORM)
                .where(
                    (TestSetItemORM.test_set_id == test_set_id) &
                    (TestSetItemORM.test_case_id == test_case_id)
                )
                .values(execution_order=new_order)
            )
            await session.commit()
            
            return result.rowcount > 0


test_case_store = TestCaseStore()
