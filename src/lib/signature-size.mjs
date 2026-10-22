export function preferredSignatureWidth(record) {
  if (Number.isFinite(record.placementWidth) && record.placementWidth >= 20 && record.placementWidth <= 350) return record.placementWidth;
  return Math.min(160, 80 * record.width / record.height);
}

export function signatureSizeForField(record, rect) {
  const [x1, y1, x2, y2] = rect;
  const boxWidth = Math.abs(x2 - x1), boxHeight = Math.abs(y2 - y1);
  const availableWidth = Math.min(Math.max(1, boxWidth - 22), Math.max(1, boxHeight - 2) * record.width / record.height);
  const hasPreferredWidth = Number.isFinite(record.placementWidth) && record.placementWidth >= 20 && record.placementWidth <= 350;
  const width = hasPreferredWidth ? Math.min(record.placementWidth, availableWidth) : availableWidth;
  return { width, height: width * record.height / record.width };
}
