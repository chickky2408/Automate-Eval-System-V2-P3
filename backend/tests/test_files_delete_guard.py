import unittest

from fastapi import HTTPException

from routers import files


class _FileStore:
    def __init__(self, deleted):
        self._deleted = deleted

    async def get_file(self, file_id):
        return {"id": file_id, "name": "case.vcd", "ownerId": None}

    async def delete_file(self, file_id):
        # Hard delete -- exercised via ?force=true, not the default path.
        self._deleted.append(file_id)
        return True

    async def soft_delete_file(self, file_id):
        # PROJECT.md B1.8: DELETE /api/files/{id} now soft-deletes by default.
        self._deleted.append(file_id)
        return True


class _TestCaseStore:
    def __init__(self, refs):
        self._refs = refs

    async def find_test_cases_referencing_file(self, file_id):
        return self._refs


class TestDeleteFileParentGuard(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._orig_store = files.file_store
        self._orig_tc = files.test_case_store
        self._orig_in_use = files._file_names_in_use_by_active_jobs

        async def _no_active_jobs():
            return set()

        files._file_names_in_use_by_active_jobs = _no_active_jobs

    def tearDown(self):
        files.file_store = self._orig_store
        files.test_case_store = self._orig_tc
        files._file_names_in_use_by_active_jobs = self._orig_in_use

    async def test_delete_blocked_when_referenced_by_test_case(self):
        deleted = []
        files.file_store = _FileStore(deleted)
        files.test_case_store = _TestCaseStore(
            [{"id": "tc-1", "name": "Smoke Case", "field": "vcd_file_id"}]
        )

        with self.assertRaises(HTTPException) as ctx:
            await files.delete_file("f1")

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Smoke Case", ctx.exception.detail)
        self.assertEqual(deleted, [])  # file not deleted

    async def test_delete_allowed_when_no_reference(self):
        deleted = []
        files.file_store = _FileStore(deleted)
        files.test_case_store = _TestCaseStore([])

        result = await files.delete_file("f1")

        # PROJECT.md B1.8: default delete is soft (hardDeleted: False), not the
        # hard delete this test originally asserted.
        self.assertEqual(result, {"success": True, "hardDeleted": False})
        self.assertEqual(deleted, ["f1"])


if __name__ == "__main__":
    unittest.main()
