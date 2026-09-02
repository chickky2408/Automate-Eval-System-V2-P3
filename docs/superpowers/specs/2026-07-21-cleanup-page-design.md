# Cleanup Page — Passcode-Gated Orphan File Manager

Date: 2026-07-21
Status: Approved (design)
Component: Automate-Eval-System-V2-P3 (backend FastAPI + frontend React)

## Goal

Give a user who knows a shared passcode a place, reachable only from the Library
page, to find and delete orphan files. No system-wide role/auth is introduced —
access is a single backend-verified passcode. Deletion is staged (scan → review →
approve) so nothing is removed without an explicit human confirmation.

## Orphan definitions

Three kinds of orphan, all handled by this page:

| Kind | In DB? | On disk? | Referenced by test_case? | Problem |
|------|--------|----------|--------------------------|---------|
| A. disk orphan (`orphan_disk_file`) | no | yes | — | file left on disk, no DB record, wastes storage |
| B. missing file (`missing_disk_file`) | yes | no | — | DB record points to a file that is gone; open/run errors |
| C. unreferenced (`unreferenced_file`) | yes | yes | no | normal file that no test_case uses; clutter |

"Referenced" means the file id appears in one of the 4 test_case slots
(`vcd_file_id` / `bin_file_id` / `lin_file_id` / `mdi_file_id`), matching the
existing delete parent-guard. Jobs/results/run-sets are out of scope for the
reference check (consistent with the guard).

## Security model

- Passcode stored in backend env `CLEANUP_PASSCODE`. Never in frontend code.
- FastAPI dependency `require_cleanup_passcode` reads header `X-Cleanup-Passcode`
  and compares with `hmac.compare_digest` (constant-time).
- If `CLEANUP_PASSCODE` is unset/empty → cleanup is **disabled**: every gated
  endpoint returns `403` (fail closed, never treat empty as "any passcode works").
- Wrong/missing passcode → `401`.
- Every cleanup endpoint depends on `require_cleanup_passcode`, so hitting the API
  directly does not bypass the gate. The frontend passcode entry is only UI; the
  real enforcement is server-side.

Threat note: a frontend-only gate would be trivially bypassable (read the JS
bundle, or call the endpoints directly). Backend enforcement is the reason the
passcode is checked on every request, not just once at "login".

## Backend

### Passcode dependency

`require_cleanup_passcode(x_cleanup_passcode: Optional[str] = Header(None, alias="X-Cleanup-Passcode"))`:
1. Read `CLEANUP_PASSCODE` from env at call time (not import time, so tests can set it).
2. Empty/unset → `HTTPException(403, "Cleanup is disabled")`.
3. Missing header or mismatch (constant-time) → `HTTPException(401, "Invalid passcode")`.
4. Otherwise return (allow).

Applied to all endpoints below.

### Endpoints (all gated)

| Method + path | Kind | Status |
|---------------|------|--------|
| `GET /files/unreferenced` | C list (read-only report) | exists; add gate |
| `POST /files/deletion-candidates/stage-unreferenced` | stage C as candidates | new |
| `POST /files/deletion-candidates/scan` | stage A (disk orphans) | exists; add gate |
| `POST /files/deletion-candidates/scan-missing` | stage B | new |
| `GET /files/deletion-candidates` | review list | exists; add gate |
| `DELETE /files/deletion-candidates/{id}/approve` | delete | exists; add gate + re-verify |

Note: `/unreferenced` and the `/deletion-candidates/*` static paths must be
declared before the `/{file_id}` path params in the router so they are not
captured as a file id (already true for `/unreferenced`).

### New store methods (`file_store`)

- `scan_missing_files() -> dict`: iterate `FileORM` rows, resolve each
  `storage_path`; if the disk file does not exist, register a deletion candidate
  with `reason="missing_disk_file"` and `file_id=<the record id>`. Skip records
  already staged. Returns `{scanned, registered, candidates}` (same shape as
  `scan_orphaned_files`).
- `stage_unreferenced_files(referenced_ids: set) -> dict`: for each library file
  (type in `LIBRARY_VISIBLE_FILE_TYPES`) whose id is not in `referenced_ids`,
  register a candidate `reason="unreferenced_file"`, `file_id=<id>`. Skip already
  staged. Returns the same shape. The router passes
  `referenced_ids = await test_case_store.get_referenced_file_ids()`.

### Approve behavior (`approve_deletion`) — per reason

`approve_deletion` currently: purge candidate row, then if `file_id` set →
`delete_file(file_id)`, else remove disk file at `storage_path`. Extend to branch
on `reason` **and re-verify before deleting**:

