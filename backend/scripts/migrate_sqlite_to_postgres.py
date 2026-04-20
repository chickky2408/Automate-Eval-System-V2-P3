"""
One-shot migration: copy all rows from the local SQLite demo DB into PostgreSQL.

Prerequisites
-------------
1. Postgres is running and reachable (e.g. `docker compose up -d db`).
2. `.env` has the correct DB_USER / DB_PASS / DB_HOST / DB_PORT / DB_NAME.
3. Source file is `backend/eval_system_demo.db` (override via --sqlite).

What it does
------------
* Opens two async engines — SQLite (source) and Postgres (target).
* Runs `init_db()` against Postgres to ensure all tables + migration ALTERs are applied.
* For every ORM table (in dependency order) it copies rows using INSERT ... ON CONFLICT DO NOTHING,
  so the script is re-runnable and safe if a partial migration happened before.
* Prints a summary of rows copied per table.

Run
---
    cd backend
    pipenv run python scripts/migrate_sqlite_to_postgres.py
    # or with a custom source file:
    pipenv run python scripts/migrate_sqlite_to_postgres.py --sqlite /path/to/old.db
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

# Make "backend/" importable when running this file directly
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select, inspect  # noqa: E402
from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402

# --- Force Postgres target regardless of env flag ---------------------------
os.environ["USE_SQLITE_DEMO"] = "0"

from db.database import Base, DATABASE_URL as PG_URL, init_db  # noqa: E402
from db import orm_models  # noqa: E402,F401 — ensures all models are registered on Base.metadata


# Dependency order — parents first so FK targets exist when we insert children.
MIGRATION_ORDER = [
    "boards",
    "profiles",
    "files",
    "jobs",
    "results",
    "test_cases",
    "test_sets",
    "test_set_items",
    "notifications",
    "test_commands",
    "file_tags",
    "job_files",
]


def _model_for_table(table_name: str):
    """Look up the ORM class bound to a table name."""
    for mapper in Base.registry.mappers:
        if mapper.class_.__tablename__ == table_name:
            return mapper.class_
    return None


async def _copy_table(
    table_name: str,
    src_session: AsyncSession,
    dst_session: AsyncSession,
) -> tuple[int, int]:
    """Copy rows from SQLite → Postgres for one table. Returns (read, inserted)."""
    model = _model_for_table(table_name)
    if model is None:
        print(f"  [SKIP] {table_name}: no ORM model found")
        return 0, 0

    # Read everything from SQLite
    rows = (await src_session.execute(select(model))).scalars().all()
    if not rows:
        return 0, 0

    pk_cols = [c.name for c in inspect(model).primary_key]
    if not pk_cols:
        print(f"  [SKIP] {table_name}: no primary key — cannot safely upsert")
        return len(rows), 0

    payloads = []
    for row in rows:
        payload = {}
        for col in model.__table__.columns:
            value = getattr(row, col.name)
            payload[col.name] = value
        payloads.append(payload)

    # INSERT ... ON CONFLICT DO NOTHING — idempotent re-runs.
    stmt = pg_insert(model.__table__).values(payloads)
    stmt = stmt.on_conflict_do_nothing(index_elements=pk_cols)
    result = await dst_session.execute(stmt)
    await dst_session.commit()
    inserted = result.rowcount if result.rowcount is not None else len(payloads)
    return len(rows), inserted


async def migrate(sqlite_path: Path) -> None:
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite file not found: {sqlite_path}")

    sqlite_url = f"sqlite+aiosqlite:///{sqlite_path}"
    print(f"[MIGRATE] Source:  {sqlite_url}")
    print(f"[MIGRATE] Target:  {PG_URL}")

    # Make sure the Postgres schema exists (runs create_all + ALTER migrations)
    print("[MIGRATE] Preparing Postgres schema (init_db)...")
    await init_db()

    src_engine = create_async_engine(sqlite_url, future=True)
    dst_engine = create_async_engine(PG_URL, future=True)

    SrcSession = async_sessionmaker(src_engine, class_=AsyncSession, expire_on_commit=False)
    DstSession = async_sessionmaker(dst_engine, class_=AsyncSession, expire_on_commit=False)

    total_read = 0
    total_inserted = 0
    async with SrcSession() as src, DstSession() as dst:
        for table in MIGRATION_ORDER:
            try:
                read, inserted = await _copy_table(table, src, dst)
                total_read += read
                total_inserted += inserted
                print(f"  {table:<18} read={read:<5} inserted={inserted}")
            except Exception as exc:  # pragma: no cover - best-effort per table
                print(f"  [FAIL] {table}: {exc}")

    await src_engine.dispose()
    await dst_engine.dispose()
    print(f"[MIGRATE] Done — total read={total_read}, inserted={total_inserted}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sqlite",
        default=str(BACKEND_DIR / "eval_system_demo.db"),
        help="Path to the source SQLite database file.",
    )
    args = parser.parse_args()
    asyncio.run(migrate(Path(args.sqlite)))


if __name__ == "__main__":
    main()
