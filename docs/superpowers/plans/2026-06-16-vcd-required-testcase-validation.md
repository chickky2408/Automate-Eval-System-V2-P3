# VCD Required Testcase Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VCD the only mandatory testcase file while keeping EROM and ULP optional.

**Architecture:** Frontend validation is centralized in `frontend/src/utils/testCasePrimaryFiles.js`; update callers through that helper and align user-facing messages in `TestCasesPage.jsx`. Backend keeps `vcd_file_id` required and adds explicit empty-string validation in `backend/models/test_case.py`.

**Tech Stack:** React/Vite frontend, FastAPI/Pydantic backend, Node built-in test runner for the helper, Python unittest for Pydantic validation.

---

### Task 1: Frontend File Requirement Helper

**Files:**
- Modify: `frontend/src/utils/testCasePrimaryFiles.js`
- Create: `frontend/src/utils/testCasePrimaryFiles.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isTestCasePrimaryFileSetComplete } from './testCasePrimaryFiles.js';

test('accepts testcase with only VCD selected', () => {
  assert.equal(isTestCasePrimaryFileSetComplete({ vcdName: 'case.vcd', binName: '', linName: '' }), true);
});

test('rejects testcase without VCD even when optional files are selected', () => {
  assert.equal(isTestCasePrimaryFileSetComplete({ vcdName: '', binName: 'fw.erom', linName: 'logic.ulp' }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/utils/testCasePrimaryFiles.test.mjs`

Expected: FAIL because the current helper still requires `binName` and `linName`.

- [ ] **Step 3: Write minimal implementation**

```js
export function isTestCasePrimaryFileSetComplete(tc) {
  const v = String(tc?.vcdName ?? '').trim();
  return Boolean(v);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/utils/testCasePrimaryFiles.test.mjs`

Expected: PASS.

### Task 2: Backend VCD Validation

**Files:**
- Modify: `backend/models/test_case.py`
- Create: `backend/tests/test_test_case_model.py`

- [ ] **Step 1: Write the failing test**

```python
import unittest
from pydantic import ValidationError

from models.test_case import TestCaseCreate


class TestTestCaseCreateValidation(unittest.TestCase):
    def test_accepts_vcd_without_optional_erom_or_ulp(self):
        data = TestCaseCreate(name="TC1", vcd_file_id="vcd-1")

        self.assertEqual(data.vcd_file_id, "vcd-1")
        self.assertIsNone(data.bin_file_id)
        self.assertIsNone(data.lin_file_id)

    def test_rejects_blank_vcd_file_id(self):
        with self.assertRaises(ValidationError):
            TestCaseCreate(name="TC1", vcd_file_id="   ")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest backend.tests.test_test_case_model -v`

Expected: FAIL because blank `vcd_file_id` is currently accepted.

- [ ] **Step 3: Write minimal implementation**

Add a Pydantic validator that trims and rejects empty `vcd_file_id`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest backend.tests.test_test_case_model -v`

Expected: PASS.

### Task 3: User-Facing Messages

**Files:**
- Modify: `frontend/src/pages/TestCasesPage.jsx`

- [ ] **Step 1: Replace outdated copy**

Update messages mentioning all three required files to state: `VCD is required; ERoM and ULP are optional`.

- [ ] **Step 2: Verify no stale required copy remains**

Run: `rg -n "all three required|needs VCD, ERoM, and ULP|VCD, BIN/EROM, and ULP" frontend/src/pages/TestCasesPage.jsx frontend/src/utils/testCasePrimaryFiles.js`

Expected: No matches.
