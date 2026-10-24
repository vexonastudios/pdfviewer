// PDF.js often splits a visible phrase across several text items. Preserve its
// own spaces rather than inserting a new space at every item boundary.
export function findTextMatch(parts, query) {
  const needle = String(query || '').trim().split(/\s+/).filter(Boolean).map(escapePattern).join('\\s+');
  if (!needle) return null;
  let text = '';
  const ranges = parts.map(part => {
    const start = text.length;
    text += String(part.text || '') + (part.hasEOL ? ' ' : '');
    return { start, end: text.length };
  });
  const match = new RegExp(needle, 'i').exec(text);
  if (!match) return null;
  return {
    text,
    start: match.index,
    end: match.index + match[0].length,
    partIndexes: ranges.flatMap((range, index) => range.end > match.index && range.start < match.index + match[0].length ? [index] : []),
  };
}

function escapePattern(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
