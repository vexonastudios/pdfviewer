import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSignaturePixels } from '../src/lib/signature-image.mjs';

test('cleans paper and shadows while cropping around the original ink', () => {
  const width = 80, height = 40;
  const source = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < source.length; i += 4) source.set([225, 225, 225, 255], i);
  for (let x = 28; x <= 47; x++) source.set([18, 20, 26, 255], (20 * width + x) * 4);
  const cleaned = cleanSignaturePixels(source, width, height);
  assert.ok(cleaned.width < width && cleaned.height < height);
  const opaque = Array.from({ length: cleaned.width * cleaned.height }, (_, index) => cleaned.pixels[index * 4 + 3]).filter(alpha => alpha > 24);
  assert.equal(opaque.length, 20);
  assert.equal(cleaned.pixels[3], 0);
  assert.ok(opaque.every(alpha => alpha > 200));
});

test('rejects a blank page without inventing a signature', () => {
  const blank = new Uint8ClampedArray(40 * 30 * 4);
  for (let i = 0; i < blank.length; i += 4) blank.set([255, 255, 255, 255], i);
  assert.throws(() => cleanSignaturePixels(blank, 40, 30), /No dark signature ink/);
});
