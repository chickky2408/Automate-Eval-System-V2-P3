"""Resolve profile display names from ProfileORM (shared DB, all clients see same names)."""
from __future__ import annotations

from typing import Dict, Optional, Set

from sqlalchemy import select

from db.database import async_session
from db.orm_models import ProfileORM


async def batch_profile_names_by_ids(ids: Optional[Set[str]]) -> Dict[str, str]:
    """Return { profile_id: name } for ids that exist in profiles table. Skips client_* session ids."""
    if not ids:
        return {}
    clean = {i for i in ids if i and not str(i).startswith("client_")}
    if not clean:
        return {}
    async with async_session() as session:
        result = await session.execute(select(ProfileORM).where(ProfileORM.id.in_(clean)))
        rows = result.scalars().all()
        return {r.id: (r.name or r.id) for r in rows}
