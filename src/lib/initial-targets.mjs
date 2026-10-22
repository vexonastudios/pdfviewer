// PDF.js text coordinates have their origin at the bottom left. The HSEGH
// caregiver footer uses the same printed line on every page of the report.
const caregiverLine = /^Caregiver initials:\s*_{5}\s*,\s*_{5}$/i;

export function findFlatInitialTargets(items, page = 1) {
  const targets = [];
  for (const item of items) {
    if (!item?.str || !Array.isArray(item.transform) || !caregiverLine.test(item.str.trim())) continue;
    const x = item.transform[4], y = item.transform[5];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const scale = (item.width || 149.904) / 149.904;
    // The two five-underscore blanks in Form K-908-2649 start 83 and 121
    // points after the text item. Keep the clickable box just above each line.
    for (const [slot, offset] of [[1, 83], [2, 121]]) {
      const left = x + offset * scale;
      targets.push({
        kind: 'initials', slot, page,
        fieldName: `flat-initial:${page}:${Math.round(x)}:${Math.round(y)}:${slot}`,
        label: `Caregiver initials ${slot}`,
        rect: [left, y, left + 29 * scale, y + 14],
      });
    }
  }
  return targets;
}
