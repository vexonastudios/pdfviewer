import test from 'node:test';
import assert from 'node:assert/strict';
import { findFlatInitialTargets } from '../src/lib/initial-targets.mjs';

test('HSEGH caregiver footer exposes two separate initials slots', () => {
  const items = [{ str: 'Caregiver initials: _____ , _____', transform: [1, 0, 0, 1, 36, 80.463], width: 149.904 }];
  const targets = findFlatInitialTargets(items, 39);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map(target => target.slot), [1, 2]);
  assert.deepEqual(targets.map(target => target.rect.map(Math.round)), [[119, 80, 148, 94], [157, 80, 186, 94]]);
  assert.notEqual(targets[0].fieldName, targets[1].fieldName);
});

test('other text does not create guessed initials targets', () => {
  assert.deepEqual(findFlatInitialTargets([{ str: 'Caregiver initials:', transform: [1, 0, 0, 1, 36, 80], width: 100 }], 1), []);
});