- `orphan_disk_file` (A): remove the disk file at `storage_path` (file_id is None).
- `missing_disk_file` (B): `delete_file(file_id)` — deletes the DB record (+tagmaps);
  `delete_file` already tolerates a missing disk file (`if os.path.exists`).
- `unreferenced_file` (C): `delete_file(file_id)` — deletes DB record + disk file.

**Re-verify applies to ANY candidate with a `file_id` set (B and C alike):** before
deleting, re-check the file is not referenced by any test case
(`find_test_cases_referencing_file`). If referenced → do not delete, return `409`
with the referencing test-case names. This matters for B too: a missing-disk file
can still be referenced by a test case, and deleting its DB row would violate the
FK (`vcd_file_id` NOT NULL) or leave dangling references. A (file_id None) is
unaffected — it has no DB record to protect.

Rationale: the parent-guard lives in the router `DELETE /files/{id}`, not in
`file_store.delete_file`. Staged C candidates can go stale (a test_case may attach
the file after staging). Re-verifying at approve time preserves the invariant
"a file referenced by a test_case is never deleted" without moving the guard.

To avoid import cycles, the approve re-verify calls `test_case_store` from the
router layer. Chosen: the router checks `find_test_cases_referencing_file` for any
candidate whose `file_id` is set and blocks the approval with `409` if the file is
referenced, before delegating to `file_store.approve_deletion`.

## Frontend

### Entry point

A `🧹 Cleanup` button in the Library page header (`FileLibraryPage.jsx`). Clicking
opens a passcode modal. This is the only entry point.

### Passcode modal → unlock

- User types passcode. On submit, verify by calling `GET /files/deletion-candidates`
  with the `X-Cleanup-Passcode` header.
  - `200` → unlock, keep the passcode in component state, show the cleanup overlay.
  - `401` → "passcode ไม่ถูกต้อง".
  - `403` → "cleanup ถูกปิด (ยังไม่ตั้ง CLEANUP_PASSCODE)".
- Passcode is held in React state (in-memory) only while the overlay is open.
  Closing the overlay clears it; re-opening re-prompts. Never persisted to storage.

### Cleanup overlay (full-screen)

A toolbar with three actions — **Scan A** (disk orphans), **Scan B** (missing
files), **Stage C** (unreferenced) — each calling its endpoint, followed by a
single combined review list of `deletion_candidates` with a **reason column**
(A/B/C) so all staged items are seen together. Multi-select checkboxes +
**Delete selected** → confirm modal (count + names) → `approve` each selected
candidate sequentially → refresh the list.

### api.js additions (all send the passcode header)

`getUnreferencedFiles(passcode)`, `stageUnreferenced(passcode)`,
`scanDiskOrphans(passcode)`, `scanMissingFiles(passcode)`,
`getDeletionCandidates(passcode)`, `approveDeletionCandidate(id, passcode)`.
Add the matching `API_ENDPOINTS` entries in `apiEndpoints.js`.

### Data flow

```
Library [🧹] → passcode modal → verify (GET candidates + header)
  → overlay: [Scan A][Scan B][Stage C] → candidates list (reason column)
  → select + Delete selected → confirm → approve each → refresh
```

## Error handling

| Case | Server | UI |
|------|--------|----|
| wrong/missing passcode | 401 | "passcode ไม่ถูกต้อง" |
| CLEANUP_PASSCODE unset | 403 | "cleanup ถูกปิด" |
| approve C now referenced | 409 | show referencing test_case names, skip that file |
| candidate already gone | 404 | drop from list, refresh |

## Testing (backend, unittest `IsolatedAsyncioTestCase`, monkeypatch style)

1. Passcode gate: no header → 401; wrong → 401; env unset → 403; correct → allowed.
2. `scan_missing_files`: a record whose disk file is absent → becomes a candidate;
   a record with an existing file → not a candidate.
3. `stage_unreferenced_files`: unreferenced library file → staged; referenced → not.
4. Approve re-verify: a `unreferenced_file` candidate whose file is now referenced
   → 409, file not deleted; still unreferenced → deleted.
5. Approve per reason deletes in the right place (A disk only, B DB record, C both).

Frontend: no framework test harness in repo; manual verification of the modal
unlock/scan/approve flow against a running backend with `CLEANUP_PASSCODE` set.

## Out of scope

- System-wide roles / user accounts / real auth.
- Scheduled/cron auto-scan (all scans are manual, passcode-gated).
- Changing the existing `DELETE /files/{id}` parent-guard.
