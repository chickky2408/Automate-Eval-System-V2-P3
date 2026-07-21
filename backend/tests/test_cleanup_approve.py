import os
import unittest
import uuid

os.environ.setdefault("USE_SQLITE_DEMO", "1")

from fastapi import HTTPException
from sqlalchemy import delete as sa_delete

from db.database import async_session, init_db
from db.orm_models import FileORM, FileType, TestCaseORM, DeletionCandidateORM
from services.file_store import file_store
from services.test_case_store import test_case_store
from routers import files


async def _clean():
    async with async_session() as s:
        await s.execute(sa_delete(DeletionCandidateORM))
        await s.execute(sa_delete(TestCaseORM))
        await s.execute(sa_delete(FileORM))
        await s.commit()


class TestApproveReverify(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await init_db()
        await _clean()

    async def asyncTearDown(self):
        await _clean()

    async def test_approve_blocked_when_now_referenced(self):
        async with async_session() as s:
            s.add(FileORM(id="f-1", filename="f.vcd", file_type=FileType.VCD,
                          storage_path="uploads/f.vcd", checksum_sha256="x", size_bytes=1))
            await s.commit()
        cand = await file_store.register_deletion_candidate(
            filename="f.vcd", storage_path="uploads/f.vcd", checksum="x",
            size_bytes=1, reason="unreferenced_file", file_id="f-1",
        )
        async with async_session() as s:
            s.add(TestCaseORM(id=str(uuid.uuid4()), name="Late TC", vcd_file_id="f-1"))
            await s.commit()

        with self.assertRaises(HTTPException) as ctx:
            await files.approve_deletion_candidate(cand["id"])
        self.assertEqual(ctx.exception.status_code, 409)

        async with async_session() as s:
            from sqlalchemy import select
            row = (await s.execute(select(FileORM).where(FileORM.id == "f-1"))).scalar_one_or_none()
        self.assertIsNotNone(row)

    async def test_approve_deletes_when_still_unreferenced(self):
        async with async_session() as s:
            s.add(FileORM(id="f-2", filename="g.vcd", file_type=FileType.VCD,
                          storage_path="uploads/g-not-on-disk.vcd", checksum_sha256="x", size_bytes=1))
            await s.commit()
        cand = await file_store.register_deletion_candidate(
            filename="g.vcd", storage_path="uploads/g-not-on-disk.vcd", checksum="x",
            size_bytes=1, reason="unreferenced_file", file_id="f-2",
        )
        result = await files.approve_deletion_candidate(cand["id"])
        self.assertEqual(result, {"success": True})
        async with async_session() as s:
            from sqlalchemy import select
            row = (await s.execute(select(FileORM).where(FileORM.id == "f-2"))).scalar_one_or_none()
        self.assertIsNone(row)


if __name__ == "__main__":
    unittest.main()
