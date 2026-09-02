"""
Test Case and Run Set Store Service with Database persistence (Redesigned).
"""
from __future__ import annotations
from typing import List, Optional
from datetime import datetime
import uuid

from sqlalchemy import select, update, delete, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import TestCaseORM, RunSetORM
from models.test_case import TestCaseCreate, RunSetCreate

class TestCaseStore:
    """Manages test cases and run sets (suites) with database persistence."""

    def _tc_orm_to_dict(self, orm: TestCaseORM) -> dict:
        return {
            "id": orm.id,
            "name": orm.name,
            "vcd_file_id": orm.vcd_file_id,
            "bin_file_id": orm.bin_file_id,
            "lin_file_id": orm.lin_file_id,
            "mdi_file_id": orm.mdi_file_id,
            "owner_id": orm.owner_id,
            "config_options": orm.config_options,
            "created_at": orm.created_at.isoformat() + "Z",
            # compatibility fields
            "tags": "",
            "firmware_filename": "",
            "updated_at": orm.created_at.isoformat() + "Z",
        }

    def _run_set_orm_to_dict(self, orm: RunSetORM) -> dict:
        return {
            "id": orm.id,
            "name": orm.name,
            "owner_id": orm.owner_id,
            "test_case_ids": orm.test_case_ids or [],
            "created_at": orm.created_at.isoformat() + "Z",
            # compatibility fields
            "tags": "",
            "updated_at": orm.created_at.isoformat() + "Z",
        }

    # ========== Test Cases ==========

    async def create_test_case(self, data: TestCaseCreate, owner_id: Optional[str] = None) -> dict:
        """Create a new test case."""
        test_case_id = str(uuid.uuid4())
        
        async with async_session() as session:
            orm = TestCaseORM(
                id=test_case_id,
                name=data.name,
                vcd_file_id=data.vcd_file_id,
                bin_file_id=data.bin_file_id,
                lin_file_id=data.lin_file_id,
                mdi_file_id=data.mdi_file_id,
                owner_id=owner_id,
                config_options=data.config_options or {},
                created_at=datetime.utcnow(),
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            return self._tc_orm_to_dict(orm)

    async def list_test_cases(self) -> List[dict]:
        """List all test cases."""
        async with async_session() as session:
            result = await session.execute(select(TestCaseORM))
            test_cases = result.scalars().all()
            return [self._tc_orm_to_dict(tc) for tc in test_cases]

    async def find_test_cases_referencing_file(self, file_id: str) -> List[dict]:
        """Find test cases that reference a given file id in any of their file slots.

        Returns a list of {"id", "name", "field"} where field is the slot that
        references the file (vcd_file_id/bin_file_id/lin_file_id/mdi_file_id).
        Used as a reverse (parent) lookup to guard file deletion.
        """
        if not file_id:
            return []
        async with async_session() as session:
            result = await session.execute(
                select(TestCaseORM).where(
                    or_(
                        TestCaseORM.vcd_file_id == file_id,
                        TestCaseORM.bin_file_id == file_id,
                        TestCaseORM.lin_file_id == file_id,
                        TestCaseORM.mdi_file_id == file_id,
                    )
                )
            )
            references: List[dict] = []
            for tc in result.scalars().all():
                if tc.vcd_file_id == file_id:
                    field = "vcd_file_id"
                elif tc.bin_file_id == file_id:
                    field = "bin_file_id"
                elif tc.lin_file_id == file_id:
                    field = "lin_file_id"
                else:
                    field = "mdi_file_id"
                references.append({"id": tc.id, "name": tc.name, "field": field})
            return references

    async def get_referenced_file_ids(self) -> set:
        """Return the set of file ids referenced by any test case (any of the 4 slots).

        Aggregate inverse of ``find_test_cases_referencing_file``: one pass over all
        test cases, unioning the non-null vcd/bin/lin/mdi file id columns. Used to find
        library files that no test case references (unreferenced-file report).
        """
        referenced: set = set()
        async with async_session() as session:
            result = await session.execute(
                select(
                    TestCaseORM.vcd_file_id,
                    TestCaseORM.bin_file_id,
                    TestCaseORM.lin_file_id,
                    TestCaseORM.mdi_file_id,
                )
            )
            for vcd_id, bin_id, lin_id, mdi_id in result.all():
                for fid in (vcd_id, bin_id, lin_id, mdi_id):
                    if fid:
                        referenced.add(fid)
        return referenced

    async def get_test_case(self, test_case_id: str) -> Optional[dict]:
        """Get a specific test case."""
        async with async_session() as session:
            result = await session.execute(
                select(TestCaseORM).where(TestCaseORM.id == test_case_id)
            )
            orm = result.scalar_one_or_none()
            if not orm:
                return None
            return self._tc_orm_to_dict(orm)

    async def update_test_case(
        self, test_case_id: str, name: Optional[str] = None,
        vcd_file_id: Optional[str] = None, bin_file_id: Optional[str] = None,
        lin_file_id: Optional[str] = None, mdi_file_id: Optional[str] = None,
        config_options: Optional[dict] = None,
    ) -> bool:
        """Update a test case."""
        async with async_session() as session:
            values = {}
            if name is not None:
                values["name"] = name
            if vcd_file_id is not None:
                values["vcd_file_id"] = vcd_file_id
            if bin_file_id is not None:
                values["bin_file_id"] = bin_file_id
            if lin_file_id is not None:
                values["lin_file_id"] = lin_file_id
            if mdi_file_id is not None:
                values["mdi_file_id"] = mdi_file_id
            if config_options is not None:
                values["config_options"] = config_options
            
            if not values:
                return True

            result = await session.execute(
                update(TestCaseORM).where(TestCaseORM.id == test_case_id).values(**values)
            )
            await session.commit()
            return result.rowcount > 0

    async def delete_test_case(self, test_case_id: str) -> bool:
        """Delete a test case."""
        async with async_session() as session:
            # Check and clean references in RunSets
            sets = await session.execute(select(RunSetORM))
            for run_set in sets.scalars().all():
                items = run_set.test_case_ids or []
                filtered = [item for item in items if item.get("test_case_id") != test_case_id]
                if len(filtered) != len(items):
                    run_set.test_case_ids = filtered

            result = await session.execute(
                delete(TestCaseORM).where(TestCaseORM.id == test_case_id)
            )
            await session.commit()
            return result.rowcount > 0

    # ========== Run Sets (previously Test Suites) ==========

    async def create_run_set(self, data: RunSetCreate, owner_id: Optional[str] = None) -> dict:
        """Create a new run set."""
        run_set_id = str(uuid.uuid4())
        async with async_session() as session:
            orm = RunSetORM(
                id=run_set_id,
                name=data.name,
                owner_id=owner_id,
                test_case_ids=data.test_case_ids or [],
                created_at=datetime.utcnow(),
            )
            session.add(orm)
            await session.commit()
            await session.refresh(orm)
            return self._run_set_orm_to_dict(orm)

    async def list_run_sets(self) -> List[dict]:
        """List all run sets."""
        async with async_session() as session:
            result = await session.execute(select(RunSetORM))
            run_sets = result.scalars().all()
            return [self._run_set_orm_to_dict(rs) for rs in run_sets]

    async def get_run_set(self, run_set_id: str) -> Optional[dict]:
        """Get a specific run set."""
        async with async_session() as session:
            result = await session.execute(
                select(RunSetORM).where(RunSetORM.id == run_set_id)
            )
            orm = result.scalar_one_or_none()
            if not orm:
                return None
            return self._run_set_orm_to_dict(orm)

    async def update_run_set(
        self, run_set_id: str, name: Optional[str] = None, test_case_ids: Optional[list] = None
    ) -> bool:
        """Update a run set."""
        async with async_session() as session:
            values = {}
            if name is not None:
                values["name"] = name
            if test_case_ids is not None:
                values["test_case_ids"] = test_case_ids
            
            if not values:
                return True

            result = await session.execute(
                update(RunSetORM).where(RunSetORM.id == run_set_id).values(**values)
            )
            await session.commit()
            return result.rowcount > 0

    async def delete_run_set(self, run_set_id: str) -> bool:
        """Delete a run set."""
        async with async_session() as session:
            result = await session.execute(
                delete(RunSetORM).where(RunSetORM.id == run_set_id)
            )
            await session.commit()
            return result.rowcount > 0

    # ========== Orphaned Test Cases Search (Point 4) ==========

    async def get_orphaned_test_cases(self) -> List[dict]:
        """Find orphan test cases that have no run history (no results) and are not linked to any RunSet."""
        async with async_session() as session:
            # 1. Load all test case IDs
            q_tc = select(TestCaseORM)
            res_tc = await session.execute(q_tc)
            all_tcs = res_tc.scalars().all()

            # 2. Load all RunSets to scan test_case_ids
            q_rs = select(RunSetORM.test_case_ids)
            res_rs = await session.execute(q_rs)
            linked_ids = set()
            for row in res_rs.all():
                items = row[0] or []
                for item in items:
                    tid = item.get("test_case_id")
                    if tid:
                        linked_ids.add(tid)

            # 3. Import results dynamically to check execution history (results table)
            from db.orm_models import ResultORM
            q_res = select(ResultORM.test_case_id).distinct()
            res_r = await session.execute(q_res)
            result_ids = {row[0] for row in res_r.all() if row[0]}

            # Filter orphans
            orphans = []
            for tc in all_tcs:
                if tc.id not in linked_ids and tc.id not in result_ids:
                    orphans.append(self._tc_orm_to_dict(tc))
            return orphans

    # ========== Legacy compatibility methods for TestSets (Suites) ==========

    async def create_test_set(self, data: any, owner_id: Optional[str] = None) -> dict:
        rs_create = RunSetCreate(name=data.name, test_case_ids=[])
        return await self.create_run_set(rs_create, owner_id)

    async def list_test_sets(self) -> List[dict]:
        return await self.list_run_sets()

    async def get_test_set(self, test_set_id: str) -> Optional[dict]:
        return await self.get_run_set(test_set_id)

    async def update_test_set(self, test_set_id: str, name: Optional[str] = None, tags: Optional[str] = None) -> bool:
        return await self.update_run_set(test_set_id, name=name)

    async def delete_test_set(self, test_set_id: str) -> bool:
        return await self.delete_run_set(test_set_id)

    # ========== Legacy compatibility methods for Test Set Items ==========

    async def add_test_case_to_set(self, test_set_id: str, test_case_id: str, execution_order: int) -> dict:
        """Add a test case to a run set under the hood."""
        async with async_session() as session:
            result = await session.execute(select(RunSetORM).where(RunSetORM.id == test_set_id))
            rs = result.scalar_one_or_none()
            if not rs:
                raise ValueError("Run set not found")

            items = list(rs.test_case_ids or [])
            item_uuid = str(uuid.uuid4())[:32]
            
            # Check if already exists, otherwise add
            new_item = {
                "id": item_uuid,
                "test_case_id": test_case_id,
                "try_count": 1, # default retry count
                "execution_order": execution_order
            }
            items.append(new_item)
            rs.test_case_ids = items
            await session.commit()
            
            return {
                "id": item_uuid,
                "test_set_id": test_set_id,
                "test_case_id": test_case_id,
                "execution_order": execution_order,
                "created_at": datetime.utcnow().isoformat() + "Z"
            }

    async def list_test_set_items(self, test_set_id: str) -> List[dict]:
        """List items inside a run set formatted as legacy test set items."""
        rs = await self.get_run_set(test_set_id)
        if not rs:
            return []
        
        items = rs.get("test_case_ids") or []
        # Sort by execution order
        sorted_items = sorted(items, key=lambda x: x.get("execution_order", 0))
        
        out = []
        for it in sorted_items:
            out.append({
                "id": it.get("id") or str(uuid.uuid4())[:32],
                "test_set_id": test_set_id,
                "test_case_id": it.get("test_case_id"),
                "execution_order": it.get("execution_order", 0),
                "created_at": datetime.utcnow().isoformat() + "Z"
            })
        return out

    async def remove_test_case_from_set(self, test_set_id: str, test_case_id: str) -> bool:
        """Remove a test case from the run set list."""
        async with async_session() as session:
            result = await session.execute(select(RunSetORM).where(RunSetORM.id == test_set_id))
            rs = result.scalar_one_or_none()
            if not rs:
                return False

            items = list(rs.test_case_ids or [])
            filtered = [it for it in items if it.get("test_case_id") != test_case_id]
            if len(filtered) == len(items):
                return False
            
            rs.test_case_ids = filtered
            await session.commit()
            return True

    async def update_test_case_order(self, test_set_id: str, test_case_id: str, new_order: int) -> bool:
        """Update the order of a test case inside the run set JSON list."""
        async with async_session() as session:
            result = await session.execute(select(RunSetORM).where(RunSetORM.id == test_set_id))
            rs = result.scalar_one_or_none()
            if not rs:
                return False

            items = list(rs.test_case_ids or [])
            updated = False
            for it in items:
                if it.get("test_case_id") == test_case_id:
                    it["execution_order"] = new_order
                    updated = True
            
            if not updated:
                return False

            rs.test_case_ids = items
            session.add(rs)
            await session.commit()
            return True

test_case_store = TestCaseStore()
