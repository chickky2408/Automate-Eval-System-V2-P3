# Cleanup Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a passcode-gated cleanup page, reachable only from the Library page, to find and delete three kinds of orphan files (unreferenced / disk-orphan / missing) via a staged scan → review → approve flow.

**Architecture:** Backend enforces a shared passcode (`CLEANUP_PASSCODE` env) on every cleanup endpoint via a FastAPI dependency (fail-closed). New store methods stage "missing file" (B) and "unreferenced" (C) records as `deletion_candidates`; disk-orphan (A) staging already exists. Approve re-verifies unreferenced candidates against test-case references before deleting, preserving the existing parent-guard invariant. Frontend adds a Library-header button that opens a full-screen modal: passcode unlock, then scan/stage buttons, a combined candidate list, and multi-select delete.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), React (frontend), Python `unittest` `IsolatedAsyncioTestCase` for tests.

**Spec:** `docs/superpowers/specs/2026-07-21-cleanup-page-design.md`

**Note on running backend tests:** all backend test commands must set `USE_SQLITE_DEMO=1` to avoid the asyncpg/postgres import path. Run from the `backend/` directory.

---

## File Structure

**Backend**
- Create: `backend/utils/cleanup_auth.py` — the `require_cleanup_passcode` dependency.
- Modify: `backend/services/file_store.py` — add `scan_missing_files`, `stage_unreferenced_files`, `get_deletion_candidate`.
- Modify: `backend/routers/files.py` — gate cleanup endpoints, add 2 new endpoints, add approve re-verify.
- Create: `backend/tests/test_cleanup_auth.py` — passcode gate tests.
- Create: `backend/tests/test_cleanup_scans.py` — scan_missing / stage_unreferenced tests.
- Create: `backend/tests/test_cleanup_approve.py` — approve re-verify test.

**Frontend**
- Modify: `frontend/src/utils/apiEndpoints.js` — add cleanup endpoint entries.
- Modify: `frontend/src/services/api.js` — add cleanup API functions.
- Create: `frontend/src/components/CleanupModal.jsx` — passcode + overlay UI.
- Modify: `frontend/src/pages/FileLibraryPage.jsx` — header button + render modal.

---

## Task 1: Passcode dependency

**Files:**
- Create: `backend/utils/cleanup_auth.py`
- Test: `backend/tests/test_cleanup_auth.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_cleanup_auth.py`:

```python
import os
import unittest

from fastapi import HTTPException

from utils.cleanup_auth import require_cleanup_passcode


class TestCleanupPasscode(unittest.TestCase):
    def setUp(self):
        self._orig = os.environ.get("CLEANUP_PASSCODE")

    def tearDown(self):
        if self._orig is None:
            os.environ.pop("CLEANUP_PASSCODE", None)
        else:
            os.environ["CLEANUP_PASSCODE"] = self._orig

    def test_disabled_when_env_unset(self):
        os.environ.pop("CLEANUP_PASSCODE", None)
        with self.assertRaises(HTTPException) as ctx:
            require_cleanup_passcode(x_cleanup_passcode="anything")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_disabled_when_env_blank(self):
        os.environ["CLEANUP_PASSCODE"] = "   "
        with self.assertRaises(HTTPException) as ctx:
            require_cleanup_passcode(x_cleanup_passcode="anything")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_missing_header_rejected(self):
        os.environ["CLEANUP_PASSCODE"] = "secret"
        with self.assertRaises(HTTPException) as ctx:
            require_cleanup_passcode(x_cleanup_passcode=None)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_wrong_passcode_rejected(self):
        os.environ["CLEANUP_PASSCODE"] = "secret"
        with self.assertRaises(HTTPException) as ctx:
            require_cleanup_passcode(x_cleanup_passcode="nope")
        self.assertEqual(ctx.exception.status_code, 401)

    def test_correct_passcode_allowed(self):
        os.environ["CLEANUP_PASSCODE"] = "secret"
        # Should not raise
        self.assertIsNone(require_cleanup_passcode(x_cleanup_passcode="secret"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `USE_SQLITE_DEMO=1 python -m pytest tests/test_cleanup_auth.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'utils.cleanup_auth'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/utils/cleanup_auth.py`:

```python
"""Passcode gate for cleanup endpoints.

A single shared passcode from env ``CLEANUP_PASSCODE`` (no user/role system).
Fail closed: if the env var is unset/blank, cleanup is disabled entirely.
"""
from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException


