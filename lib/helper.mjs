import { createHash, randomBytes } from 'node:crypto';
import { parse } from './vendor/parser.mjs';
import { MAX_SCRIPT_BYTES } from './script-syntax.mjs';
import { executeScript } from './sandbox.mjs';
import { helperGuest } from './helper-guest.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const MAX_BUNDLED_HELPER_BYTES = 4 * 1024 * 1024;
const BUNDLED_HOOK_RE = /\b(?:CHAT_COMPLETION_PROMPT_READY|CHAT_COMPLETION_SETTINGS_READY|MESSAGE_RECEIVED|chat_completion_prompt_ready|chat_completion_settings_ready|message_received|registerFunctionTool|ToolManager)\b/;
const BUNDLED_UI_RE = /\b(?:createElement|querySelector|MutationObserver|localStorage|addEventListener)\b/;

export function isBundledHelperScript(source = '') {
  const text = String(source || '');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (!bytes || bytes > MAX_BUNDLED_HELPER_BYTES) return false;
  return BUNDLED_HOOK_RE.test(text) && (bytes > MAX_SCRIPT_BYTES || BUNDLED_UI_RE.test(text));
}

// Identifies the SPreset engine bootstrap, not a preset. Its configured engine
// is implemented locally; remote code is never fetched, cached or executed.
const BUILTIN_BOOTSTRAPS = new Set(['8298258224ebc3edaae17072b3bd93004f5cef05c479fa6012603dc049e3c632']);
export function helperScripts(doc) {
  const list = doc.extensions?.tavern_helper?.scripts ?? [];
  if (!Array.isArray(list)) throw new Error('酒馆助手 scripts 必须是数组');
  const result = [];
  function visit(items) {
    for (const item of items) {
      if (item?.enabled === false) continue;
      if (item?.type === 'folder' && Array.isArray(item.scripts)) { visit(item.scripts); continue; }
      if (item?.enabled !== true) continue;
      result.push({ id: String(item.id || 'script-' + result.length), name: String(item.name || item.id || '未命名脚本'), content: String(item.content || '') });
    }
  }
  visit(list);
  if (result.length > 32) throw new Error('启用的助手脚本超过 32 个');
  return result;
}
export function inspectHelpers(doc) {
  const scripts = helperScripts(doc), diagnostics = [];
  const reports = scripts.map((script, index) => {
    const source = script.content.replace(/\r\n/g, '\n').trim(), fingerprint = hash(source);
    const builtin = BUILTIN_BOOTSTRAPS.has(fingerprint) && !!doc.extensions?.SPreset;
    const bundled = !builtin && isBundledHelperScript(source);
    const add = (severity, message) => diagnostics.push({ severity, stage: 'helper', path: 'extensions.tavern_helper.scripts[' + index + '] (' + script.name + ')', message });
    if (builtin) add('warning', 'SPreset 引擎加载器由内置接口接管，不下载或执行远程代码。');
    else try {
      const maxBytes = bundled ? MAX_BUNDLED_HELPER_BYTES : MAX_SCRIPT_BYTES;
      if (!source || Buffer.byteLength(source) > maxBytes) throw Error('脚本必须非空且不超过 ' + (bundled ? '4 MiB' : '256 KiB'));
      const tree = parse(source, { ecmaVersion: 2024, sourceType: 'script' });
      if (bundled) {
        add('warning', '打包型助手脚本在受限沙箱环境执行：浏览器 UI 挂载与定时器以惰性内存桩运行，仅生效本次生成事件、ToolManager 输出工具与回复后处理。');
      } else {
        const stack = [tree], unavailable = new Set();
        while (stack.length) {
          const node = stack.pop();
          if (node.type === 'ImportExpression') unavailable.add('import');
          if (node.type === 'Identifier' && ['XMLHttpRequest', 'WebSocket', 'process', 'require', 'generate', 'generateRaw', 'setChatMessages', 'triggerSlash', 'setTimeout', 'setInterval'].includes(node.name)) unavailable.add(node.name);
          for (const value of Object.values(node)) {
            if (Array.isArray(value)) { for (const child of value) if (child?.type) stack.push(child); }
            else if (value?.type) stack.push(value);
          }
        }
        if (unavailable.size) add('warning', '引用未提供的能力：' + [...unavailable].join('、') + '；调用时将失败。');
        add('warning', '脚本在受限助手环境执行；只允许本次事件、临时变量和虚拟生成请求，未实现的 API 会报错。');
      }
    } catch (error) { add('error', '助手脚本语法或大小不受支持：' + error.message); }
    return { name: script.name, hash: fingerprint, supported: builtin ? 'builtin' : 'restricted', builtin, ...(bundled ? { bundled: true, kind: 'bundled' } : {}) };
  });
  return { diagnostics, scripts, reports, bundled: reports.some(r => r.bundled), executable: scripts.filter((_, i) => !reports[i].builtin) };
}

