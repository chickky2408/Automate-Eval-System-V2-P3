"""
PROJECT.md B1.7, verified against real Postgres via docker (2026-09-16).

test_file_dedup_unique_index.py hardcodes USE_SQLITE_DEMO=1 and was only ever
proven against SQLite. The concurrent-insert race it guards against depends on
the specific exception the database driver raises -- asyncpg raises
UniqueViolationError (wrapped by SQLAlchemy as IntegrityError, same as
SQLite's driver), and file_store.add_file()'s except clause catches
IntegrityError generically, but that equivalence was assumed, not checked.
This file re-runs the same scenario against the project's docker-compose
Postgres to confirm it holds on the engine that actually ships to production.

Run this file on its own: `python -m pytest tests/test_file_dedup_unique_index_postgres.py -q`.
Every test file in this directory sets `USE_SQLITE_DEMO` at module import
time, and db/database.py's engine is built once from whatever that variable
says at first import -- mixing this file into a whole-suite `pytest` run does
not reliably exercise Postgres. See test_postgres_flush_order.py's docstring
for the full explanation (confirmed empirically, not theoretical).
"""
import os
import socket
import uuid

import pytest

os.environ["USE_SQLITE_DEMO"] = "0"


def _postgres_reachable() -> bool:
    host = os.getenv("DB_HOST", "localhost")
    port = int(os.getenv("DB_PORT", "5433"))
    try:
        with socket.create_connection((host, port), timeout=1.5):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _postgres_reachable(),
    reason="No Postgres reachable at DB_HOST:DB_PORT -- start docker-compose's db "
           "service to run this. Skipped by default in sandboxed dev environments.",
)


@pytest.fixture(autouse=True)
def _engine_dispose_marker():
    # See test_postgres_flush_order.py's fixture for why this matters when a
    # file has more than one real-Postgres async test -- kept as sync fixture
    # here since disposal happens in the async body of each test below
    # (only one such test in this file, so no cross-test pool reuse issue).
    yield


@pytest.mark.asyncio
async def test_unique_index_exists_on_postgres():
    from db.database import init_db, async_session, engine
    from sqlalchemy import text

    await init_db()
    async with async_session() as session:
        row = (await session.execute(
            text("SELECT indexname FROM pg_indexes WHERE tablename='files' "
                 "AND indexname='files_checksum_dedup_uq'")
        )).first()
        assert row is not None, "files_checksum_dedup_uq index was not created on Postgres"
    await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_identical_uploads_do_not_produce_two_rows_on_postgres(tmp_path):
    import asyncio
    from sqlalchemy import select
    from db.database import init_db, async_session, engine
    from db.orm_models import FileORM
    from services.file_store import FileStore

    await init_db()
    base_dir = os.path.join(str(tmp_path), "uploads_test_pg")
    store = FileStore(base_path=base_dir)
    content = b"identical stimulus bytes for postgres dedup race test"
    name = f"race_pg_{uuid.uuid4().hex[:8]}.ist"

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
        rows = (await session.execute(
            select(FileORM).where(FileORM.filename == name)
        )).scalars().all()
        assert len(rows) == 1, "exactly one files row should exist for this content+name+size"

    await engine.dispose()