def require_cleanup_passcode(
    x_cleanup_passcode: Optional[str] = Header(default=None, alias="X-Cleanup-Passcode"),
) -> None:
    """FastAPI dependency: allow the request only with the correct passcode.

    - env unset/blank -> 403 (cleanup disabled)
    - missing/wrong passcode -> 401 (constant-time compare)
    """
    expected = (os.getenv("CLEANUP_PASSCODE", "") or "").strip()
    if not expected:
        raise HTTPException(status_code=403, detail="Cleanup is disabled")
    provided = x_cleanup_passcode or ""
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid passcode")
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `USE_SQLITE_DEMO=1 python -m pytest tests/test_cleanup_auth.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/utils/cleanup_auth.py backend/tests/test_cleanup_auth.py
git commit -m "feat(cleanup): add passcode gate dependency"
```

---

## Task 2: Gate existing cleanup endpoints

Attach `require_cleanup_passcode` to the endpoints that already exist
(`/unreferenced`, `GET /deletion-candidates`, `POST /deletion-candidates/scan`,
`DELETE /deletion-candidates/{id}/approve`). No new behavior — just the gate.

**Files:**
- Modify: `backend/routers/files.py`

- [ ] **Step 1: Add imports**

In `backend/routers/files.py`, change the FastAPI import line (currently
`from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header`) to add `Depends`:

```python
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, Depends
```

Add a new import near the other service imports (after `from services.test_case_store import test_case_store`):

```python
from utils.cleanup_auth import require_cleanup_passcode
```

- [ ] **Step 2: Add the dependency to the four existing decorators**

Edit each decorator as shown (add `dependencies=[Depends(require_cleanup_passcode)]`):

```python
@router.get("/unreferenced", dependencies=[Depends(require_cleanup_passcode)])
```

```python
@router.get("/deletion-candidates", dependencies=[Depends(require_cleanup_passcode)])
```

```python
@router.post("/deletion-candidates/scan", dependencies=[Depends(require_cleanup_passcode)])
```

```python
@router.delete("/deletion-candidates/{candidate_id}/approve", dependencies=[Depends(require_cleanup_passcode)])
```

- [ ] **Step 3: Verify the app still imports**

Run: `USE_SQLITE_DEMO=1 python -c "from routers import files; print('ok')"`
Expected: prints `ok` (no import error).

- [ ] **Step 4: Commit**

```bash
git add backend/routers/files.py
git commit -m "feat(cleanup): gate existing cleanup endpoints behind passcode"
```

---

## Task 3: Scan for missing files (B) + endpoint

**Files:**
- Modify: `backend/services/file_store.py`
- Modify: `backend/routers/files.py`
- Test: `backend/tests/test_cleanup_scans.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_cleanup_scans.py`:

