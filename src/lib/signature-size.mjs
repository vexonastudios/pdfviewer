export function preferredSignatureWidth(record) {
  if (Number.isFinite(record.placementWidth) && record.placementWidth >= 5 && record.placementWidth <= 350) return record.placementWidth;
  if (record.kind === 'initials') return Math.max(5, Math.min(32, 16 * record.width / record.height));
  return Math.min(160, 80 * record.width / record.height);
}

export function initialSizeForField(record, rect) {
  const boxWidth = Math.abs(rect[2] - rect[0]);
  const boxHeight = Math.abs(rect[3] - rect[1]);
  const width = Math.min(preferredSignatureWidth(record), boxWidth - 2, (boxHeight - 2) * record.width / record.height);
  if (width < 5) throw new Error('These initials are too narrow to fit this line. Draw or import a wider mark.');
  return { width, height: width * record.height / record.width };
}

export function signatureSizeForField(record, rect) {
  const [x1, y1, x2, y2] = rect;
  const boxWidth = Math.abs(x2 - x1), boxHeight = Math.abs(y2 - y1);
  const availableWidth = Math.min(Math.max(1, boxWidth - 22), Math.max(1, boxHeight - 2) * record.width / record.height);
  const hasPreferredWidth = Number.isFinite(record.placementWidth) && record.placementWidth >= 20 && record.placementWidth <= 350;
  const width = hasPreferredWidth ? Math.min(record.placementWidth, availableWidth) : availableWidth;
  return { width, height: width * record.height / record.width };
}
