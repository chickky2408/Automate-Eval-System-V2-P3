"""
One-off maintenance script: collapse duplicate profiles that share the same `name`.

Strategy (per name group):
  1. Keep the profile with the most recent `updated_at` (the one the live frontend
     session is most likely still referencing).
  2. Merge savedTestCases + savedTestCaseSets from the duplicates into the keeper.
     De-duplication inside the merge uses the normalized test case name.
  3. Remap `jobs.profile_id` and `files.owner_id` from the duplicates to the
     keeper id (they are soft references — plain VARCHAR, no FK constraint).
  4. Delete the duplicate profile rows.

Everything runs inside one transaction. A pg_dump backup should be taken first
(see scripts/dedupe_profiles.sh).

Usage (inside the eval-system-app container):
    python -m scripts.dedupe_profiles          # dry run — prints plan
    python -m scripts.dedupe_profiles --apply  # execute changes
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import defaultdict
from typing import Any, Dict, List

from sqlalchemy import select, text

# Make sure `backend/` is on sys.path when run from repo root.
sys.path.insert(0, "backend")

from db.database import async_session  # noqa: E402
from db.orm_models import ProfileORM  # noqa: E402


def _normalize_name(raw: Any) -> str:
    return (str(raw or "")).strip().casefold()


def _merge_test_cases(keeper: List[Dict[str, Any]], extras: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = list(keeper or [])
    seen = {_normalize_name(tc.get("name")) for tc in out if isinstance(tc, dict)}
    for tc in extras or []:
        if not isinstance(tc, dict):
            continue
        n = _normalize_name(tc.get("name"))
        if n and n in seen:
            continue
        if n:
            seen.add(n)
        out.append(tc)
    return out


def _merge_sets(keeper: List[Dict[str, Any]], extras: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = list(keeper or [])
    seen = {_normalize_name(s.get("name")) for s in out if isinstance(s, dict)}
    for s in extras or []:
        if not isinstance(s, dict):
            continue
        n = _normalize_name(s.get("name"))
        if n and n in seen:
            continue
        if n:
            seen.add(n)
        out.append(s)
    return out


async def main(apply: bool) -> int:
    async with async_session() as session:
        rows = (await session.execute(select(ProfileORM))).scalars().all()

        groups: Dict[str, List[ProfileORM]] = defaultdict(list)
        for p in rows:
            key = (p.name or "").strip()
            if not key:
                continue
            groups[key].append(p)

        total_deleted = 0
        total_merged_tcs = 0
        total_merged_sets = 0
        total_jobs_remapped = 0
        total_files_remapped = 0

        for name, profs in sorted(groups.items()):
            if len(profs) <= 1:
                continue

            profs.sort(key=lambda p: (p.updated_at or 0), reverse=True)
            keeper = profs[0]
            dups = profs[1:]

            keeper_data = dict(keeper.data or {})
            keeper_tcs = list(keeper_data.get("savedTestCases") or [])
            keeper_sets = list(keeper_data.get("savedTestCaseSets") or [])

            merged_tcs_before = len(keeper_tcs)
            merged_sets_before = len(keeper_sets)

            for d in dups:
                d_data = d.data or {}
                keeper_tcs = _merge_test_cases(keeper_tcs, d_data.get("savedTestCases") or [])
                keeper_sets = _merge_sets(keeper_sets, d_data.get("savedTestCaseSets") or [])

            delta_tcs = len(keeper_tcs) - merged_tcs_before
            delta_sets = len(keeper_sets) - merged_sets_before

            dup_ids = [d.id for d in dups]
            print(
                f"[plan] name={name!r}  keeper={keeper.id}  "
                f"dups={len(dup_ids)}  +tcs={delta_tcs}  +sets={delta_sets}"
            )

            if apply:
                keeper_data["savedTestCases"] = keeper_tcs
                keeper_data["savedTestCaseSets"] = keeper_sets
                keeper.data = keeper_data

                jobs_res = await session.execute(
                    text(
                        "UPDATE jobs SET profile_id = :k WHERE profile_id = ANY(:d)"
                    ).bindparams(k=keeper.id, d=dup_ids)
                )
                files_res = await session.execute(
                    text(
                        "UPDATE files SET owner_id = :k WHERE owner_id = ANY(:d)"
                    ).bindparams(k=keeper.id, d=dup_ids)
                )
                await session.execute(
                    text("DELETE FROM profiles WHERE id = ANY(:d)").bindparams(d=dup_ids)
                )

                total_jobs_remapped += jobs_res.rowcount or 0
                total_files_remapped += files_res.rowcount or 0
                total_deleted += len(dup_ids)
                total_merged_tcs += delta_tcs
                total_merged_sets += delta_sets

        if apply:
            await session.commit()
            print(
                f"\n[done] deleted {total_deleted} duplicate profile(s), "
                f"merged +{total_merged_tcs} TC(s) / +{total_merged_sets} set(s), "
                f"remapped {total_jobs_remapped} job(s) and {total_files_remapped} file(s)"
            )
        else:
            print("\n[dry-run] no changes committed. re-run with --apply to persist.")

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually apply changes")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(apply=args.apply)))