```python
import os
import unittest
import uuid

os.environ.setdefault("USE_SQLITE_DEMO", "1")

from sqlalchemy import delete as sa_delete

from db.database import async_session, init_db
from db.orm_models import FileORM, FileType, TestCaseORM, DeletionCandidateORM
from services.file_store import file_store
from services.test_case_store import test_case_store


async def _clean():
    async with async_session() as s:
        await s.execute(sa_delete(DeletionCandidateORM))
        await s.execute(sa_delete(TestCaseORM))
        await s.execute(sa_delete(FileORM))
        await s.commit()


async def _add_file(fid, name, storage_path, ftype=FileType.VCD):
    async with async_session() as s:
        s.add(FileORM(id=fid, filename=name, file_type=ftype,
                      storage_path=storage_path, checksum_sha256="x", size_bytes=1))
        await s.commit()


class TestCleanupScans(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await init_db()
        await _clean()

    async def asyncTearDown(self):
        await _clean()

    async def test_scan_missing_flags_only_absent_disk_files(self):
        # present-on-disk file: use this test file's own path so it exists
        here = os.path.abspath(__file__)
        await _add_file("present-1", "here.vcd", here)
        await _add_file("gone-1", "gone.vcd", "uploads/does-not-exist-xyz.vcd")

        res = await file_store.scan_missing_files()
        staged_ids = {c.get("file_id") for c in
                      await file_store.get_deletion_candidates_raw()}
        self.assertIn("gone-1", staged_ids)
        self.assertNotIn("present-1", staged_ids)
        self.assertEqual(res["registered"], 1)

    async def test_stage_unreferenced_flags_only_unlinked(self):
        await _add_file("used-1", "used.vcd", "uploads/used.vcd")
        await _add_file("free-1", "free.vcd", "uploads/free.vcd")
        async with async_session() as s:
            s.add(TestCaseORM(id=str(uuid.uuid4()), name="TC", vcd_file_id="used-1"))
            await s.commit()

        referenced = await test_case_store.get_referenced_file_ids()
        res = await file_store.stage_unreferenced_files(referenced)
        staged_ids = {c.get("file_id") for c in
                      await file_store.get_deletion_candidates_raw()}
        self.assertIn("free-1", staged_ids)
        self.assertNotIn("used-1", staged_ids)
        self.assertEqual(res["registered"], 1)


if __name__ == "__main__":
    unittest.main()
```

Note: the test uses a small raw-list helper `get_deletion_candidates_raw` added in
Step 3 (returns dicts including `file_id`). The existing `get_deletion_candidates`
already returns `file_id`, but we use the raw helper to keep the test independent
of display formatting.

- [ ] **Step 2: Run test to verify it fails**

Run: `USE_SQLITE_DEMO=1 python -m pytest tests/test_cleanup_scans.py -q`
Expected: FAIL — `AttributeError: 'FileStore' object has no attribute 'scan_missing_files'`.

- [ ] **Step 3: Add the store methods**

In `backend/services/file_store.py`, add these methods inside `class FileStore`
(place them right after the existing `scan_orphaned_files` method):

