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


if __name__ == "__main__":
    unittest.main()
