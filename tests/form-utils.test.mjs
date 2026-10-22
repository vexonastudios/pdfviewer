import test from 'node:test';
import assert from 'node:assert/strict';
import { fitFontSize, formatLocalDate, isDateSignedField } from '../src/lib/form-utils.mjs';

test('long text shrinks to its available width without enlarging short text', () => {
  assert.equal(fitFontSize(10, 200, 160), 8);
  assert.equal(fitFontSize(10, 100, 160), 10);
});

test('signing dates use the computer date and only signed-date fields qualify', () => {
  assert.equal(formatLocalDate(new Date(2026, 9, 22)), '10/22/2026');
  assert.equal(isDateSignedField({ name: 'Date Signed_2', type: 'text' }), true);
  assert.equal(isDateSignedField({ name: 'Date Form Requested', type: 'text' }), false);
});
