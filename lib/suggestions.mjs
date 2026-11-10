// Generic extractor for AI generation suggestions, choices, and action options
// embedded in model responses across community presets (e.g. <advice>, <suggest>,
// <options>, <actions>, 【建议：...】, etc.).
// No preset-specific logic or character names are hardcoded here.

const TAG_RE = /<(?<tag>advice|suggest(?:ion)?s?|options?|actions?|choices?|plot_branches?)\b[^>]*>(?<content>[\s\S]*?)<\/\k<tag>\s*>/gi;
const BRACKET_RE = /[【\[](?:行动建议|剧情建议|建议|选项|可选项|备选行动|建议行动|advice|suggest(?:ion)?s?|options?)[：:]\s*(?<content>[^】\]]+?)[】\]]/gi;
const THOUGHT_RE = /<(?:think|thought|details)\b[^>]*>[\s\S]*?<\/(?:think|thought|details)\s*>/gi;
const ROLE_PREFIX_RE = /^(?:Master|玩家|User|You|你|玩家本人|Master本人)[：:]\s*/i;
const NUMBERED_LINE_RE = /^(?:(?:\d+|[A-Za-z])[.、)）]|[-*•]|\([0-9A-Za-z]+\))\s*/;
const NUMBERED_CHECK_RE = /^(?:(?:\d+|[A-Za-z])[.、)）]|[-*•]|\([0-9A-Za-z]+\))\s+\S/;

export function extractSuggestions(rawText, { maxItems = 6, maxItemLength = 500, maxLabelLength = 60 } = {}) {
  if (!rawText || typeof rawText !== 'string') return [];
  // Strip out thought blocks so we don't extract suggestions echoed within reasoning.
  const cleanSource = rawText.replace(THOUGHT_RE, '').trim();
  if (!cleanSource) return [];

  const candidates = [];

  for (const match of cleanSource.matchAll(TAG_RE)) {
    const content = match.groups?.content?.trim();
    if (content) candidates.push(content);
  }

  for (const match of cleanSource.matchAll(BRACKET_RE)) {
    const content = match.groups?.content?.trim();
    if (content) candidates.push(content);
  }

  if (!candidates.length) return [];

  const items = [];
  for (const raw of candidates) {
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const isMultiChoice = lines.length > 1 && lines.every(line => NUMBERED_CHECK_RE.test(line));

    if (isMultiChoice) {
      for (const line of lines) {
        const cleaned = line.replace(NUMBERED_LINE_RE, '').trim();
        const textToFill = stripRolePrefix(cleaned || line);
        if (textToFill) items.push({ label: line, text: textToFill });
      }
    } else {
      // Check for inline split: e.g. "1、询问情况 2、装作没听见 3、拔枪戒备"
      const inlineSplit = raw.split(/(?<=\S)\s+(?=(?:\d+|[A-Za-z])[.、)）])/);
      if (inlineSplit.length > 1 && inlineSplit.every(p => /^(?:\d+|[A-Za-z])[.、)）]/.test(p.trim()))) {
        for (const part of inlineSplit) {
          const trimmed = part.trim();
          const cleaned = trimmed.replace(NUMBERED_LINE_RE, '').trim();
          const textToFill = stripRolePrefix(cleaned || trimmed);
          if (textToFill) items.push({ label: trimmed, text: textToFill });
        }
      } else {
        const textToFill = stripRolePrefix(raw);
        if (textToFill) items.push({ label: textToFill, text: textToFill });
      }
    }
  }

  const seen = new Set();
  const result = [];
  for (const item of items) {
    const text = item.text.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxItemLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const label = item.label.replace(/[\r\n\t]+/g, ' ').trim();
    result.push({
      label: label.length > maxLabelLength ? label.slice(0, maxLabelLength - 1) + '…' : label,
      text,
    });
    if (result.length >= maxItems) break;
  }
  return result;
}

function stripRolePrefix(text) {
  return String(text || '').replace(ROLE_PREFIX_RE, '').trim();
}
