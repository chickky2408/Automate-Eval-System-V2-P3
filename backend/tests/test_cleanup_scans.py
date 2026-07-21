import os
import unittest
import uuid

os.environ.setdefault("USE_SQLITE_DEMO", "1")

from sqlalchemy import delete as sa_delete

from db.database import async_session, init_db
from db.orm_models import FileORM, FileType, TestCaseORM, DeletionCandidateORM
from services.file_store import file_store
from services.test_case_store import test_case_store


async def _clean():
    async with async_session() as s:
        await s.execute(sa_delete(DeletionCandidateORM))
        await s.execute(sa_delete(TestCaseORM))
        await s.execute(sa_delete(FileORM))
        await s.commit()


async def _add_file(fid, name, storage_path, ftype=FileType.VCD):
    async with async_session() as s:
        s.add(FileORM(id=fid, filename=name, file_type=ftype,
                      storage_path=storage_path, checksum_sha256="x", size_bytes=1))
        await s.commit()


class TestCleanupScans(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await init_db()
        await _clean()

    async def asyncTearDown(self):
        await _clean()

    async def test_scan_missing_flags_only_absent_disk_files(self):
        here = os.path.abspath(__file__)
        await _add_file("present-1", "here.vcd", here)
        await _add_file("gone-1", "gone.vcd", "uploads/does-not-exist-xyz.vcd")

        res = await file_store.scan_missing_files()
        staged_ids = {c.get("file_id") for c in
                      await file_store.get_deletion_candidates_raw()}
        self.assertIn("gone-1", staged_ids)
        self.assertNotIn("present-1", staged_ids)
        self.assertEqual(res["registered"], 1)

    async def test_stage_unreferenced_flags_only_unlinked(self):
        await _add_file("used-1", "used.vcd", "uploads/used.vcd")
        await _add_file("free-1", "free.vcd", "uploads/free.vcd")
        async with async_session() as s:
            s.add(TestCaseORM(id=str(uuid.uuid4()), name="TC", vcd_file_id="used-1"))
            await s.commit()

        referenced = await test_case_store.get_referenced_file_ids()
        res = await file_store.stage_unreferenced_files(referenced)
        staged_ids = {c.get("file_id") for c in
                      await file_store.get_deletion_candidates_raw()}
        self.assertIn("free-1", staged_ids)
        self.assertNotIn("used-1", staged_ids)
        self.assertEqual(res["registered"], 1)


if __name__ == "__main__":
    unittest.main()
