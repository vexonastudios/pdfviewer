export function fitFontSize(base, measuredWidth, availableWidth) {
  if (!(base > 0) || !(measuredWidth > 0) || !(availableWidth > 0)) return base;
  return Math.max(1, Math.min(base, Math.floor(base * availableWidth / measuredWidth * 100) / 100));
}

export function isDateSignedField(field) {
  return field?.type === 'text' && /\bdate\s+signed\b/i.test(`${field.name} ${field.label || ''}`.replace(/[_-]/g, ' '));
}

export function formatLocalDate(date = new Date()) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}