```python
    async def get_deletion_candidates_raw(self) -> List[dict]:
        """Minimal candidate dicts (id, file_id, filename, storage_path, reason)."""
        async with async_session() as session:
            result = await session.execute(select(DeletionCandidateORM))
            return [
                {
                    "id": r.id,
                    "file_id": r.file_id,
                    "filename": r.filename,
                    "storage_path": r.storage_path,
                    "reason": r.reason,
                }
                for r in result.scalars().all()
            ]

    async def get_deletion_candidate(self, candidate_id: str) -> Optional[dict]:
        """Fetch a single candidate by id (or None)."""
        async with async_session() as session:
            result = await session.execute(
                select(DeletionCandidateORM).where(DeletionCandidateORM.id == candidate_id)
            )
            r = result.scalar_one_or_none()
            if not r:
                return None
            return {
                "id": r.id,
                "file_id": r.file_id,
                "filename": r.filename,
                "storage_path": r.storage_path,
                "reason": r.reason,
            }

    async def scan_missing_files(self) -> dict:
        """Stage DB file records whose backing disk file is missing.

        reason='missing_disk_file', file_id set to the record id. Skips records
        already staged (matched by storage_path, like scan_orphaned_files).
        """
        async with async_session() as session:
            files_result = await session.execute(select(FileORM))
            files = files_result.scalars().all()
            pending_result = await session.execute(select(DeletionCandidateORM.storage_path))
            pending_paths = {row[0] for row in pending_result.all() if row[0]}

        scanned = 0
        registered = 0
        candidates: List[dict] = []
        for f in files:
            scanned += 1
            if f.storage_path in pending_paths:
                continue
            resolved = self.resolve_path(f.storage_path)
            if resolved and os.path.exists(resolved):
                continue
            candidate = await self.register_deletion_candidate(
                filename=f.filename,
                storage_path=f.storage_path,
                checksum=f.checksum_sha256 or "",
                size_bytes=f.size_bytes or 0,
                reason="missing_disk_file",
                file_id=f.id,
            )
            candidates.append(candidate)
            pending_paths.add(f.storage_path)
            registered += 1
        return {"scanned": scanned, "registered": registered, "candidates": candidates}

    async def stage_unreferenced_files(self, referenced_ids: set) -> dict:
        """Stage library files (VCD/EROM/ULP) not in referenced_ids.

        reason='unreferenced_file', file_id set. Skips files already staged.
        """
        library_types = {"VCD", "EROM", "ULP"}
        async with async_session() as session:
            files_result = await session.execute(select(FileORM))
            files = files_result.scalars().all()
            pending_result = await session.execute(select(DeletionCandidateORM.storage_path))
            pending_paths = {row[0] for row in pending_result.all() if row[0]}

        scanned = 0
        registered = 0
        candidates: List[dict] = []
        for f in files:
            type_name = f.file_type.value if hasattr(f.file_type, "value") else str(f.file_type)
            if type_name.upper() not in library_types:
                continue
            scanned += 1
            if f.id in referenced_ids:
                continue
            if f.storage_path in pending_paths:
                continue
            candidate = await self.register_deletion_candidate(
                filename=f.filename,
                storage_path=f.storage_path,
                checksum=f.checksum_sha256 or "",
                size_bytes=f.size_bytes or 0,
                reason="unreferenced_file",
                file_id=f.id,
            )
            candidates.append(candidate)
            pending_paths.add(f.storage_path)
            registered += 1
        return {"scanned": scanned, "registered": registered, "candidates": candidates}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `USE_SQLITE_DEMO=1 python -m pytest tests/test_cleanup_scans.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Add the two new endpoints**

In `backend/routers/files.py`, add these two endpoints right after the existing
`scan_deletion_candidates` endpoint (the `POST /deletion-candidates/scan` handler):

```python
@router.post("/deletion-candidates/scan-missing", dependencies=[Depends(require_cleanup_passcode)])
async def scan_missing_deletion_candidates():
    """Stage DB records whose disk file is missing (reason=missing_disk_file)."""
    return await file_store.scan_missing_files()


@router.post("/deletion-candidates/stage-unreferenced", dependencies=[Depends(require_cleanup_passcode)])
async def stage_unreferenced_deletion_candidates():
    """Stage library files not referenced by any test case (reason=unreferenced_file)."""
    referenced_ids = await test_case_store.get_referenced_file_ids()
    return await file_store.stage_unreferenced_files(referenced_ids)
```

- [ ] **Step 6: Verify routes register and order is safe**

Run:

```bash
USE_SQLITE_DEMO=1 python -c "
from routers import files
for r in files.router.routes:
    if 'deletion-candidates' in r.path or r.path=='/{file_id}':
        print(sorted(r.methods), r.path)
"
```

Expected: the `scan-missing` and `stage-unreferenced` paths appear, and every
`/deletion-candidates...` path is listed before `/{file_id}`.

- [ ] **Step 7: Commit**

```bash
git add backend/services/file_store.py backend/routers/files.py backend/tests/test_cleanup_scans.py
git commit -m "feat(cleanup): scan missing files and stage unreferenced files"
```

---

## Task 4: Approve re-verify for unreferenced candidates

Before approving an `unreferenced_file` candidate, re-check the file is still not
referenced by any test case. If it became referenced after staging, return 409 and
do not delete — this preserves the parent-guard invariant.

**Files:**
- Modify: `backend/routers/files.py`
- Test: `backend/tests/test_cleanup_approve.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_cleanup_approve.py`:

