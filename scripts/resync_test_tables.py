"""
One-off: re-run `_sync_normalized_test_tables` so the new owner_id /
owner_display_name / visibility columns on test_cases & test_sets get
populated from existing profiles.data.

Usage (inside the eval-system-app container):
    python -m scripts.resync_test_tables
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

sys.path.insert(0, "backend")

from db.database import async_session  # noqa: E402
from db.orm_models import ProfileORM  # noqa: E402
from routers.profiles import _sync_normalized_test_tables  # noqa: E402


async def main() -> int:
    async with async_session() as session:
        profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(profiles))
        await session.commit()
        print(f"[resync] rebuilt normalized tables from {len(profiles)} profile(s)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
