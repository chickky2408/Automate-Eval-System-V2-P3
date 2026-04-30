"""
Audit + optional auto-fix for global duplicate policy.

Checks:
  1) Profile name duplicates (case-insensitive)
  2) Set name duplicates (case-insensitive)
  3) Test case name duplicates (trimmed exact string)
  4) Test case file-signature duplicates (VCD/ERoM/ULP/MDI*)

Auto-fix strategy (--apply):
  - profile-name duplicates: keep first, rename later profiles
  - set-name duplicates: keep first, rename later sets
  - tc-name duplicates: keep first, rename later test cases
  - tc-files duplicates: keep first, remove later duplicated test cases

Safety:
  - dry-run by default
  - optional backup JSON to disk before writing
  - all DB writes done in one transaction
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from copy import deepcopy
from typing import Any, Dict, List

from sqlalchemy import select

sys.path.insert(0, "backend")

from db.database import async_session  # noqa: E402
from db.orm_models import ProfileORM  # noqa: E402


def _norm_trim(v: Any) -> str:
    return (str(v or "")).strip()


def _norm_ci(v: Any) -> str:
    return _norm_trim(v).casefold()


def _norm_file(v: Any) -> str:
    return _norm_trim(v).lower()


def _tc_files_key(tc: Dict[str, Any]) -> str:
    if not isinstance(tc, dict):
        return ""
    vcd = _norm_file(tc.get("vcdName"))
    binf = _norm_file(tc.get("binName"))
    lin = _norm_file(tc.get("linName"))
    extra = tc.get("extraColumns")
    pairs: List[str] = []
    if isinstance(extra, dict):
        for k, v in extra.items():
            ks = str(k)
            if ks and __import__("re").match(r"^(EROM|ULP|MDI)\d+$", ks, __import__("re").I):
                vv = _norm_file(v)
                if vv:
                    pairs.append(f"{ks.upper()}={vv}")
    pairs.sort()
    return "\0".join([vcd, binf, lin, *pairs])


def _loc_profile(p: ProfileORM) -> Dict[str, str]:
    return {
        "profile_id": str(p.id),
        "profile_name": _norm_trim(p.name) or str(p.id),
    }


def _loc_tc(profile: ProfileORM, tc: Dict[str, Any], source: str, index: str) -> Dict[str, str]:
    out = _loc_profile(profile)
    out.update(
        {
            "tc_id": _norm_trim(tc.get("id")) or f"{profile.id}:{source}:{index}",
            "tc_name": _norm_trim(tc.get("name")),
            "source": source,
            "index": index,
        }
    )
    return out


def _build_report(profiles: List[ProfileORM]) -> Dict[str, Any]:
    profile_name_hits: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    set_name_hits: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    tc_name_hits: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    tc_file_hits: Dict[str, List[Dict[str, str]]] = defaultdict(list)

    for p in profiles:
        pdata = p.data if isinstance(p.data, dict) else {}

        pname = _norm_trim(p.name)
        if pname:
            profile_name_hits[_norm_ci(pname)].append(_loc_profile(p))

        for s_idx, s in enumerate(pdata.get("savedTestCaseSets") or []):
            if not isinstance(s, dict):
                continue
            sname = _norm_trim(s.get("name"))
            if sname:
                set_name_hits[_norm_ci(sname)].append(
                    {
                        **_loc_profile(p),
                        "set_id": _norm_trim(s.get("id")) or f"{p.id}:set:{s_idx}",
                        "set_name": sname,
                        "source": "savedTestCaseSets",
                        "index": str(s_idx),
                    }
                )

        def add_tc(tc: Any, source: str, index: str) -> None:
            if not isinstance(tc, dict):
                return
            tname = _norm_trim(tc.get("name"))
            if tname:
                tc_name_hits[tname].append(_loc_tc(p, tc, source, index))
            fkey = _tc_files_key(tc)
            if fkey:
                tc_file_hits[fkey].append(_loc_tc(p, tc, source, index))

        for i, tc in enumerate(pdata.get("savedTestCases") or []):
            add_tc(tc, "savedTestCases", str(i))
        for s_idx, s in enumerate(pdata.get("savedTestCaseSets") or []):
            if not isinstance(s, dict):
                continue
            for i, tc in enumerate(s.get("items") or []):
                add_tc(tc, f"savedTestCaseSets[{s_idx}].items", str(i))

    def only_dups(m: Dict[str, List[Dict[str, str]]]) -> Dict[str, List[Dict[str, str]]]:
        return {k: v for k, v in m.items() if len(v) > 1}

    d_profile = only_dups(profile_name_hits)
    d_set = only_dups(set_name_hits)
    d_tc_name = only_dups(tc_name_hits)
    d_tc_files = only_dups(tc_file_hits)

    return {
        "summary": {
            "profiles_total": len(profiles),
            "duplicate_profile_name_groups": len(d_profile),
            "duplicate_set_name_groups": len(d_set),
            "duplicate_tc_name_groups": len(d_tc_name),
            "duplicate_tc_files_groups": len(d_tc_files),
        },
        "duplicates": {
            "profile_names": d_profile,
            "set_names": d_set,
            "tc_names": d_tc_name,
            "tc_files": d_tc_files,
        },
    }


def _print_text(report: Dict[str, Any]) -> None:
    s = report["summary"]
    d = report["duplicates"]
    print("[audit] Global duplicate report")
    print(
        f"  profiles={s['profiles_total']} | "
        f"profile-name-groups={s['duplicate_profile_name_groups']} | "
        f"set-name-groups={s['duplicate_set_name_groups']} | "
        f"tc-name-groups={s['duplicate_tc_name_groups']} | "
        f"tc-file-groups={s['duplicate_tc_files_groups']}"
    )

    def section(title: str, payload: Dict[str, List[Dict[str, str]]], key_label: str) -> None:
        print(f"\n== {title} ({len(payload)} group(s)) ==")
        if not payload:
            print("  none")
            return
        for i, (k, rows) in enumerate(payload.items(), start=1):
            shown_key = k if key_label != "tc_files_key" else f"<hashable-signature len={len(k)}>"
            print(f"  [{i}] {key_label}={shown_key}  hits={len(rows)}")
            for r in rows:
                core = f"profile={r.get('profile_name')} ({r.get('profile_id')})"
                if "set_name" in r:
                    print(f"      - {core}  set={r.get('set_name')}  source={r.get('source')}#{r.get('index')}")
                elif "tc_name" in r:
                    print(
                        f"      - {core}  tc={r.get('tc_name')} id={r.get('tc_id')} "
                        f"source={r.get('source')}#{r.get('index')}"
                    )
                else:
                    print(f"      - {core}")

    section("Profile name duplicates", d["profile_names"], "profile_name_ci")
    section("Set name duplicates", d["set_names"], "set_name_ci")
    section("TC name duplicates", d["tc_names"], "tc_name")
    section("TC files duplicates", d["tc_files"], "tc_files_key")


def _unique_suffix_name(base: str, used_ci: set[str]) -> str:
    clean = _norm_trim(base) or "Unnamed"
    if _norm_ci(clean) not in used_ci:
        used_ci.add(_norm_ci(clean))
        return clean
    i = 2
    while True:
        candidate = f"{clean} ({i})"
        key = _norm_ci(candidate)
        if key not in used_ci:
            used_ci.add(key)
            return candidate
        i += 1


def _fix_profile_names(profiles: List[ProfileORM], changes: Dict[str, int]) -> None:
    used_ci: set[str] = set()
    for p in profiles:
        raw = _norm_trim(p.name) or "Profile"
        new_name = _unique_suffix_name(raw, used_ci)
        if new_name != (p.name or ""):
            p.name = new_name
            changes["profile_renamed"] += 1


def _fix_set_names_and_tcs(profile: ProfileORM, global_state: Dict[str, set[str]], changes: Dict[str, int]) -> None:
    data = deepcopy(profile.data) if isinstance(profile.data, dict) else {}
    sets = data.get("savedTestCaseSets") or []
    saved = data.get("savedTestCases") or []

    def process_tc(tc: Any) -> Any:
        if not isinstance(tc, dict):
            return None
        row = dict(tc)

        nm = _norm_trim(row.get("name")) or "Test case"
        nm_fixed = _unique_suffix_name(nm, global_state["tc_name"])
        if nm_fixed != _norm_trim(row.get("name")):
            row["name"] = nm_fixed
            changes["tc_renamed"] += 1

        fk = _tc_files_key(row)
        if fk:
            if fk in global_state["tc_file"]:
                changes["tc_removed_duplicate_files"] += 1
                return None
            global_state["tc_file"].add(fk)
        return row

    new_saved: List[Any] = []
    for tc in saved:
        fixed = process_tc(tc)
        if fixed is not None:
            new_saved.append(fixed)

    new_sets: List[Any] = []
    for s in sets:
        if not isinstance(s, dict):
            continue
        set_row = dict(s)
        set_name = _norm_trim(set_row.get("name")) or "Unnamed Set"
        fixed_set_name = _unique_suffix_name(set_name, global_state["set_name"])
        if fixed_set_name != _norm_trim(set_row.get("name")):
            set_row["name"] = fixed_set_name
            changes["set_renamed"] += 1

        items = set_row.get("items") or []
        fixed_items: List[Any] = []
        for tc in items:
            fixed = process_tc(tc)
            if fixed is not None:
                fixed_items.append(fixed)
        set_row["items"] = fixed_items
        new_sets.append(set_row)

    data["savedTestCases"] = new_saved
    data["savedTestCaseSets"] = new_sets
    profile.data = data


def _backup_profiles_json(profiles: List[ProfileORM], backup_file: str) -> None:
    dump = []
    for p in profiles:
        dump.append(
            {
                "id": str(p.id),
                "name": p.name,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                "data": p.data,
            }
        )
    with open(backup_file, "w", encoding="utf-8") as f:
        json.dump(dump, f, ensure_ascii=False, indent=2)


async def _amain(as_json: bool, apply: bool, backup_file: str | None) -> int:
    async with async_session() as session:
        profiles = (await session.execute(select(ProfileORM).order_by(ProfileORM.updated_at.desc()))).scalars().all()
        before = _build_report(profiles)

        if not apply:
            if as_json:
                print(json.dumps(before, ensure_ascii=False, indent=2))
            else:
                _print_text(before)
            return 0

        if backup_file:
            _backup_profiles_json(profiles, backup_file)
            print(f"[backup] wrote {len(profiles)} profile records to {backup_file}")

        changes = defaultdict(int)
        _fix_profile_names(profiles, changes)
        global_state = {
            "set_name": set(),
            "tc_name": set(),
            "tc_file": set(),
        }
        for p in profiles:
            _fix_set_names_and_tcs(p, global_state, changes)

        await session.commit()
        after = _build_report(profiles)

    print("\n[apply] done")
    print(
        "  changes: "
        f"profile_renamed={changes['profile_renamed']}, "
        f"set_renamed={changes['set_renamed']}, "
        f"tc_renamed={changes['tc_renamed']}, "
        f"tc_removed_duplicate_files={changes['tc_removed_duplicate_files']}"
    )
    print("  remaining duplicate groups:")
    print(
        "    "
        f"profile={after['summary']['duplicate_profile_name_groups']}, "
        f"set={after['summary']['duplicate_set_name_groups']}, "
        f"tc_name={after['summary']['duplicate_tc_name_groups']}, "
        f"tc_files={after['summary']['duplicate_tc_files_groups']}"
    )

    if as_json:
        print(json.dumps({"before": before, "after": after, "changes": dict(changes)}, ensure_ascii=False, indent=2))
    else:
        print("\n[before]")
        _print_text(before)
        print("\n[after]")
        _print_text(after)

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    parser.add_argument("--apply", action="store_true", help="Apply deterministic auto-fix to profiles data")
    parser.add_argument(
        "--backup-file",
        default=None,
        help="Optional backup JSON path before --apply (example: scripts/backup_profiles_before_dedupe.json)",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_amain(as_json=args.json, apply=args.apply, backup_file=args.backup_file)))
