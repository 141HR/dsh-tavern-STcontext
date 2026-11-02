export function parseRegex(value) {
  if (typeof value !== 'string' || !value) throw new Error('正则表达式不能为空');
  if (!value.startsWith('/')) return new RegExp(value);
  const end = value.lastIndexOf('/');
  if (end <= 0) return new RegExp(value);
  return new RegExp(value.slice(1, end), value.slice(end + 1));
}
export function nativeRegexes(document) {
  const source = document?.extensions?.regex_scripts;
  if (source === undefined) return [];
  if (!Array.isArray(source)) throw new Error('extensions.regex_scripts 必须是数组');
  return source;
}
function depthValue(value) { return value === null || value === undefined || value === '' ? null : Number(value); }
export function regexEnabled(script, { placement = 2, depth = 0, channel = 'output' } = {}) {
  if (!script || script.disabled === true || script.enabled === false) return false;
  if (!Array.isArray(script.placement) || !script.placement.map(Number).includes(placement)) return false;
  if (channel === 'prompt' && script.markdownOnly === true && script.promptOnly !== true) return false;
  const min = depthValue(script.minDepth), max = depthValue(script.maxDepth);
  return (min === null || depth >= min) && (max === null || depth <= max);
}
function replacement(script) {
  const trims = (script.trimStrings || []).map(String);
  return (...args) => {
    const named = typeof args.at(-1) === 'object' ? args.at(-1) : null;
    const captured = index => {
      // Exclude String.replace's offset and source arguments.
      const count = args.length - (named ? 3 : 2);
      let value = Number(index) < count ? String(args[Number(index)] ?? '') : '';
      for (const trim of trims) if (trim) value = value.split(trim).join('');
      return value;
    };
    return String(script.replaceString ?? '').replace(/\{\{match\}\}/gi, '$0')
      .replace(/\$(\d+)|\$<([^>]+)>|\$\$/g, (token, number, name) => {
        if (token === '$$') return '$';
        if (number !== undefined) return captured(number);
        let value = String(named?.[name] ?? '');
        for (const trim of trims) if (trim) value = value.split(trim).join('');
        return value;
      });
  };
}
export function applyRegexOnce(text, scripts, options = {}) {
  const applied = [];
  let result = String(text ?? '');
  for (const [index, script] of scripts.entries()) {
    if (!regexEnabled(script, options)) continue;
    let count = 0;
    const replace = replacement(script);
    result = result.replace(parseRegex(script.findRegex), (...args) => { count++; return replace(...args); });
    if (count) applied.push({ index, id: String(script.id || ''), name: String(script.scriptName || script.name || index), matches: count });
  }
  return { text: result, applied };
}
// Histories are immutable prose. Only input wrappers may run, and must retain
// every source character, so imported summary/deletion rules cannot drop history.
export function projectInput(text, scripts, depth) {
  const applied = [], skipped = [];
  let result = text;
  for (const [index, script] of scripts.entries()) {
    if (!regexEnabled(script, { placement: 1, depth, channel: 'prompt' })) continue;
    const next = applyRegexOnce(result, [script], { placement: 1, depth, channel: 'prompt' });
    if (!next.applied.length) continue;
    if (next.text.includes(result)) { result = next.text; applied.push(index); }
    else skipped.push(index);
  }
  return { text: result, applied, skipped };
}
