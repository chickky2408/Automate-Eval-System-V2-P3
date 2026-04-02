"""Profile management API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
import uuid

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import ProfileORM

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
    Ensure no duplicate trimmed test case names across all profiles (same DB).
    Same name may only belong to one test case id (globally).
    `new_full_data_for_profile` is the full merged JSON.data for the profile after the update.
    """
    merged: Dict[str, Dict[str, Any]] = {}
    for p in all_profiles:
        merged[p.id] = dict(p.data or {})
    merged[updating_profile_id] = new_full_data_for_profile

    name_to_id: Dict[str, str] = {}
    files_key_to_id: Dict[str, str] = {}

    def walk_tc(tc: Any, profile_id: str, idx: Any, kind: str) -> Optional[str]:
        if not isinstance(tc, dict):
            return None
        n = _normalize_tc_name(tc.get("name"))
        tid = str(tc.get("id") or "").strip()
        if not tid:
            tid = f"{profile_id}:{kind}:{idx}"
        # 1) Name uniqueness (global)
        if n:
            if n in name_to_id:
                if name_to_id[n] != tid:
                    return f'Duplicate test case name "{n}" — names must be unique across all profiles'
            else:
                name_to_id[n] = tid

        # 2) File-set uniqueness (global)
        fk = _tc_files_key(tc)
        if fk:
            if fk in files_key_to_id and files_key_to_id[fk] != tid:
                return "Duplicate test case files — a test case with the same VCD/ERoM/ULP/MDI files already exists"
            files_key_to_id[fk] = tid
        return None

    for pid, data in merged.items():
        if not isinstance(data, dict):
            continue
        for i, tc in enumerate(data.get("savedTestCases") or []):
            err = walk_tc(tc, pid, i, "saved")
            if err:
                return err
        for si, s in enumerate(data.get("savedTestCaseSets") or []):
            if not isinstance(s, dict):
                continue
            for ii, tc in enumerate(s.get("items") or []):
                err = walk_tc(tc, pid, f"{si}_{ii}", "setitem")
                if err:
                    return err
    return None


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
        await session.commit()
        
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return {"success": True}
