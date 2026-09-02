import os
import tempfile
import unittest
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import services.file_store as file_store_module
from db.database import Base
from services.file_store import FileStore


class FileStoreScannerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.uploads = self.root / "uploads"
        self.db_path = self.root / "test.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{self.db_path}", future=True)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)
        self.original_session = file_store_module.async_session
        file_store_module.async_session = self.sessionmaker
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self):
        file_store_module.async_session = self.original_session
        await self.engine.dispose()
        self.tempdir.cleanup()

    async def test_scan_orphaned_files_registers_only_untracked_disk_files(self):
        store = FileStore(base_path=str(self.uploads))
        registered = await store.add_file(
            name="tracked.vcd",
            file_type="VCD",
            content=b"tracked-content",
            force_new=True,
        )
        orphan_dir = self.uploads / "VCD" / "2026" / "06"
        orphan_dir.mkdir(parents=True, exist_ok=True)
        orphan_path = orphan_dir / "orphan.vcd"
        orphan_path.write_bytes(b"orphan-content")

        summary = await store.scan_orphaned_files()

        self.assertGreaterEqual(summary["scanned"], 2)
        self.assertEqual(summary["registered"], 1)
        self.assertEqual(summary["candidates"][0]["filename"], "orphan.vcd")
        self.assertTrue(summary["candidates"][0]["storage_path"].replace("\\", "/").endswith("orphan.vcd"))
        candidates = await store.get_deletion_candidates()
        self.assertEqual([c["filename"] for c in candidates], ["orphan.vcd"])
        self.assertTrue(os.path.exists(store.resolve_path(registered["path"])))
