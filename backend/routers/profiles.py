"""Profile management API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
import uuid
import hashlib
import re

from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session
from db.orm_models import FileORM, ProfileORM, TestCaseORM, TestSetORM, TestSetItemORM
from utils.tag_text import normalize_comma_separated_tags

router = APIRouter()


def _effective_profile_display_name(p: ProfileORM) -> Optional[str]:
    """
    Name shown for Owner / normalized test_tables.owner_display_name.
    Prefer preferences.ownerDisplayName from PUT /profiles/{id}/data when ProfileORM.name
    is unset or literally 'Default' (client list may be ahead of PATCH name updates).
    """
    dn_column = (p.name or "").strip()
    data = p.data if isinstance(getattr(p, "data", None), dict) else {}
    prefs = data.get("preferences") if isinstance(data.get("preferences"), dict) else {}
    blob = prefs.get("ownerDisplayName") or prefs.get("displayName")
    from_prefs = blob.strip() if isinstance(blob, str) else ""
    if from_prefs and (not dn_column or dn_column.lower() == "default"):
        return from_prefs
    return dn_column if dn_column else None


def _tc_stable_seed_for_id(tc: Dict[str, Any], fallback: str) -> str:
    """
    Stable id input for `_stable_id("tc", ...)`.

    Prefer the frontend `id` so every distinct saved row in `savedTestCases` / set items gets its own
    `test_cases` mirror row. Name-only seeds caused subtle collisions (e.g. same normalized name twice
    or unexpected duplicates) where `ensure_case` hit `tc_id in tc_by_key` and skipped the row —
    Library JSON still showed the TC but the normalized table did not.

    When `id` is missing (legacy/import), fall back to non-generic display name, then the positional
    fallback. Same logical TC re-used in library + set still shares one `id` and maps to one row.
    """
    rid = str(tc.get("id") or "").strip()
    if rid:
        return rid
    generic = {"", "new test case", "test case"}
    nm = _normalize_tc_name(tc.get("name")).strip().lower()
    if nm and nm not in generic:
        return nm
    return fallback


def _first_mdi_txt_filename(tc: Dict[str, Any]) -> Optional[str]:
    """First non-empty MDI*.txt slot from extraColumns or mdi commands."""
    ex = tc.get("extraColumns") if isinstance(tc.get("extraColumns"), dict) else {}
    mdi_keys = sorted(
        [k for k in ex.keys() if isinstance(k, str) and re.match(r"^MDI\d+$", k, re.I)],
        key=lambda k: int(re.search(r"(\d+)$", str(k), re.I).group(1)),  # type: ignore[union-attr]
    )
    for k in mdi_keys:
        v = str(ex.get(k) or "").strip()
        if v:
            return v
    for c in tc.get("commands") or []:
        if isinstance(c, dict) and c.get("type") == "mdi":
            v = str(c.get("file") or "").strip()
            if v:
                return v
    return None


def _parse_try_count(tc: Dict[str, Any]) -> Optional[int]:
    tc_try = tc.get("tryCount")
    if tc_try is None:
        return None
    if isinstance(tc_try, int):
        return tc_try if tc_try > 0 else None
    try:
        n = int(str(tc_try).strip())
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _extract_status_cached(tc: Dict[str, Any]) -> Optional[str]:
    raw = tc.get("_status") or tc.get("runStatus")
    if raw is None and isinstance(tc.get("extraColumns"), dict):
        raw = tc["extraColumns"].get("runStatus") or tc["extraColumns"].get("status")
    if raw is None or raw == "":
        return None
    s = str(raw).strip()
    if len(s) > 63:
        s = s[:63]
    return s


def _build_filename_to_file_id_map(file_rows: List[Any]) -> Dict[str, str]:
    """First file id wins per lowercased filename (Library file names are unique enough for lookup)."""
    out: Dict[str, str] = {}
    for f in file_rows:
        fid = getattr(f, "id", None)
        fn = getattr(f, "filename", None)
        if not fid or not fn:
            continue
        lk = _norm_file(fn)
        if lk and lk not in out:
            out[lk] = str(fid).strip()
    return out


def _resolve_vcd_file_id(tc: Dict[str, Any], file_by_lower: Dict[str, str], valid_ids: set) -> Optional[str]:
    raw = str(tc.get("vcdId") or tc.get("vcd_file_id") or "").strip()
    if raw and raw in valid_ids:
        return raw
    vn = str(tc.get("vcdName") or tc.get("vcd") or "").strip()
    if not vn:
        return None
    lid = file_by_lower.get(_norm_file(vn))
    if lid and lid in valid_ids:
        return lid
    return None


def _normalize_tc_name(name: Any) -> str:
    return (name or "").strip() if isinstance(name, str) else ""


def _normalize_set_name(name: Any) -> str:
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
    Validate test case + set-name uniqueness **globally across all profiles**.
    Strict policy:
      - TC display name must be unique across system.
      - TC file-set signature (VCD/ERoM/ULP/MDI*) must be unique across system.
      - Saved set name must be unique across system.
    """
    data = new_full_data_for_profile if isinstance(new_full_data_for_profile, dict) else {}
    name_to_id: Dict[str, str] = {}
    name_to_fk: Dict[str, str] = {}
    files_key_to_id: Dict[str, str] = {}
    files_key_to_name: Dict[str, str] = {}
    set_names_seen: set[str] = set()

    # Seed uniqueness maps from every other profile first.
    for p in all_profiles:
        if str(getattr(p, "id", "")) == str(updating_profile_id):
            continue
        pdata = p.data if isinstance(p.data, dict) else {}
        for tc in pdata.get("savedTestCases") or []:
            if not isinstance(tc, dict):
                continue
            n = _normalize_tc_name(tc.get("name"))
            tid = str(tc.get("id") or f"{p.id}:saved").strip()
            fk = _tc_files_key(tc)
            if n:
                name_to_id[n] = tid
                if fk:
                    name_to_fk[n] = fk
            if fk:
                files_key_to_id[fk] = tid
                if n:
                    files_key_to_name[fk] = n
        for si, s in enumerate(pdata.get("savedTestCaseSets") or []):
            if not isinstance(s, dict):
                continue
            sn = _normalize_set_name(s.get("name"))
            if sn:
                set_names_seen.add(sn.lower())
            for ii, tc in enumerate(s.get("items") or []):
                if not isinstance(tc, dict):
                    continue
                n = _normalize_tc_name(tc.get("name"))
                tid = str(tc.get("id") or f"{p.id}:setitem:{si}_{ii}").strip()
                fk = _tc_files_key(tc)
                if n:
                    name_to_id[n] = tid
                    if fk:
                        name_to_fk[n] = fk
                if fk:
                    files_key_to_id[fk] = tid
                    if n:
                        files_key_to_name[fk] = n

    def walk_tc(tc: Any, idx: Any, kind: str) -> Optional[str]:
        if not isinstance(tc, dict):
            return None
        n = _normalize_tc_name(tc.get("name"))
        tid = str(tc.get("id") or "").strip()
        if not tid:
            tid = f"{updating_profile_id}:{kind}:{idx}"
        fk = _tc_files_key(tc)

        if n:
            if n in name_to_id:
                if name_to_id[n] != tid:
                    # Same display name in different rows is acceptable only when
                    # they point to the same exact file-set signature.
                    # (e.g. savedTestCases row + set item copy of the same TC)
                    if not (fk and name_to_fk.get(n) and fk == name_to_fk.get(n)):
                        return f'Duplicate test case name "{n}" in system — please rename'
            else:
                name_to_id[n] = tid
                if fk:
                    name_to_fk[n] = fk

        if fk:
            if fk in files_key_to_id and files_key_to_id[fk] != tid:
                # Same file-set in different rows is acceptable only when display name matches.
                if not (n and files_key_to_name.get(fk) == n):
                    return "Duplicate test case files in system — another TC already uses the same VCD/ERoM/ULP/MDI set"
            if fk not in files_key_to_id:
                files_key_to_id[fk] = tid
            if n and fk not in files_key_to_name:
                files_key_to_name[fk] = n
        return None

    for i, tc in enumerate(data.get("savedTestCases") or []):
        err = walk_tc(tc, i, "saved")
        if err:
            return err
    for si, s in enumerate(data.get("savedTestCaseSets") or []):
        if not isinstance(s, dict):
            continue
        sn = _normalize_set_name(s.get("name"))
        if sn:
            key = sn.lower()
            if key in set_names_seen:
                return f'Duplicate set name "{sn}" in system — please rename'
            set_names_seen.add(key)
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


