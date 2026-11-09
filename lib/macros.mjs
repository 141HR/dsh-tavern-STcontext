// Only preset source is parsed. Substituted material is opaque, never re-parsed.
const VARIABLES = ['setvar', 'setglobalvar', 'addvar', 'addglobalvar', 'incvar', 'decvar', 'incglobalvar', 'decglobalvar', 'getvar', 'getglobalvar'];
const BUILTINS = new Set(['user', 'char', 'newline', 'trim', 'noop', 'lastusermessage', 'lastcharmessage', 'lastmessage', 'lastmessageid', 'random', 'roll', ...VARIABLES]);
export function createMacroEnvironment({ userName = '你', charName = '', history = [], input = '', random = Math.random } = {}) {
  const chat = [...history.map(row => ({ role: row.role, text: row.text })), { role: 'user', text: input }];
  return { userName, charName, random, chat, local: Object.create(null), global: Object.create(null) };
}
function parse(value) {
  const text = String(value ?? '').replace(/(?:\r?\n)*\{\{\s*trim\s*\}\}(?:\r?\n)*/gi, '');
  let offset = 0, count = 0;
  function scan(nested = false, depth = 0) {
    if (depth > 32) throw new Error('宏嵌套超过 32 层');
    const parts = [];
    while (offset < text.length) {
      if (nested && text.startsWith('}}', offset)) { offset += 2; return parts; }
      if (text.startsWith('{{', offset)) {
        if (++count > 10000) throw new Error('宏数量超过上限');
        const start = offset; offset += 2;
        if (/^\s*\/\//.test(text.slice(offset))) {
          const end = text.indexOf('}}', offset);
          if (end < 0) throw new Error('预设宏未闭合');
          offset = end + 2; continue;
        }
        const children = scan(true, depth + 1);
        parts.push({ children, raw: text.slice(start, offset) });
      } else {
        const start = offset++;
        while (offset < text.length && !text.startsWith('{{', offset) && !(nested && text.startsWith('}}', offset))) offset++;
        parts.push(text.slice(start, offset));
      }
    }
    if (nested) throw new Error('预设宏未闭合');
    return parts;
  }
  return scan();
}
function nameOf(node) { return String(node.children[0] ?? '').trim().split(/::|\s+/)[0].toLowerCase(); }
export function inspectMacros(value, { allowScript = false } = {}) {
  const unknown = new Set(), names = new Set();
  function visit(parts) {
    for (const part of parts) if (typeof part !== 'string') {
      const name = nameOf(part); names.add(name);
      if (!BUILTINS.has(name)) unknown.add(part.raw);
      visit(part.children);
    }
  }
  try { visit(parse(value)); return { unknown: [...unknown], names: [...names] }; }
  catch (error) { return { unknown: [], names: [], error: error.message }; }
}
function choose(env, count) { return Math.min(count - 1, Math.max(0, Math.floor(env.random() * count))); }
// Preserve provenance separately from variable values. Helpers still receive
// ordinary local/global strings, while native set/add/get chains retain which
// fragments came from captured identities or chat rather than preset syntax.
const variableOrigins = new WeakMap();
export function renderMacros(value, env, { allowScript = false, opaque = value => value } = {}) {
  let parts = parse(value);
  let origins = variableOrigins.get(env);
  if (!origins) { origins = { local: new Map(), global: new Map() }; variableOrigins.set(env, origins); }
  const fragment = (text, captured = false) => {
    const value = String(text ?? '');
    return value ? [{ text: value, captured }] : [];
  };
  const textOf = pieces => pieces.map(piece => piece.text).join('');
  const slice = (pieces, start, end = Infinity) => {
    const result = []; let offset = 0;
    for (const piece of pieces) {
      const from = Math.max(0, start - offset), to = Math.min(piece.text.length, end - offset);
      if (from < to) result.push({ text: piece.text.slice(from, to), captured: piece.captured });
      offset += piece.text.length;
    }
    return result;
  };
  const stored = (scope, key) => {
    const value = env[scope][key], entry = origins[scope].get(key);
    return entry && Object.is(entry.value, value) ? entry.pieces : fragment(value ?? '');
  };
  const assign = (scope, key, value, pieces = fragment(value)) => {
    env[scope][key] = value; origins[scope].set(key, { value, pieces });
  };
  function evaluate(part) {
    if (typeof part === 'string') return fragment(part);
    if (part.pieces) return part.pieces;
    const name = nameOf(part);
    if (allowScript && !BUILTINS.has(name)) return fragment(part.raw);
    if (!BUILTINS.has(name)) throw new Error('预设含尚不支持的宏：' + part.raw.slice(2, -2));
    const innerPieces = part.children.flatMap(evaluate), inner = textOf(innerPieces);
    const delimiter = inner.indexOf('::');
    let start = delimiter >= 0 ? delimiter + 2 : inner.length - inner.trimStart().length + name.length;
    let end = inner.length;
    if (delimiter < 0) { while (/\s/.test(inner[start] || '') && start < end) start++; while (end > start && /\s/.test(inner[end - 1])) end--; }
    const argsPieces = slice(innerPieces, start, end), args = textOf(argsPieces);
    if (VARIABLES.includes(name)) {
      const split = args.indexOf('::'), key = (split < 0 ? args : args.slice(0, split)).trim();
      if (!key) throw new Error('变量宏缺少变量名：' + name);
      const argPieces = split < 0 ? [] : slice(argsPieces, split + 2), arg = textOf(argPieces);
      const scope = name.includes('global') ? 'global' : 'local', store = env[scope];
      if (name.startsWith('set')) { assign(scope, key, arg, argPieces); return []; }
      if (name.startsWith('get')) return stored(scope, key);
      if (name.startsWith('inc') || name.startsWith('dec')) {
        assign(scope, key, (Number(store[key]) || 0) + (name.startsWith('inc') ? 1 : -1)); return fragment(store[key]);
      }
      const current = store[key] ?? '', left = Number(current), right = Number(arg);
      if (current !== '' && Number.isFinite(left) && Number.isFinite(right)) assign(scope, key, left + right);
      else assign(scope, key, String(current) + arg, [...stored(scope, key), ...argPieces]);
      return [];
    }
    if (name === 'random') {
      const choices = args.split('::'), selected = choose(env, choices.length);
      const offset = choices.slice(0, selected).reduce((total, choice) => total + choice.length + 2, 0);
      return slice(argsPieces, offset, offset + choices[selected].length);
    }
    if (name === 'roll') {
      const match = args.match(/^(\d+)(?:d(\d+))?$/i);
      if (!match) throw new Error('roll 的范围不受支持');
      const n = Number(match[2] ? match[1] : 1), sides = Number(match[2] || match[1]);
      if (n < 1 || n > 100 || sides < 1 || sides > 1e9) throw new Error('roll 的范围不受支持');
      return fragment(Array.from({ length: n }, () => choose(env, sides) + 1).reduce((a, b) => a + b, 0));
    }
    const chat = env.chat || [];
    const result = ({ user: env.userName, char: env.charName, newline: '\n', trim: '', noop: '',
      lastusermessage: chat.findLast(row => row.role === 'user')?.text ?? '',
      lastcharmessage: chat.findLast(row => row.role === 'assistant')?.text ?? '',
      lastmessage: chat.at(-1)?.text ?? '', lastmessageid: chat.length ? String(chat.length - 1) : '',
    })[name];
    return fragment(result, ['user', 'char', 'lastusermessage', 'lastcharmessage', 'lastmessage'].includes(name));
  }
  // Preserve the existing legacy variable-class ordering across each template.
  for (const name of VARIABLES) parts = parts.map(part => typeof part !== 'string' && !part.pieces && nameOf(part) === name ? { pieces: evaluate(part) } : part);
  return parts.flatMap(evaluate).map(piece => piece.captured ? opaque(piece.text) : piece.text).join('');
}
