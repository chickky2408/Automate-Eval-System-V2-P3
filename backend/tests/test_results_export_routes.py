import unittest

from fastapi import HTTPException

from routers import results


class TestResultsExportRoutes(unittest.IsolatedAsyncioTestCase):
    async def test_export_rejects_invalid_format(self):
        with self.assertRaises(HTTPException) as ctx:
            await results.export_result_file("missing-result", format="pdf")

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Unsupported export format", ctx.exception.detail)

    async def test_preview_returns_404_when_waveform_missing(self):
        original = results.result_store

        class MissingStore:
            async def get_waveform_path(self, result_id):
                return None

        results.result_store = MissingStore()
        try:
            with self.assertRaises(HTTPException) as ctx:
                await results.preview_result_waveform("missing-result")
        finally:
            results.result_store = original

        self.assertEqual(ctx.exception.status_code, 404)

    async def test_export_bin_format_rejected(self):
        # PROJECT.md B5.6: "bin" was accepted but the raw capture .bin is
        # purged right after ingest -- format=bin either silently returned the
        # LZ4 file mislabeled with a .bin filename, or 404'd. Removed from the
        # whitelist entirely; LZ4 is the real raw-capture download.
        with self.assertRaises(HTTPException) as ctx:
            await results.export_result_file("missing-result", format="bin")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Unsupported export format", ctx.exception.detail)

    async def test_export_lz4_format_accepted(self):
        original = results.result_store

        class MissingStore:
            async def get_waveform_path(self, result_id):
                return None

        results.result_store = MissingStore()
        try:
            with self.assertRaises(HTTPException) as ctx:
                await results.export_result_file("missing-result", format="lz4")
            # Should fail with 404 (not found), NOT 400 (unsupported format)
            self.assertEqual(ctx.exception.status_code, 404)
        finally:
            results.result_store = original


if __name__ == "__main__":
    unittest.main()
