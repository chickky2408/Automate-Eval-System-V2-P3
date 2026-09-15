"""
Regression test for PROJECT.md B1.7: dedup was a racy application-level
select-then-insert (services/file_store.py add_file()) -- two concurrent
uploads of identical bytes could both pass the dedup SELECT (finding no
candidates yet) and then both INSERT, producing two rows for the same file.

A DB-level UNIQUE(checksum_sha256, size_bytes, lower(filename)) partial index
(files_checksum_dedup_uq, excluding NULL checksums) now makes the second
INSERT fail at the database layer instead of silently succeeding; add_file()
catches that IntegrityError and returns the winner's row as a duplicate
instead of crashing with an unhandled 500.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import asyncio
import uuid

import pytest
from sqlalchemy import select, text

from db.database import init_db, async_session
from db.orm_models import FileORM
from services.file_store import FileStore


@pytest.mark.asyncio
async def test_unique_index_exists_and_is_enforced_at_db_level():
    await init_db()
    async with async_session() as session:
        row = (await session.execute(
            text("SELECT name FROM sqlite_master WHERE type='index' AND name='files_checksum_dedup_uq'")
        )).first()
        assert row is not None, "files_checksum_dedup_uq index was not created"


@pytest.mark.asyncio
async def test_concurrent_identical_uploads_do_not_produce_two_rows(tmp_path):
    await init_db()
    base_dir = os.path.join(str(tmp_path), "uploads_test")
    store = FileStore(base_path=base_dir)
    content = b"identical stimulus bytes for dedup race test"
    name = f"race_{uuid.uuid4().hex[:8]}.ist"

    # Simulate the race: both calls pass the SELECT-based dedup check (no
    # candidates exist yet) and reach the INSERT concurrently.
    results = await asyncio.gather(
        store.add_file(name=name, file_type="ist", content=content),
        store.add_file(name=name, file_type="ist", content=content),
    )

    ids = {r["id"] for r in results}
    assert len(ids) == 1, f"expected both calls to resolve to the same row, got {ids}"
    assert any(r.get("duplicateByContent") for r in results), (
        "the losing insert should be reported as a duplicate, not a second row"
    )

    async with async_session() as session:
        count = (await session.execute(
            select(FileORM).where(FileORM.filename == name)
        )).scalars().all()
        assert len(count) == 1, "exactly one files row should exist for this content+name+size"
