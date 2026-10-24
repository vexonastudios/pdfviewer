import test from 'node:test';
import assert from 'node:assert/strict';
import { findTextMatch } from '../src/lib/search.mjs';
import { pairSignatureDates } from '../src/lib/signature-dates.mjs';

test('search finds a phrase across PDF text pieces without inventing spaces', () => {
  const match = findTextMatch([{ text: 'Alpha' }, { text: ' ' }, { text: 'Beta' }], 'alpha beta');
  assert.deepEqual(match.partIndexes, [0, 1, 2]);
  assert.equal(match.text, 'Alpha Beta');
  assert.equal(findTextMatch([{ text: 'Alpha' }, { text: 'Beta' }], 'Alpha Beta'), null);
  assert.ok(findTextMatch([{ text: 'A.' }, { text: '\n' }, { text: 'B' }], 'a. b'));
});

test('signature dates pair uniquely within the same row and to the right', () => {
  const fields = [
    { name: 'Sig1', type: 'signature' }, { name: 'Sig2', type: 'signature' },
    { name: 'Date Signed 1', type: 'text' }, { name: 'Date Signed 2', type: 'text' },
  ];
  const annotations = [
    { id: 's1', fieldName: 'Sig1', rect: [10, 100, 200, 140] },
    { id: 's2', fieldName: 'Sig2', rect: [10, 40, 200, 80] },
    { id: 'd1', fieldName: 'Date Signed 1', rect: [230, 100, 320, 140] },
    { id: 'd2', fieldName: 'Date Signed 2', rect: [230, 40, 320, 80] },
  ];
  const pairs = pairSignatureDates(annotations, fields);
  assert.equal(pairs.get('s1'), 'Date Signed 1');
  assert.equal(pairs.get('s2'), 'Date Signed 2');
  assert.equal(pairs.size, 2);
});

test('ambiguous layouts do not auto-fill a nearby date on another row', () => {
  const fields = [{ name: 'Signature', type: 'signature' }, { name: 'Date Signed', type: 'text' }];
  const annotations = [
    { id: 's', fieldName: 'Signature', rect: [10, 100, 200, 140] },
    { id: 'd', fieldName: 'Date Signed', rect: [230, 50, 320, 90] },
  ];
  assert.equal(pairSignatureDates(annotations, fields).size, 0);
});
