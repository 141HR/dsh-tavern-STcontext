// Deliberately limited legacy ST macro interpreter. It never evaluates JavaScript.
const SCRIPT_MACROS = new Set(['novel_title', 'current_chapter_file', 'current_preview_file', 'perspective', 'perspective_rules', 'target_length', 'zishu']);
export function createMacroEnvironment({ userName = '你', charName = '', random = Math.random } = {}) {
  return { userName, charName, random, local: Object.create(null), global: Object.create(null) };
}
function choose(env, count) { return Math.min(count - 1, Math.max(0, Math.floor(env.random() * count))); }
export function renderMacros(value, env, { allowScript = false } = {}) {
  let text = String(value ?? '').replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
  text = text.replace(/\{\{roll(?:::|\s+)(\d+)(?:d(\d+))?\}\}/gi, (_, first, faces) => {
    const n = Number(faces ? first : 1), sides = Number(faces || first);
    if (n < 1 || n > 100 || sides < 1 || sides > 1e9) throw new Error('roll 的范围不受支持');
    return String(Array.from({ length: n }, () => choose(env, sides) + 1).reduce((a, b) => a + b, 0));
  });
  // Legacy ST resolves variable macro classes before identity/random macros.
  for (const [name, scope, action] of [
    ['setvar', 'local', 'set'], ['setglobalvar', 'global', 'set'],
    ['addvar', 'local', 'add'], ['addglobalvar', 'global', 'add'],
    ['incvar', 'local', 'inc'], ['decvar', 'local', 'dec'],
    ['getvar', 'local', 'get'], ['getglobalvar', 'global', 'get'],
  ]) {
    const pattern = new RegExp('\\{\\{\\s*' + name + '::([^{}]*?)\\}\\}', 'gi');
    text = text.replace(pattern, (_, args) => {
      const split = args.indexOf('::'), key = (split < 0 ? args : args.slice(0, split)).trim();
      const arg = split < 0 ? '' : args.slice(split + 2);
      const store = env[scope];
      if (action === 'set') { store[key] = arg; return ''; }
      if (action === 'get') return String(store[key] ?? '');
      if (action === 'inc' || action === 'dec') {
        store[key] = (Number(store[key]) || 0) + (action === 'inc' ? 1 : -1); return String(store[key]);
      }
      const current = store[key] ?? '', n = Number(current), right = Number(arg);
      store[key] = current !== '' && Number.isFinite(n) && Number.isFinite(right) ? n + right : String(current) + arg;
      return '';
    });
  }
  text = text.replace(/\{\{\s*(user|char|newline|trim)\s*\}\}/gi, (_, name) =>
    ({ user: env.userName, char: env.charName, newline: '\n', trim: '' })[name.toLowerCase()]);
  text = text.replace(/\{\{random::([^{}]*?)\}\}/gi, (_, args) => {
    const values = args.split('::'); return values[choose(env, values.length)];
  });
  const unknown = [...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(match => match[1].trim())
    .filter(name => !(allowScript && SCRIPT_MACROS.has(name)));
  if (unknown.length) throw new Error('预设含尚不支持的宏：' + [...new Set(unknown)].slice(0, 8).join('、'));
  return text;
}
