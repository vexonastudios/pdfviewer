import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredSignatureWidth, signatureSizeForField, initialSizeForField } from '../src/lib/signature-size.mjs';

const signature = { width: 800, height: 200 };

test('a saved signature width becomes the next placement width', () => {
  assert.equal(preferredSignatureWidth({ ...signature, placementWidth: 56 }), 56);
  assert.deepEqual(signatureSizeForField({ ...signature, placementWidth: 56 }, [0, 0, 200, 80]), { width: 56, height: 14 });
});

test('the preferred width still fits smaller signature fields', () => {
  assert.deepEqual(signatureSizeForField({ ...signature, placementWidth: 120 }, [0, 0, 70, 20]), { width: 48, height: 12 });
});

test('signatures without a saved width retain the original placement sizing', () => {
  assert.equal(preferredSignatureWidth(signature), 160);
  assert.deepEqual(signatureSizeForField(signature, [0, 0, 200, 80]), { width: 178, height: 44.5 });
});

test('saved initials use a small default and stay within a printed blank', () => {
  const initials = { kind: 'initials', width: 240, height: 120 };
  assert.equal(preferredSignatureWidth(initials), 32);
  assert.deepEqual(initialSizeForField(initials, [119, 80, 148, 94]), { width: 24, height: 12 });
});