```python
import os
import unittest
import uuid

os.environ.setdefault("USE_SQLITE_DEMO", "1")

from fastapi import HTTPException
from sqlalchemy import delete as sa_delete

from db.database import async_session, init_db
from db.orm_models import FileORM, FileType, TestCaseORM, DeletionCandidateORM
from services.file_store import file_store
from services.test_case_store import test_case_store
from routers import files


async def _clean():
    async with async_session() as s:
        await s.execute(sa_delete(DeletionCandidateORM))
        await s.execute(sa_delete(TestCaseORM))
        await s.execute(sa_delete(FileORM))
        await s.commit()


class TestApproveReverify(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await init_db()
        await _clean()

    async def asyncTearDown(self):
        await _clean()

    async def test_approve_blocked_when_now_referenced(self):
        # file staged as unreferenced, then a test case attaches it
        async with async_session() as s:
            s.add(FileORM(id="f-1", filename="f.vcd", file_type=FileType.VCD,
                          storage_path="uploads/f.vcd", checksum_sha256="x", size_bytes=1))
            await s.commit()
        cand = await file_store.register_deletion_candidate(
            filename="f.vcd", storage_path="uploads/f.vcd", checksum="x",
            size_bytes=1, reason="unreferenced_file", file_id="f-1",
        )
        async with async_session() as s:
            s.add(TestCaseORM(id=str(uuid.uuid4()), name="Late TC", vcd_file_id="f-1"))
            await s.commit()

        with self.assertRaises(HTTPException) as ctx:
            await files.approve_deletion_candidate(cand["id"])
        self.assertEqual(ctx.exception.status_code, 409)

        # file still present
        async with async_session() as s:
            from sqlalchemy import select
            row = (await s.execute(select(FileORM).where(FileORM.id == "f-1"))).scalar_one_or_none()
        self.assertIsNotNone(row)

    async def test_approve_deletes_when_still_unreferenced(self):
        async with async_session() as s:
            s.add(FileORM(id="f-2", filename="g.vcd", file_type=FileType.VCD,
                          storage_path="uploads/g-not-on-disk.vcd", checksum_sha256="x", size_bytes=1))
            await s.commit()
        cand = await file_store.register_deletion_candidate(
            filename="g.vcd", storage_path="uploads/g-not-on-disk.vcd", checksum="x",
            size_bytes=1, reason="unreferenced_file", file_id="f-2",
        )
        result = await files.approve_deletion_candidate(cand["id"])
        self.assertEqual(result, {"success": True})
        async with async_session() as s:
            from sqlalchemy import select
            row = (await s.execute(select(FileORM).where(FileORM.id == "f-2"))).scalar_one_or_none()
        self.assertIsNone(row)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `USE_SQLITE_DEMO=1 python -m pytest tests/test_cleanup_approve.py -q`
Expected: FAIL — the first test does not get a 409 (approve deletes regardless).

- [ ] **Step 3: Update the approve endpoint**

In `backend/routers/files.py`, replace the existing `approve_deletion_candidate`
handler body (the one decorated with `@router.delete("/deletion-candidates/{candidate_id}/approve", ...)`)
with:

```python
@router.delete("/deletion-candidates/{candidate_id}/approve", dependencies=[Depends(require_cleanup_passcode)])
async def approve_deletion_candidate(candidate_id: str):
    """Confirm deletion. For unreferenced_file candidates, re-verify the file is
    still not referenced by any test case (guards against a test case attaching
    the file after it was staged)."""
    candidate = await file_store.get_deletion_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if candidate.get("reason") == "unreferenced_file" and candidate.get("file_id"):
        referencing = await test_case_store.find_test_cases_referencing_file(candidate["file_id"])
        if referencing:
            names = ", ".join(tc["name"] for tc in referencing[:5])
            if len(referencing) > 5:
                names += f", +{len(referencing) - 5} more"
            raise HTTPException(
                status_code=409,
                detail=f"File is now referenced by {len(referencing)} test case(s): {names}. Not deleted.",
            )

    success = await file_store.approve_deletion(candidate_id)
    if not success:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return {"success": True}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `USE_SQLITE_DEMO=1 python -m pytest tests/test_cleanup_approve.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the whole cleanup + files test group**

Run: `USE_SQLITE_DEMO=1 python -m pytest tests/test_cleanup_auth.py tests/test_cleanup_scans.py tests/test_cleanup_approve.py tests/test_files_delete_guard.py tests/test_files_unreferenced.py tests/test_files_router.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/files.py backend/tests/test_cleanup_approve.py
git commit -m "feat(cleanup): re-verify unreferenced candidates before deleting"
```

---

## Task 5: Frontend API layer

**Files:**
- Modify: `frontend/src/utils/apiEndpoints.js`
- Modify: `frontend/src/services/api.js`

- [ ] **Step 1: Add endpoint entries**

In `frontend/src/utils/apiEndpoints.js`, add these entries next to the existing
`FILE_DELETE` entry (inside the same `API_ENDPOINTS` object):

```javascript
  FILE_UNREFERENCED: `${API_BASE_URL}/files/unreferenced`,
  FILE_DELETION_CANDIDATES: `${API_BASE_URL}/files/deletion-candidates`,
  FILE_DELETION_SCAN: `${API_BASE_URL}/files/deletion-candidates/scan`,
  FILE_DELETION_SCAN_MISSING: `${API_BASE_URL}/files/deletion-candidates/scan-missing`,
  FILE_DELETION_STAGE_UNREF: `${API_BASE_URL}/files/deletion-candidates/stage-unreferenced`,
  FILE_DELETION_APPROVE: (id) => `${API_BASE_URL}/files/deletion-candidates/${id}/approve`,
