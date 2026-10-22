import test from 'node:test';
import assert from 'node:assert/strict';
import { findFlatSignatureTargets } from '../src/lib/signature-targets.mjs';

const item = (str, x, y, width = 90) => ({ str, transform: [1, 0, 0, 1, x, y], width });

test('flat adoption worksheets pair parent signature lines with their own dates', () => {
  const items = [
    item('Adoptive Parent #1:', 42, 453), item('Date Signed:', 285, 453, 60), item('X', 42, 433),
    item('Adoptive Parent #2:', 42, 411), item('Date Signed:', 285, 411, 60), item('X', 42, 391),
    item('DFPS Caseworker:', 42, 369), item('Date Signed:', 285, 369, 60),
  ];
  const targets = findFlatSignatureTargets(items, [], 5);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map(target => target.label), ['Adoptive Parent #1:', 'Adoptive Parent #2:']);
  assert.equal(targets[0].date.y, 442);
  assert.equal(targets[1].date.y, 400);
  assert.ok(targets[0].rect[1] > targets[1].rect[3]);
});

test('fillable signature and date widgets keep their original controls', () => {
  const items = [item('Signature of Prospective Adoptive Parent:', 42, 234, 190), item('Date Signed:', 285, 230, 60)];
  const annotations = [
    { subtype: 'Widget', rect: [58, 203, 279, 229] },
    { subtype: 'Widget', rect: [281, 204, 575, 230] },
  ];
  assert.deepEqual(findFlatSignatureTargets(items, annotations, 2), []);
});

test('date on a lower printed-name row pairs with the signature above it', () => {
  const items = [item('Signature of prospective adoptive parent:', 42, 553, 190), item('Printed name:', 42, 510), item('Date signed:', 285, 510, 58), item('Signature of prospective adoptive parent:', 42, 468, 190), item('Printed name:', 42, 426), item('Date signed:', 285, 426, 58)];
  const targets = findFlatSignatureTargets(items, [], 39);
  assert.equal(targets.length, 2);
  assert.ok(targets[0].rect[1] > 510);
  assert.ok(targets[1].rect[3] < 468);
  assert.equal(targets[0].date.y, 499);
  assert.equal(targets[1].date.y, 415);
});

test('signature and date captions below blank lines pair once per row', () => {
  const items = [
    item('____________________________________', 90, 141, 216), item('____________', 342, 141, 72),
    item('Adoptive Parent', 90, 127, 73), item('Signature', 165, 127, 46), item('Date', 342, 127, 21),
    item('____________________________________', 90, 100, 216), item('____________', 342, 100, 72),
    item('Adoptive Parent', 90, 86, 73), item('Signature', 165, 86, 46), item('Date', 342, 86, 21),
  ];
  const targets = findFlatSignatureTargets(items, [], 1);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map(target => target.rect[1]), [142, 101]);
  assert.deepEqual(targets.map(target => target.date.y), [157, 116]);
});