export function transformHelperRequest(document, wire, options = {}) {
  const inspected = inspectHelpers(document), scripts = inspected.executable;
  if (!scripts.length) return { wire };
  const rawPreset = inspected.bundled ? buildRawPreset(document) : undefined;
  const preset = helperPreset(document, wire);
  const state = { version: 1, seed: randomBytes(4).readUInt32LE() || 1, now: Date.now(), request: wire,
    bundled: inspected.bundled, bootstrapIds: [],
    trigger: options.trigger, userName: options.env?.userName, charName: options.env?.charName,
    variables: { chat: options.env?.local || {}, global: options.env?.global || {} },
    chat: (options.env?.chat || []).map((row, message_id) => ({ message_id, name: row.role === 'user' ? options.env.userName : options.env.charName,
      role: row.role, message: row.text, is_hidden: false, data: {}, extra: {} })),
  };
  const result = executeScript(helperGuest.toString(), {
    ...state,
    scripts,
    preset,
    ...(rawPreset ? { rawPreset } : {}),
    phase: 'request',
    tokenMap: options.protection?.tokenMap?.(),
    tokenPrefix: options.protection?.tokenPrefix,
  }, { stage: 'TavernHelper', timeout: 1800 });
  const expected = JSON.stringify(result.request);
  // Receipt is compiler-owned and never part of the model request or UI preview.
  return {
    wire: result.request,
    postMessages: result.postMessages || null,
    handledTools: result.handledTools || [],
    helperState: { ...state, expected, documentHash: hash(JSON.stringify(document)) },
    notes: result.notes,
    intercepts: result.intercepts,
  };
}

function buildRawPreset(document) {
  return {
    prompts: document.prompts,
    prompt_order: document.prompt_order,
    preset_settings_openai: 'active-preset',
    function_calling: true,
    chat_completion_source: 'openai',
  };
}

function stripLargeScripts(items) {
  if (!Array.isArray(items)) return items;
  return items.map(item => {
    if (!item || typeof item !== 'object') return item;
    if (item.type === 'folder' && Array.isArray(item.scripts)) return { ...item, scripts: stripLargeScripts(item.scripts) };
    if (typeof item.content === 'string' && item.content.length > MAX_SCRIPT_BYTES) return { ...item, content: '' };
    return item;
  });
}

// Tavern Helper's public getPreset contract uses ordered {id, enabled} prompts,
// not the raw ST {identifier, prompt_order} file shape. Only frozen settings
// with a known mapping are exposed; unsupported settings are not invented.
function helperPreset(document, wire) {
  const group = document.prompt_order.find(g => Number(g.character_id) === 100001) || document.prompt_order[0];
  const definitions = new Map(document.prompts.map(p => [p.identifier, p]));
  const used = new Set(group.order.map(p => p.identifier));
  const convert = (p, enabled) => ({ id: p.identifier, name: p.name || p.identifier, enabled,
    role: p.role || 'system', ...(p.marker ? {} : { content: p.content || '' }),
    position: Number(p.injection_position) === 1 ? { type: 'in_chat', depth: Number(p.injection_depth) || 0, order: Number(p.injection_order) || 0 } : { type: 'relative' },
  });
  const settings = { max_completion_tokens: wire.max_tokens, ...(wire.temperature !== undefined ? { temperature: wire.temperature } : {}),
    should_stream: false, reply_count: 1, squash_system_messages: !!document.squash_system_messages };
  const aliases = { max_context: 'openai_max_context', reasoning_effort: 'reasoning_effort', request_thoughts: 'show_thoughts', enable_function_calling: 'function_calling',
    frequency_penalty: 'frequency_penalty', presence_penalty: 'presence_penalty', top_p: 'top_p', top_k: 'top_k', top_a: 'top_a', min_p: 'min_p', seed: 'seed', repetition_penalty: 'repetition_penalty' };
  for (const [key, source] of Object.entries(aliases)) if (document[source] !== undefined) settings[key] = document[source];
  const extensions = structuredClone(document.extensions || {});
  if (Array.isArray(extensions.tavern_helper?.scripts)) {
    extensions.tavern_helper.scripts = stripLargeScripts(extensions.tavern_helper.scripts);
  }
  return { settings, prompts: group.order.map(item => convert(definitions.get(item.identifier), item.enabled !== false)),
    prompts_unused: document.prompts.filter(p => !used.has(p.identifier)).map(p => convert(p, false)),
    extensions };
}
export function formatHelperOutput(document, response, state) {
  const inspected = inspectHelpers(document);
  if (!state) {
    if (inspected.executable.length) throw Error('助手输出缺少冻结的编译状态');
    return response;
  }
  if (state.version !== 1 || state.documentHash !== hash(JSON.stringify(document))) throw Error('助手预设与冻结状态不一致');
  const toolCalls = (response.toolCalls || []).map(call => ({ id: call.id, type: 'function', function: {
    name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments),
  } }));
  const envelope = { choices: [{ index: 0, message: { role: 'assistant', content: response.text || '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }] };
  const scripts = state.scripts || inspected.executable;
  const preset = state.preset || helperPreset(document, state.request || {});
  const rawPreset = state.rawPreset || (inspected.bundled ? buildRawPreset(document) : undefined);
  const result = executeScript(helperGuest.toString(), {
    ...state,
    scripts,
    preset,
    ...(rawPreset ? { rawPreset } : {}),
    phase: 'response',
    response: envelope,
  }, { stage: 'TavernHelper 输出', timeout: 1800 });
  const message = result.response?.choices?.[0]?.message;
  if (!message || (message.content != null && typeof message.content !== 'string') || (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))) throw Error('助手输出不是有效的完整消息');
  return { text: message.content || '', toolCalls: (message.tool_calls || []).map(call => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments })) };
}