```

- [ ] **Step 2: Add API functions**

In `frontend/src/services/api.js`, add near the existing `deleteFile` export:

```javascript
// ============================================
// CLEANUP APIs (passcode-gated; header X-Cleanup-Passcode)
// ============================================

const cleanupHeaders = (passcode) => ({ 'X-Cleanup-Passcode': passcode || '' });

/** List unreferenced library files (C). 200 also doubles as passcode verification. */
export const getUnreferencedFiles = (passcode) =>
  apiRequest(API_ENDPOINTS.FILE_UNREFERENCED, { headers: cleanupHeaders(passcode) });

/** List all staged deletion candidates (A/B/C). Used to verify passcode on unlock. */
export const getDeletionCandidates = (passcode) =>
  apiRequest(API_ENDPOINTS.FILE_DELETION_CANDIDATES, { headers: cleanupHeaders(passcode) });

/** Stage disk-orphan files (A). */
export const scanDiskOrphans = (passcode) =>
  apiRequest(API_ENDPOINTS.FILE_DELETION_SCAN, { method: 'POST', headers: cleanupHeaders(passcode) });

/** Stage missing-file records (B). */
export const scanMissingFiles = (passcode) =>
  apiRequest(API_ENDPOINTS.FILE_DELETION_SCAN_MISSING, { method: 'POST', headers: cleanupHeaders(passcode) });

/** Stage unreferenced library files (C). */
export const stageUnreferenced = (passcode) =>
  apiRequest(API_ENDPOINTS.FILE_DELETION_STAGE_UNREF, { method: 'POST', headers: cleanupHeaders(passcode) });

/** Approve (delete) a staged candidate. */
export const approveDeletionCandidate = (id, passcode) =>
  apiRequest(API_ENDPOINTS.FILE_DELETION_APPROVE(id), { method: 'DELETE', headers: cleanupHeaders(passcode) });
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/apiEndpoints.js frontend/src/services/api.js
git commit -m "feat(cleanup): frontend API layer for cleanup endpoints"
```

---

## Task 6: CleanupModal component

A self-contained full-screen modal: passcode entry → unlock → scan/stage buttons +
combined candidate list + multi-select delete with confirm.

**Files:**
- Create: `frontend/src/components/CleanupModal.jsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/CleanupModal.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  getDeletionCandidates,
  scanDiskOrphans,
  scanMissingFiles,
  stageUnreferenced,
  approveDeletionCandidate,
} from '../services/api';

