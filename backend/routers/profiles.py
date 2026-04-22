"""Profile management API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
import uuid
import hashlib

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import ProfileORM, TestCaseORM, TestSetORM, TestSetItemORM

router = APIRouter()


def _normalize_tc_name(name: Any) -> str:
    return (name or "").strip() if isinstance(name, str) else ""

def _norm_file(v: Any) -> str:
    if isinstance(v, str):
        return v.strip().lower()
    return ""

def _tc_files_key(tc: Any) -> str:
    """
    A stable signature for a test case's file-set.
    We treat identical (VCD/ERoM/ULP/MDI*) sets as duplicates and prevent saving.
    """
    if not isinstance(tc, dict):
        return ""
    vcd = _norm_file(tc.get("vcdName") or tc.get("vcd") or "")
    binf = _norm_file(tc.get("binName") or tc.get("eromName") or tc.get("bin") or "")
    lin = _norm_file(tc.get("linName") or tc.get("ulpName") or tc.get("lin") or "")
    extra = tc.get("extraColumns") or {}
    pairs: list[str] = []
    if isinstance(extra, dict):
        for k, v in extra.items():
            ks = str(k)
            if ks and __import__("re").match(r"^(EROM|ULP|MDI)\d+$", ks, __import__("re").I):
                vv = _norm_file(v)
                if vv:
                    pairs.append(f"{ks.upper()}={vv}")
    pairs.sort()
    return "\0".join([vcd, binf, lin, *pairs])

def _validate_global_unique_test_case_names(
    all_profiles: List[ProfileORM],
    updating_profile_id: str,
    new_full_data_for_profile: Dict[str, Any],
) -> Optional[str]:
    """
    Validate test case uniqueness **within the updating profile only**.

    Rationale: each profile owns its own test cases (stored in profiles.data).
    Stable IDs in the normalized `test_cases` table include profile_id, so the
    same TC name in two different profiles does not collide on FK. Enforcing
    a global unique-across-profiles constraint caused legitimate saves to fail
    with 409 whenever any other profile happened to have the same TC name.

    We still enforce:
      - Name uniqueness inside this profile (savedTestCases + set items).
      - File-set uniqueness inside this profile.
    """
    del all_profiles  # kept for signature compatibility; no longer used for cross-profile checks

    data = new_full_data_for_profile if isinstance(new_full_data_for_profile, dict) else {}
    name_to_id: Dict[str, str] = {}
    files_key_to_id: Dict[str, str] = {}

    def walk_tc(tc: Any, idx: Any, kind: str) -> Optional[str]:
        if not isinstance(tc, dict):
            return None
        n = _normalize_tc_name(tc.get("name"))
        tid = str(tc.get("id") or "").strip()
        if not tid:
            tid = f"{updating_profile_id}:{kind}:{idx}"
        if n:
            if n in name_to_id:
                if name_to_id[n] != tid:
                    return f'Duplicate test case name "{n}" in this profile — please rename'
            else:
                name_to_id[n] = tid

        fk = _tc_files_key(tc)
        if fk:
            if fk in files_key_to_id and files_key_to_id[fk] != tid:
                return "Duplicate test case files in this profile — another TC already uses the same VCD/ERoM/ULP/MDI set"
            files_key_to_id[fk] = tid
        return None

    for i, tc in enumerate(data.get("savedTestCases") or []):
        err = walk_tc(tc, i, "saved")
        if err:
            return err
    for si, s in enumerate(data.get("savedTestCaseSets") or []):
        if not isinstance(s, dict):
            continue
        for ii, tc in enumerate(s.get("items") or []):
            err = walk_tc(tc, f"{si}_{ii}", "setitem")
            if err:
                return err
    return None


def _stable_id(kind: str, profile_id: str, raw_id: str, fallback: str) -> str:
    """
    Build deterministic 32-char ids for normalized tables.
    Table schemas use VARCHAR(32) primary keys.
    """
    rid = (raw_id or "").strip()
    seed = f"{kind}:{profile_id}:{rid if rid else fallback}"
    return hashlib.md5(seed.encode("utf-8")).hexdigest()[:32]


def _extract_tc_tags(tc: Dict[str, Any]) -> str:
    extra = tc.get("extraColumns") if isinstance(tc.get("extraColumns"), dict) else {}
    from_extra = (extra.get("tag") or extra.get("Tag") or "").strip() if isinstance(extra, dict) else ""
    from_root = str(tc.get("tags") or "").strip()
    return from_extra or from_root or None


async def _sync_normalized_test_tables(session: AsyncSession, all_profiles: List[ProfileORM]) -> None:
    """
    Mirror profiles.data JSON into normalized tables:
    - test_cases
    - test_sets
    - test_set_items
    Rebuilt from scratch on each profile data mutation.
    """
    tc_by_key: Dict[str, TestCaseORM] = {}
    set_rows: List[TestSetORM] = []
    set_item_rows: List[TestSetItemORM] = []

    for p in all_profiles:
        data = p.data if isinstance(p.data, dict) else {}
        saved_cases = data.get("savedTestCases") or []
        saved_sets = data.get("savedTestCaseSets") or []

        def ensure_case(tc: Any, fallback: str) -> Optional[str]:
            if not isinstance(tc, dict):
                return None
            raw_id = str(tc.get("id") or "").strip()
            tc_id = _stable_id("tc", p.id, raw_id, fallback)
            if tc_id in tc_by_key:
                return tc_id
            name = _normalize_tc_name(tc.get("name")) or f"TC_{tc_id[:8]}"
            tc_by_key[tc_id] = TestCaseORM(
                id=tc_id,
                name=name,
                vcd_file_id=str(tc.get("vcdId") or tc.get("vcd_file_id") or "").strip() or None,
                firmware_filename=str(tc.get("binName") or tc.get("firmware_filename") or "").strip() or None,
                tags=_extract_tc_tags(tc),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            return tc_id

        for idx, tc in enumerate(saved_cases):
            ensure_case(tc, f"saved:{idx}")

        for s_idx, s in enumerate(saved_sets):
            if not isinstance(s, dict):
                continue
            raw_set_id = str(s.get("id") or "").strip()
            set_id = _stable_id("set", p.id, raw_set_id, f"set:{s_idx}")
            set_rows.append(
                TestSetORM(
                    id=set_id,
                    name=str(s.get("name") or f"Set {s_idx + 1}").strip() or f"Set {s_idx + 1}",
                    tags=str(s.get("tag") or s.get("tags") or "").strip() or None,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
            )
            items = s.get("items") or []
            for i_idx, tc in enumerate(items):
                tc_id = ensure_case(tc, f"set:{s_idx}:item:{i_idx}")
                if not tc_id:
                    continue
                item_seed = str(tc.get("id") or tc.get("name") or f"{i_idx}")
                set_item_rows.append(
                    TestSetItemORM(
                        id=_stable_id("set_item", p.id, item_seed, f"{set_id}:{tc_id}:{i_idx}"),
                        test_set_id=set_id,
                        test_case_id=tc_id,
                        execution_order=int(i_idx + 1),
                        created_at=datetime.utcnow(),
                    )
                )

    await session.execute(delete(TestSetItemORM))
    await session.execute(delete(TestSetORM))
    await session.execute(delete(TestCaseORM))
    await session.flush()
    if tc_by_key:
        session.add_all(list(tc_by_key.values()))
    if set_rows:
        session.add_all(set_rows)
    # Ensure parent tables are persisted before child rows (FK: test_set_items -> test_sets/test_cases).
    await session.flush()
    if set_item_rows:
        session.add_all(set_item_rows)
    await session.flush()


class ProfileCreate(BaseModel):
    name: str
    data: Optional[Dict[str, Any]] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


@router.get("")
async def list_profiles():
    """Get all profiles."""
    async with async_session() as session:
        result = await session.execute(select(ProfileORM))
        profiles = result.scalars().all()
        return [
            {
                "id": p.id,
                "name": p.name,
                "data": p.data,
                "updated_at": p.updated_at.isoformat() + "Z",
            }
            for p in profiles
        ]


@router.get("/all-test-cases")
async def get_all_test_cases():
    """
    Aggregate savedTestCases and savedTestCaseSets from all profiles.
    Used for 'All' / 'Shared with me' filters in Test Case Library & Set Library.
    """
    async with async_session() as session:
        result = await session.execute(select(ProfileORM))
        profiles: List[ProfileORM] = result.scalars().all()

    saved_cases: list[dict] = []
    saved_sets: list[dict] = []

    for p in profiles:
        data = p.data or {}
        cases = data.get("savedTestCases") or []
        sets = data.get("savedTestCaseSets") or []

        for tc in cases:
            saved_cases.append(
                {
                    **tc,
                    "_ownerId": p.id,
                    "_ownerName": p.name or p.id,
                }
            )

        for s in sets:
            saved_sets.append(
                {
                    **s,
                    "_ownerId": p.id,
                    "_ownerName": p.name or p.id,
                }
            )

    return {"savedTestCases": saved_cases, "savedTestCaseSets": saved_sets}


@router.post("")
async def create_profile(payload: ProfileCreate):
    """Create a new profile."""
    profile_id = str(uuid.uuid4())
    async with async_session() as session:
        orm = ProfileORM(
            id=profile_id,
            name=payload.name,
            data=payload.data,
            updated_at=datetime.utcnow(),
        )
        session.add(orm)
        await session.commit()
        await session.refresh(orm)
        
        return {
            "id": orm.id,
            "name": orm.name,
            "data": orm.data,
            "updated_at": orm.updated_at.isoformat() + "Z",
        }


@router.get("/{profile_id}")
async def get_profile(profile_id: str):
    """Get a specific profile."""
    async with async_session() as session:
        result = await session.execute(
            select(ProfileORM).where(ProfileORM.id == profile_id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return {
            "id": profile.id,
            "name": profile.name,
            "data": profile.data,
            "updated_at": profile.updated_at.isoformat() + "Z",
        }


@router.get("/{profile_id}/data")
async def get_profile_data(profile_id: str):
    """Get profile data only."""
    async with async_session() as session:
        result = await session.execute(
            select(ProfileORM.data).where(ProfileORM.id == profile_id)
        )
        data = result.scalar_one_or_none()
        if data is None:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return data


@router.put("/{profile_id}/data")
async def put_profile_data(profile_id: str, payload: Dict[str, Any]):
    """Replace/merge profile JSON data (savedTestCases, savedTestCaseSets, …). Validates global TC name uniqueness."""
    async with async_session() as session:
        result = await session.execute(select(ProfileORM).where(ProfileORM.id == profile_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Profile not found")
        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        new_data = {**(row.data or {}), **payload}
        err = _validate_global_unique_test_case_names(list(all_profiles), profile_id, new_data)
        if err:
            raise HTTPException(status_code=409, detail=err)
        await session.execute(
            update(ProfileORM)
            .where(ProfileORM.id == profile_id)
            .values(data=new_data, updated_at=datetime.utcnow())
        )
        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()
    return {"success": True}


@router.patch("/{profile_id}")
async def update_profile(profile_id: str, payload: ProfileUpdate):
    """Update a profile."""
    async with async_session() as session:
        result = await session.execute(select(ProfileORM).where(ProfileORM.id == profile_id))
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Profile not found")

        values = {}
        if payload.name is not None:
            values["name"] = payload.name
        if payload.data is not None:
            all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
            new_data = {**(row.data or {}), **payload.data}
            err = _validate_global_unique_test_case_names(list(all_profiles), profile_id, new_data)
            if err:
                raise HTTPException(status_code=409, detail=err)
            values["data"] = new_data
        values["updated_at"] = datetime.utcnow()

        result = await session.execute(
            update(ProfileORM).where(ProfileORM.id == profile_id).values(**values)
        )
        if "data" in values:
            all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
            await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()

        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Profile not found")

        return {"success": True}


@router.delete("/{profile_id}")
async def delete_profile(profile_id: str):
    """Delete a profile."""
    async with async_session() as session:
        result = await session.execute(
            delete(ProfileORM).where(ProfileORM.id == profile_id)
        )
        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()
        
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return {"success": True}


@router.post("/sync-normalized")
async def sync_normalized_tables():
    """
    One-shot admin utility:
    Rebuild normalized test tables (test_cases/test_sets/test_set_items)
    from profiles.data for all profiles.
    """
    async with async_session() as session:
        all_profiles = (await session.execute(select(ProfileORM))).scalars().all()
        await _sync_normalized_test_tables(session, list(all_profiles))
        await session.commit()
    return {"success": True, "profiles": len(all_profiles)}
