import unittest

from routers import files


class _FileStore:
    def __init__(self, files_list):
        self._files = files_list

    async def list_files(self):
        return self._files


class _TestCaseStore:
    def __init__(self, referenced_ids):
        self._referenced = set(referenced_ids)

    async def get_referenced_file_ids(self):
        return self._referenced


def _lib_file(fid, name):
    return {
        "id": fid,
        "name": name,
        "size": 10,
        "type": "VCD",
        "uploadDate": "2026-06-16T00:00:00Z",
        "ownerId": None,
    }


class TestUnreferencedFilesReport(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._orig_store = files.file_store
        self._orig_tc = files.test_case_store

    def tearDown(self):
        files.file_store = self._orig_store
        files.test_case_store = self._orig_tc

    async def test_referenced_file_excluded_unreferenced_included(self):
        files.file_store = _FileStore(
            [_lib_file("used-1", "used.vcd"), _lib_file("free-1", "free.vcd")]
        )
        files.test_case_store = _TestCaseStore({"used-1"})

        report = await files.get_unreferenced_files()

        ids = [f["id"] for f in report]
        self.assertIn("free-1", ids)
        self.assertNotIn("used-1", ids)

    async def test_non_library_types_excluded(self):
        waveform = _lib_file("wf-1", "result.h5")
        waveform["type"] = "WAVEFORM"
        files.file_store = _FileStore([waveform])
        files.test_case_store = _TestCaseStore(set())

        report = await files.get_unreferenced_files()

        self.assertEqual(report, [])


if __name__ == "__main__":
    unittest.main()
