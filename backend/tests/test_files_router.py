import unittest

from routers import files


class TestFilesRouter(unittest.IsolatedAsyncioTestCase):
    async def test_list_files_hides_waveform_result_files_from_library(self):
        original_store = files.file_store

        class Store:
            async def list_files(self):
                return [
                    {
                        "id": "vcd-1",
                        "name": "case.vcd",
                        "size": 10,
                        "type": "VCD",
                        "uploadDate": "2026-06-16T00:00:00Z",
                        "updatedAt": "2026-06-16T00:00:00Z",
                        "checksum": "a",
                        "ownerId": None,
                        "ownerDisplayName": None,
                        "visibility": "public",
                        "tags": None,
                        "tagColor": None,
                    },
                    {
                        "id": "waveform-1",
                        "name": "result_waveform.h5",
                        "size": 20,
                        "type": "WAVEFORM",
                        "uploadDate": "2026-06-16T00:00:00Z",
                        "updatedAt": "2026-06-16T00:00:00Z",
                        "checksum": "b",
                        "ownerId": None,
                        "ownerDisplayName": None,
                        "visibility": "public",
                        "tags": None,
                        "tagColor": None,
                    },
                ]

        files.file_store = Store()
        try:
            listed = await files.list_files()
        finally:
            files.file_store = original_store

        self.assertEqual([f["name"] for f in listed], ["case.vcd"])

    def test_classify_file_type_supports_ist_and_erom(self):
        from utils.file_type_utils import classify_file_type_from_filename
        self.assertEqual(classify_file_type_from_filename("instructions.ist"), "VCD")
        self.assertEqual(classify_file_type_from_filename("case_01.ist"), "VCD")
        self.assertEqual(classify_file_type_from_filename("firmware.erom"), "EROM")
        self.assertEqual(classify_file_type_from_filename("ddr.erom"), "EROM")


if __name__ == "__main__":
    unittest.main()