const REASON_LABEL = {
  orphan_disk_file: 'A · disk orphan',
  missing_disk_file: 'B · missing file',
  unreferenced_file: 'C · unreferenced',
};

export default function CleanupModal({ open, onClose }) {
  const [passcode, setPasscode] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState({}); // id -> true
  const [confirming, setConfirming] = useState(false);

  const reset = useCallback(() => {
    setPasscode('');
    setUnlocked(false);
    setError('');
    setBusy(false);
    setCandidates([]);
    setSelected({});
    setConfirming(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose?.();
  }, [reset, onClose]);

  const refresh = useCallback(async (pass) => {
    const list = await getDeletionCandidates(pass);
    setCandidates(Array.isArray(list) ? list : []);
  }, []);

  const handleUnlock = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      await refresh(passcode);
      setUnlocked(true);
    } catch (e) {
      if (e.status === 403) setError('Cleanup ถูกปิด (ยังไม่ตั้ง CLEANUP_PASSCODE)');
      else if (e.status === 401) setError('passcode ไม่ถูกต้อง');
      else setError(e.message || 'error');
    } finally {
      setBusy(false);
    }
  }, [passcode, refresh]);

  const runScan = useCallback(async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn(passcode);
      await refresh(passcode);
    } catch (e) {
      setError(e.message || 'scan failed');
    } finally {
      setBusy(false);
    }
  }, [passcode, refresh]);

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const doDelete = useCallback(async () => {
    setBusy(true);
    setError('');
    const failures = [];
    for (const id of selectedIds) {
      try {
        await approveDeletionCandidate(id, passcode);
      } catch (e) {
        failures.push(`${id}: ${e.message}`);
      }
    }
    setConfirming(false);
    setSelected({});
    try { await refresh(passcode); } catch (e) { /* ignore */ }
    if (failures.length) setError(`บางไฟล์ลบไม่ได้:\n${failures.join('\n')}`);
    setBusy(false);
  }, [selectedIds, passcode, refresh]);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-gray-900 w-full h-full sm:h-[90vh] sm:max-w-4xl sm:rounded-lg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">🧹 File Cleanup</h2>
          <button onClick={handleClose} className="text-gray-500 hover:text-gray-800">✕</button>
        </div>

        {!unlocked ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
            <p className="text-sm text-gray-600 dark:text-gray-300">ใส่ passcode เพื่อเข้าจัดการไฟล์กำพร้า</p>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              className="border rounded px-3 py-2 w-64 dark:bg-gray-800"
              placeholder="passcode"
              autoFocus
            />
            {error && <p className="text-red-500 text-sm whitespace-pre-line">{error}</p>}
            <button
              onClick={handleUnlock}
              disabled={busy || !passcode}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            >
              {busy ? '...' : 'ปลดล็อก'}
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-gray-200 dark:border-gray-700">
              <button onClick={() => runScan(scanDiskOrphans)} disabled={busy} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">Scan A (disk orphan)</button>
              <button onClick={() => runScan(scanMissingFiles)} disabled={busy} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">Scan B (missing)</button>
              <button onClick={() => runScan(stageUnreferenced)} disabled={busy} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">Stage C (unreferenced)</button>
              <button
                onClick={() => setConfirming(true)}
                disabled={busy || selectedIds.length === 0}
                className="ml-auto px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50"
              >
                Delete selected ({selectedIds.length})
              </button>
            </div>

            {error && <p className="px-5 py-2 text-red-500 text-sm whitespace-pre-line">{error}</p>}

            <div className="flex-1 overflow-auto px-5 py-2">
              {candidates.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">ไม่มี candidate — กด Scan/Stage ด้านบน</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 w-8"></th>
                      <th className="py-2">filename</th>
                      <th className="py-2">reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr key={c.id} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2">
                          <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggle(c.id)} />
                        </td>
                        <td className="py-2">{c.filename}</td>
                        <td className="py-2 text-gray-500">{REASON_LABEL[c.reason] || c.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {confirming && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-900 rounded-lg p-5 w-80">
              <p className="text-sm mb-4">ลบ {selectedIds.length} ไฟล์? ทำแล้วย้อนไม่ได้</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirming(false)} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">ยกเลิก</button>
                <button onClick={doDelete} disabled={busy} className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50">ลบ</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (no syntax/import errors). If the project uses a different
build command, use the one in `frontend/package.json` `scripts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CleanupModal.jsx
git commit -m "feat(cleanup): CleanupModal component (passcode + staged delete UI)"
```

---

## Task 7: Wire the button into the Library page

**Files:**
- Modify: `frontend/src/pages/FileLibraryPage.jsx`

- [ ] **Step 1: Import the modal**

Near the top of `frontend/src/pages/FileLibraryPage.jsx`, next to the existing
component import `import UploadChoiceModal from '../components/UploadChoiceModal';`,
add:

```javascript
import CleanupModal from '../components/CleanupModal';
```

- [ ] **Step 2: Add open/close state**

Find the block of `useState` declarations for modals (search for
`const [isImportModalOpen, setIsImportModalOpen] = useState(false);`). Add directly
below it:

```javascript
  const [cleanupOpen, setCleanupOpen] = useState(false);
```

- [ ] **Step 3: Add the header button**

Locate the Library page header/toolbar area (search for where the Import/Upload
buttons are rendered — near the `isImportModalOpen` usage or the page title). Add a
button alongside the existing header actions:

```jsx
<button
  type="button"
  onClick={() => setCleanupOpen(true)}
  className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm"
  title="จัดการไฟล์กำพร้า (ต้องมี passcode)"
>
  🧹 Cleanup
</button>
```

- [ ] **Step 4: Render the modal**

Near where other modals are rendered at the end of the component's JSX (search for
`<UploadChoiceModal` or the closing of the returned fragment), add:

```jsx
<CleanupModal open={cleanupOpen} onClose={() => setCleanupOpen(false)} />
```

- [ ] **Step 5: Verify the build compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

Start the backend with a passcode set and the frontend, then:
1. Open the Library page, click **🧹 Cleanup**.
2. Wrong passcode → "passcode ไม่ถูกต้อง". With no `CLEANUP_PASSCODE` set on the
   server → "Cleanup ถูกปิด".
3. Correct passcode → overlay opens. Click **Stage C** → unreferenced files appear.
4. Select one, **Delete selected** → confirm → it disappears from the list.
5. Verify in the Library the file is gone.

Backend start (example):

```bash
cd backend && USE_SQLITE_DEMO=1 CLEANUP_PASSCODE=test1234 python -m uvicorn main:app --port 8000
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/FileLibraryPage.jsx
git commit -m "feat(cleanup): add Cleanup button + modal to Library page"
```

---

## Self-Review Notes

- **Spec coverage:** passcode dependency (Task 1), gate existing endpoints (Task 2),
  B scan + C stage endpoints (Task 3), approve re-verify → 409 (Task 4), frontend
  API (Task 5), modal UI with passcode + staged delete + reason column (Task 6),
  Library-only entry point (Task 7). Error handling (401/403/409/404) covered in the
  dependency, approve endpoint, and modal.
- **Approve per reason:** `approve_deletion` (unchanged) already deletes disk-only for
  A (file_id None) and calls `delete_file` for B/C (file_id set); `delete_file`
  tolerates a missing disk file, so B works. Only C needs the extra re-verify, added
  in Task 4.
- **Type consistency:** store methods `scan_missing_files`, `stage_unreferenced_files`,
  `get_deletion_candidate`, `get_deletion_candidates_raw`; reasons
  `orphan_disk_file` / `missing_disk_file` / `unreferenced_file` used identically in
  backend and the frontend `REASON_LABEL` map. API function names match between
  `api.js` and `CleanupModal.jsx` imports.
- **Route order:** new `/deletion-candidates/*` paths are declared before `/{file_id}`
  (verified in Task 3 Step 6), so they are not captured as file ids.
```
