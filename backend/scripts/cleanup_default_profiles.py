#!/usr/bin/env python3
"""
Bulk-delete profiles whose name starts with "Default" (case-insensitive),
same rule as cleanup_default_profiles.sql.

Rebuilds normalized test tables after delete (same as DELETE /profiles/{id}).

Usage (from repo root, env loaded like API — see backend/.env or root .env):

  cd backend && pipenv run python scripts/cleanup_default_profiles.py --dry-run
  cd backend && pipenv run python scripts/cleanup_default_profiles.py

Requires PostgreSQL (not USE_SQLITE_DEMO-only offline DB unless profiles exist there).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

# Run as `python scripts/cleanup_default_profiles.py` with cwd = backend/
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)
os.chdir(_BACKEND_ROOT)


async def _run(*, dry_run: bool) -> int:
    from sqlalchemy import delete, select

    from db.database import async_session
    from db.orm_models import ProfileORM
    from routers.profiles import _sync_normalized_test_tables

    async with async_session() as session:
        result = await session.execute(select(ProfileORM).where(ProfileORM.name.ilike("default%")))
        rows = result.scalars().all()
        print(f"Matching profiles: {len(rows)}")
        for r in rows[:40]:
            print(f"  {r.id}  {r.name}")
        if len(rows) > 40:
            print(f"  ... and {len(rows) - 40} more")

        if dry_run:
            print("(dry-run — no changes)")
            return 0

        if not rows:
            print("Nothing to delete.")
            return 0

        await session.execute(delete(ProfileORM).where(ProfileORM.name.ilike("default%")))
        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()
        print(f"Deleted {len(rows)} profile(s). {len(all_profiles)} profile(s) remain.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove Default* profiles from DB")
    parser.add_argument("--dry-run", action="store_true", help="List matches only; do not delete")
    args = parser.parse_args()
    return asyncio.run(_run(dry_run=args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