def _extract_tc_tags(tc: Dict[str, Any]) -> Optional[str]:
    extra = tc.get("extraColumns") if isinstance(tc.get("extraColumns"), dict) else {}
    from_extra = (extra.get("tag") or extra.get("Tag") or "").strip() if isinstance(extra, dict) else ""
    from_root = str(tc.get("tags") or "").strip()
    raw = (from_extra or from_root or "").strip()
    if not raw:
        return None
    return normalize_comma_separated_tags(raw)


async def _sync_normalized_test_tables(session: AsyncSession, all_profiles: List[ProfileORM]) -> None:
    """
    Mirror profiles.data JSON into normalized tables:
    - test_cases
    - test_sets
    - test_set_items
    Rebuilt from scratch on each profile data mutation.
    """
    file_rows = (await session.execute(select(FileORM))).scalars().all()
    valid_vcd_file_ids: set[str] = {str(f.id).strip() for f in file_rows if getattr(f, "id", None)}
    file_by_lower = _build_filename_to_file_id_map(list(file_rows))

    tc_by_key: Dict[str, TestCaseORM] = {}
    set_rows: List[TestSetORM] = []
    set_item_rows: List[TestSetItemORM] = []

    def _pick_visibility(d: Dict[str, Any]) -> str:
        raw = str(d.get("visibility") or "").strip().lower()
        if raw in {"private", "team", "public"}:
            return raw
        return "public"

    for p in all_profiles:
        data = p.data if isinstance(p.data, dict) else {}
        saved_cases = data.get("savedTestCases") or []
        saved_sets = data.get("savedTestCaseSets") or []
        profile_display_name = _effective_profile_display_name(p)

        def ensure_case(tc: Any, fallback: str) -> Optional[str]:
            if not isinstance(tc, dict):
                return None
            seed = _tc_stable_seed_for_id(tc, fallback)
            tc_id = _stable_id("tc", p.id, seed, fallback)
            if tc_id in tc_by_key:
                return tc_id
            name = _normalize_tc_name(tc.get("name")) or f"TC_{tc_id[:8]}"
            vcd_fn = str(tc.get("vcdName") or tc.get("vcd") or "").strip() or None
            erom_fn = str(tc.get("binName") or tc.get("firmware_filename") or "").strip() or None
            ulp_fn = str(tc.get("linName") or tc.get("ulpName") or "").strip() or None
            mdi_fn = _first_mdi_txt_filename(tc)
            vcd_file_id = _resolve_vcd_file_id(tc, file_by_lower, valid_vcd_file_ids)
            tc_by_key[tc_id] = TestCaseORM(
                id=tc_id,
                name=name,
                vcd_file_id=vcd_file_id,
                firmware_filename=erom_fn,
                vcd_filename=vcd_fn,
                ulp_filename=ulp_fn,
                mdi_text_filename=mdi_fn,
                try_count=_parse_try_count(tc),
                status_cached=_extract_status_cached(tc),
                tags=_extract_tc_tags(tc),
                owner_id=p.id,
                owner_display_name=profile_display_name,
                visibility=_pick_visibility(tc),
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
                    tags=normalize_comma_separated_tags(
                        str(s.get("tag") or s.get("tags") or "").strip() or None
                    ),
                    owner_id=p.id,
                    owner_display_name=profile_display_name,
                    visibility=_pick_visibility(s),
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
                # Include set context in the raw seed so same TC appearing in multiple sets
                # won't collide on test_set_items primary key.
                item_raw_id = f"{set_id}:{item_seed}:{i_idx}"
                set_item_rows.append(
                    TestSetItemORM(
                        id=_stable_id("set_item", p.id, item_raw_id, f"{set_id}:{tc_id}:{i_idx}"),
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
                    "_ownerName": _effective_profile_display_name(p) or p.name or p.id,
                }
            )

        for s in sets:
            saved_sets.append(
                {
                    **s,
                    "_ownerId": p.id,
                    "_ownerName": _effective_profile_display_name(p) or p.name or p.id,
                }
            )

    return {"savedTestCases": saved_cases, "savedTestCaseSets": saved_sets}


@router.post("")
async def create_profile(payload: ProfileCreate):
    """Create a new profile."""
    profile_name = (payload.name or "").strip()
    if not profile_name:
        raise HTTPException(status_code=400, detail="Profile name cannot be empty")
    profile_id = str(uuid.uuid4())
    async with async_session() as session:
        exists = await session.execute(
            select(ProfileORM.id).where(func.lower(ProfileORM.name) == profile_name.lower())
        )
        if exists.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f'Profile name "{profile_name}" already exists')
        orm = ProfileORM(
            id=profile_id,
            name=profile_name,
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
            new_name = (payload.name or "").strip()
            if not new_name:
                raise HTTPException(status_code=400, detail="Profile name cannot be empty")
            exists = await session.execute(
                select(ProfileORM.id).where(
                    func.lower(ProfileORM.name) == new_name.lower(),
                    ProfileORM.id != profile_id,
                )
            )
            if exists.scalar_one_or_none():
                raise HTTPException(status_code=409, detail=f'Profile name "{new_name}" already exists')
            values["name"] = new_name
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
