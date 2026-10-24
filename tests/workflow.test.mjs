import test from 'node:test';
import assert from 'node:assert/strict';
import { saveBeforeAction } from '../src/lib/workflow.mjs';

test('Save first completes the pending navigation only after a successful save', async () => {
  const calls = [];
  assert.equal(await saveBeforeAction(async () => { calls.push('save'); return true; }, async () => { calls.push('open next PDF'); }), true);
  assert.deepEqual(calls, ['save', 'open next PDF']);
  assert.equal(await saveBeforeAction(async () => false, async () => { calls.push('should not open'); }), false);
  assert.deepEqual(calls, ['save', 'open next PDF']);
});
