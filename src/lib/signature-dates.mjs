import { isDateSignedField } from './form-utils.mjs';

// Pair only dates on the same row and to the right of a signature. An unclear
// layout is left for the user to date with the Today button instead of silently
// dating another person's line.
export function pairSignatureDates(annotations, fields) {
  const fieldByName = new Map(fields.map(field => [field.name, field]));
  const signatures = annotations.filter(item => fieldByName.get(item.fieldName)?.type === 'signature');
  const dates = annotations.filter(item => isDateSignedField(fieldByName.get(item.fieldName)));
  const candidates = [];
  for (const signature of signatures) for (const date of dates) {
    const s = box(signature.rect), d = box(date.rect);
    const rowTolerance = Math.max(3, Math.min(s.height, d.height) * 0.5);
    if (Math.abs(s.cy - d.cy) > rowTolerance || d.left < s.cx) continue;
    candidates.push({ signature, date, score: Math.abs(s.cy - d.cy) * 10 + Math.max(0, d.left - s.right) });
  }
  candidates.sort((a, b) => a.score - b.score);
  const pairs = new Map(), usedDates = new Set();
  for (const { signature, date } of candidates) {
    if (pairs.has(signature.id) || usedDates.has(date.id)) continue;
    pairs.set(signature.id, date.fieldName);
    usedDates.add(date.id);
  }
  return pairs;
}

function box([x1, y1, x2, y2]) {
  const left = Math.min(x1, x2), right = Math.max(x1, x2);
  const bottom = Math.min(y1, y2), top = Math.max(y1, y2);
  return { left, right, cx: (left + right) / 2, cy: (bottom + top) / 2, height: top - bottom };
}
