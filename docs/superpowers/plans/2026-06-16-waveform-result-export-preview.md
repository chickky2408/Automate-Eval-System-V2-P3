# Waveform Result Export and Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend `.h5`/`.csv` export and saved-result preview while keeping `.h5` as the canonical waveform artifact.

**Architecture:** Create backend waveform utility functions for HDF5 schema detection, preview downsampling, and CSV generation. Wire those helpers into result routes, then add frontend API endpoints and UI mode controls to preview stored result waveforms in the renamed Waveform Viewer page.

**Tech Stack:** FastAPI, h5py, NumPy, React/Vite, Node test runner, Python unittest.

---

### Task 1: Backend HDF5 Utilities

**Files:**
- Create: `backend/services/waveform_file.py`
- Create: `backend/tests/test_waveform_file.py`

- [ ] Write failing tests for `raw` HDF5 preview and CSV conversion.
- [ ] Run `pipenv run python -m unittest tests.test_waveform_file -v` and verify failures.
- [ ] Implement `read_waveform_preview()` and `waveform_csv_text()`.
- [ ] Rerun the focused test and verify it passes.

### Task 2: Backend Result Export Routes

**Files:**
- Modify: `backend/routers/results.py`
- Create: `backend/tests/test_results_export_routes.py`

- [ ] Write failing route tests for invalid format and missing waveform path.
- [ ] Add `GET /{result_id}/preview` and `GET /{result_id}/export`.
- [ ] Keep `GET /{result_id}/download` as backward-compatible `.h5` download.
- [ ] Run focused backend route tests.

### Task 3: Frontend API and Rename

**Files:**
- Modify: `frontend/src/utils/apiEndpoints.js`
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/WaveformPage.jsx`
- Create: `frontend/src/utils/resultWaveformExport.js`
- Create: `frontend/src/utils/resultWaveformExport.test.mjs`

- [ ] Write failing tests for result export URL helpers.
- [ ] Add endpoint constants and API wrappers.
- [ ] Rename nav/page title to `Waveform Viewer`.
- [ ] Add result preview controls and download actions.
- [ ] Run focused frontend tests.

### Task 4: Verification

**Files:**
- No new files.

- [ ] Run backend waveform tests.
- [ ] Run frontend helper tests.
- [ ] Compile touched backend modules.
- [ ] Search for stale `Realtime Waveform` labels that should be renamed.
