import test from 'node:test';
import assert from 'node:assert/strict';
import { isTestCasePrimaryFileSetComplete } from './testCasePrimaryFiles.js';

test('accepts testcase with only VCD selected', () => {
  assert.equal(
    isTestCasePrimaryFileSetComplete({ vcdName: 'case.vcd', binName: '', linName: '' }),
    true
  );
});

test('rejects testcase without VCD even when optional files are selected', () => {
  assert.equal(
    isTestCasePrimaryFileSetComplete({ vcdName: '', binName: 'fw.erom', linName: 'logic.ulp' }),
    false
  );
});
