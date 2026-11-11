// Extract player-facing suggestion chips from a generated reply. Generic across
// presets that emit <advice> / <option> tags (Izumi-style side-channel suggestions);
// no preset name or fingerprint is involved. Pure string parsing, bounded output.
const MAX_ITEMS = 12;
const MAX_LABEL = 200;

function clean(value) {
  return String(value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function extractSuggestions(text) {
  const source = String(text ?? '');
  const items = [];
  for (const match of source.matchAll(/<advice\b[^>]*>([\s\S]*?)<\/advice\s*>/gi)) {
    const label = clean(match[1]);
    if (label) items.push(label);
  }
  for (const match of source.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option\s*>/gi)) {
    const label = clean(match[1]);
    if (label) items.push(label);
  }
  const seen = new Set();
  return items.filter(label => (seen.has(label) ? false : (seen.add(label), true)))
    .slice(0, MAX_ITEMS).map(label => label.slice(0, MAX_LABEL));
}
