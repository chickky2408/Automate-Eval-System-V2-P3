# Run Sets, Orphan Scanner, and Measurement Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the future-work scope by migrating frontend run-set URLs, adding a manual orphan-file scanner, and adding per-test-case measurement settings.

**Architecture:** Keep backward-compatible frontend/store names while routing new traffic to redesigned backend resources. Use `files.deletion_candidates` for manual cleanup staging and `test_cases.config_options` / profile JSON for measurement settings without adding tables.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, React/Vite, Zustand, Python unittest.

---

### Task 1: Orphan File Scanner

**Files:**
- Create: `backend/tests/test_file_store_scanner.py`
- Modify: `backend/services/file_store.py`
- Modify: `backend/routers/files.py`

- [ ] Add a unittest that creates one registered upload and one unregistered file under a temp upload root, runs `file_store.scan_orphaned_files()`, and asserts only the unregistered file becomes a deletion candidate.
- [ ] Implement `FileStore.scan_orphaned_files()` to compare disk files under `base_path` against `FileORM.storage_path`, calculate checksum/size, and register candidates with reason `orphan_disk_file`.
- [ ] Add `POST /api/files/deletion-candidates/scan` returning `{ scanned, registered, candidates }`.

### Task 2: Run-Set Endpoint Migration

**Files:**
- Modify: `frontend/src/utils/apiEndpoints.js`

- [ ] Keep existing `TEST_SETS*` constant names for UI compatibility.
- [ ] Point the collection/detail constants to `/api/test-management/run-sets`.
- [ ] Keep item-level constants on legacy `/test-sets/{id}/items` until the UI store natively writes `test_case_ids`.

### Task 3: Measurement Settings UI

**Files:**
- Modify: `frontend/src/pages/TestCasesPage.jsx`
- Modify: `backend/routers/profiles.py` if profile sync needs mapping preservation

- [ ] Add helpers that read settings from `tc.measurementSettings`, `tc.config_options.measurement_settings`, or `tc.extraColumns.measurementSettings`.
- [ ] Add row/table controls for sampling rate, duration, channels, trigger mode, and voltage range.
- [ ] Save edits into `measurementSettings` and mirror under `extraColumns.measurementSettings` so existing profile JSON persistence keeps the data.
- [ ] Preserve measurement settings when syncing profile JSON into `TestCaseORM.config_options`.

### Task 4: Verification

**Files:**
- No new production files.

- [ ] Run targeted backend scanner test.
- [ ] Run frontend build.
- [ ] Run Python compile checks on modified backend files.
