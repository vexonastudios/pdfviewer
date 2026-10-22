// PDF.js text items use PDF coordinates: the origin is at the bottom left.
// These are visual signing targets for ordinary (non-AcroForm) PDF pages.
const signatureLabel = /^(?:signature(?:\s+of\s+.+)?|(?:(?:prospective\s+)?adoptive\s+parent|applicant|guardian|caregiver)(?:\s*#\s*\d+)?(?:\s+signature)?|child'?s\s+current\s+caregiver)\s*:?$/i;
const agencyRole = /\b(?:caseworker|negotiator|supervisor|broker|preparer|notary|witness|agency|official|staff|cpms|cps|dfps)\b/i;

function entries(items) {
  return items.filter(item => item?.str?.trim() && Array.isArray(item.transform))
    .map(item => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width || 0 }));
}

function overlaps(rect, other) {
  return rect[0] < other[2] && rect[2] > other[0] && rect[1] < other[3] && rect[3] > other[1];
}

export function findFlatSignatureTargets(items, annotations = [], page = 1) {
  const text = entries(items);
  const dates = text.filter(item => /^date\s+signed\s*:?$/i.test(item.text) || /^date\s*:?$/i.test(item.text));
  const labels = text.filter(item => signatureLabel.test(item.text) && !agencyRole.test(item.text));
  const widgets = annotations.filter(item => item.subtype === 'Widget' && Array.isArray(item.rect));
  const usedDates = new Set();
  const targets = [];

  for (const label of labels) {
    // A separate "Signature" word under a blank line is a caption, not the
    // text above an X. Use the nearby parent/caregiver caption to identify it.
    const caption = /^signature\s*:?$/i.test(label.text);
    if (!caption && text.some(item => /^signature\s*:?$/i.test(item.text) && Math.abs(item.y - label.y) < 3 && item.x > label.x && item.x < label.x + 180)) continue;
    if (caption && !text.some(item => item !== label && Math.abs(item.y - label.y) < 3 && item.x < label.x && /^(?:adoptive parent|applicant|guardian|caregiver)\s*$/i.test(item.text))) continue;
    const options = dates.map((date, index) => ({ date, index, gap: label.y - date.y }))
      .filter(({ date, index, gap }) => !usedDates.has(index) && date.x > label.x + 70 && gap >= -5 && gap <= 55)
      .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
    const match = options[0];
    if (!match) continue;
    const { date, index, gap } = match;
    const line = caption ? text.find(item => /^_{5,}$/.test(item.text) && item.x <= label.x && item.x + item.width >= label.x && item.y > label.y + 5 && item.y < label.y + 26) : null;
    const lowerNameRow = !line && gap > 25;
    const top = line ? line.y + 22 : lowerNameRow ? label.y - 9 : label.y - 10;
    const bottom = line ? line.y + 1 : lowerNameRow ? date.y + 13 : label.y - 37;
    const left = line ? line.x + 2 : label.x + (label.text.startsWith('Signature') ? 16 : 16);
    const right = Math.min(date.x - 7, line ? line.x + line.width : date.x - 7);
    const rect = [left, bottom, right, top];
    const dateRect = [date.x, date.y - (line ? -5 : 36), date.x + Math.max(date.width + 85, 100), date.y + (line ? 31 : -10)];
    // If the PDF already has editable widgets, use their existing controls.
    if (widgets.some(widget => overlaps(rect, widget.rect)) || widgets.some(widget => overlaps(dateRect, widget.rect))) continue;
    if (right - left < 70) continue;
    usedDates.add(index);
    targets.push({ fieldName: `flat-signature:${page}:${Math.round(label.x)}:${Math.round(label.y)}`, page, rect, label: label.text,
      date: { x: date.x + 8, y: line ? line.y + 16 : date.y - 11, label: `Signing date p${page} ${label.text} ${Math.round(label.y)}` },
      printedName: text.some(item => /^printed name\s*:?$/i.test(item.text) && Math.abs(item.y - date.y) < 3 && item.x < date.x)
        ? { x: label.x + 8, y: date.y - 11, label: `Printed name p${page} ${label.text} ${Math.round(label.y)}` }
        : null,
    });
  }
  return targets;
}
