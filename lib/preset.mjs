import { createHash } from 'node:crypto';
import { createMacroEnvironment, renderMacros } from './macros.mjs';
import { nativeRegexes, parseRegex, projectInput, applyRegexOnce } from './regex.mjs';
import { isKunlunScript, scriptHash, buildKunlunRequest, decodeResponse } from './kunlun.mjs';

export const MAX_PRESET_BYTES = 2 * 1024 * 1024;
const ROLES = new Set(['system', 'user', 'assistant']);
const MARKERS = new Set(['worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'dialogueExamples', 'chatHistory']);
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
export function parsePreset(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_PRESET_BYTES) throw new Error('预设文件必须是小于 2 MB 的 JSON');
  let doc;
  try { doc = JSON.parse(source); } catch (error) { throw new Error('预设 JSON 无效：' + error.message); }
  if (!object(doc) || !Array.isArray(doc.prompts) || !doc.prompts.length) throw new Error('预设缺少 prompts 数组');
  if (doc.prompts.length > 2000) throw new Error('预设提示词条目过多');
  const ids = new Set();
  for (const item of doc.prompts) {
    if (!object(item) || typeof item.identifier !== 'string' || !item.identifier) throw new Error('预设条目缺少 identifier');
    if (ids.has(item.identifier)) throw new Error('重复的提示词标识：' + item.identifier);
    ids.add(item.identifier);
    if (item.role !== undefined && !ROLES.has(item.role)) throw new Error('不支持的消息角色：' + item.role);
    if (item.content !== undefined && typeof item.content !== 'string') throw new Error('提示词 content 必须是字符串');
  }
  if (!Array.isArray(doc.prompt_order) || !doc.prompt_order.length) throw new Error('预设缺少 prompt_order');
  const group = selectOrder(doc);
  if (!Array.isArray(group.order)) throw new Error('预设顺序不是数组');
  if (new Set(group.order.map(entry => entry.identifier)).size !== group.order.length) throw new Error('同一提示词在顺序中重复出现');
  for (const item of group.order) if (!ids.has(item.identifier)) throw new Error('顺序引用了不存在的条目：' + item.identifier);
  for (const rule of nativeRegexes(doc)) {
    if (!object(rule) || typeof rule.findRegex !== 'string') throw new Error('预设正则格式无效');
    parseRegex(rule.findRegex);
    if (rule.trimStrings !== undefined && !Array.isArray(rule.trimStrings)) throw new Error('正则 trimStrings 必须是数组');
  }
  return doc;
}
function selectOrder(doc) {
  const matches = doc.prompt_order.filter(group => Number(group.character_id) === 100001);
  if (matches.length > 1) throw new Error('预设有多个 100001 顺序，无法确定当前顺序');
  if (matches.length) return matches[0];
  if (doc.prompt_order.length === 1) return doc.prompt_order[0];
  throw new Error('预设没有 100001 顺序，且存在多套候选顺序');
}
function scriptsOf(doc) {
  const scripts = doc?.extensions?.tavern_helper?.scripts;
  if (scripts === undefined) return [];
  if (!Array.isArray(scripts)) throw new Error('酒馆助手 scripts 必须是数组');
  return scripts.filter(item => item?.enabled === true).map(item => ({ name: String(item.name || item.id || '未命名脚本'), content: String(item.content || '') }));
}
export function inspectPreset(doc, { adapter = 'auto' } = {}) {
  const group = selectOrder(doc), scripts = scriptsOf(doc), recognized = scripts.filter(item => isKunlunScript(item.content));
  const warnings = [], blockers = [];
  const unsupported = scripts.filter(item => !isKunlunScript(item.content));
  if (adapter !== 'st' && unsupported.length) blockers.push('尚未适配的启用脚本：' + unsupported.map(item => item.name).join('、'));
  if (recognized.length > 1) blockers.push('存在多个昆仑请求改写脚本');
  const protocol = adapter === 'st' ? 'st' : recognized.length === 1 ? 'kunlun-ide' : 'st';
  if (adapter === 'st' && scripts.length) warnings.push('当前选择标准 ST 模式：保留脚本数据但不执行脚本，也不复现其请求改写。');
  if (doc.extensions?.SPreset?.RegexBinding) warnings.push('只采用 extensions.regex_scripts；SPreset RegexBinding 作为原始数据保存，不重复执行。');
  const historyRules = nativeRegexes(doc).flatMap((rule, index) =>
    rule.disabled !== true && rule.placement?.map(Number).includes(2) && rule.promptOnly === true
      ? [{ index, name: String(rule.scriptName || index), reason: '历史正文保持原样，不重复执行输出正则或摘要/删楼规则' }] : []);
  warnings.push('输出正则在返回宿主前按数组顺序执行一遍：placement=2、depth=0，提示词与显示范围合并去重。');
  warnings.push('历史正文逐字保留；历史输入只应用保留原文的包装正则。超限不会自动删除或摘要。');
  const skipped = [];
  for (const [key, value] of Object.entries(doc)) if (['top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'seed', 'min_p', 'repetition_penalty'].includes(key) && value !== undefined) skipped.push(key);
  if (skipped.length) warnings.push('当前宿主未映射的采样项：' + skipped.join('、'));
  return { order: Number(group.character_id), enabledPrompts: group.order.filter(x => x.enabled !== false).length, regexCount: nativeRegexes(doc).length,
    protocol, scripts: scripts.map(item => ({ name: item.name, hash: scriptHash(item.content), supported: isKunlunScript(item.content) })),
    historyRules, warnings, blockers };
}
function materialMessages(materials) {
  if (materials?.schemaVersion !== 1 || materials.completeness?.history !== 'all-visible') throw new Error('宿主未提供完整可见历史材料');
  if (!Array.isArray(materials.history)) throw new Error('宿主历史材料无效');
  for (const row of materials.history) {
    if (!['user', 'assistant'].includes(row.role) || typeof row.text !== 'string' || row.is_hidden || row.hidden || row.tavernHidden) throw new Error('宿主历史含不可用或隐藏消息');
  }
  if (typeof materials.input?.projected !== 'string') throw new Error('宿主缺少本轮输入');
  return materials.history.map(item => ({ role: item.role, content: item.text, source: 'history' }));
}
function squash(messages) {
  const result = [];
  for (const message of messages) {
    const last = result.at(-1);
    // Keep provenance boundaries until the script adapter has consumed them.
    if (last?.role === 'system' && message.role === 'system' && last.source === message.source) last.content += '\n\n' + message.content;
    else result.push({ ...message });
  }
  return result;
}
export function compilePreset(doc, materials, settings = {}) {
  const trigger = materials.trigger ?? (materials.target?.kind === 'generate' ? 'normal' : 'regenerate');
  if (!['normal', 'regenerate', 'continue'].includes(trigger)) throw new Error('不支持的正文生成触发类型：' + trigger);
  const report = inspectPreset(doc, settings);
  if (report.blockers.length) throw new Error(report.blockers.join('；'));
  const history = materialMessages(materials), rules = nativeRegexes(doc);
  const env = createMacroEnvironment({ userName: materials.persona?.name || '你', charName: materials.card?.name || '' });
  const knownScript = report.protocol === 'kunlun-ide';
  const rendered = value => renderMacros(value, env, { allowScript: knownScript });
  const input = { role: 'user', content: materials.input.projected, source: 'input' };
  const skippedInputRules = new Set();
  for (const [index, message] of [...history, input].entries()) {
    if (message.role !== 'user') continue;
    const result = projectInput(message.content, rules, history.length - index);
    message.content = result.text;
    result.skipped.forEach(id => skippedInputRules.add(id));
  }
  if (skippedInputRules.size) report.warnings.push('为保留完整输入，跳过会删改原文的输入正则：' + [...skippedInputRules].join('、'));
  const card = materials.card || {};
  // The captured cardContext includes constant lore/persona and is already
  // expanded. Never execute the old turn's macros/EJS again.
  const capturedCard = typeof materials.cardContext === 'string' && materials.cardContext.length > 0;
  if (capturedCard) report.warnings.push('人物与固定设定使用宿主已解析的原轮上下文；不再次执行卡片宏、EJS 或人物卡提示词覆盖。');
  const description = capturedCard ? materials.cardContext : String(card.description || '');
  if (!capturedCard && /<%|\{\{/.test([card.description, card.personality, card.scenario, card.mes_example].join(''))) throw new Error('人物材料尚未解析，请使用宿主原轮完整材料快照');
  const markers = {
    worldInfoBefore: '',
    worldInfoAfter: materials.worldbook?.context || '',
    personaDescription: capturedCard ? '' : materials.persona?.description || '',
    charDescription: description,
    charPersonality: capturedCard ? '' : card.personality || '',
    scenario: capturedCard ? '' : card.scenario || '',
    dialogueExamples: capturedCard ? '' : card.mes_example || '',
  };
  const requirements = (materials.writingRequirements || []).map(item => item.text).filter(Boolean);
  const state = materials.beforeState || {};
  const extras = [
    ...(requirements.length ? [{ role: 'system', content: requirements.join('\n\n'), source: 'materials' }] : []),
    { role: 'system', content: '【正文生成前的权威状态】\n' + JSON.stringify(state), source: 'materials' },
  ];
  const historyBlock = [...extras, ...history, input], used = new Set(), normal = [], depth = [];
  const group = selectOrder(doc), definitions = new Map(doc.prompts.map(item => [item.identifier, item]));
  for (const order of group.order) {
    if (order.enabled === false) continue;
    const entry = definitions.get(order.identifier);
    if (Array.isArray(entry.injection_trigger) && entry.injection_trigger.length && !entry.injection_trigger.includes(trigger)) continue;
    const identifier = entry.identifier, role = ROLES.has(entry.role) ? entry.role : 'system';
    if (Number(entry.injection_position) === 1 && !MARKERS.has(identifier)) {
      depth.push({ role, content: rendered(entry.content || ''), source: 'preset', depth: Math.max(0, Number(entry.injection_depth) || 0), order: Number(entry.injection_order) || 0 }); continue;
    }
    if (identifier === 'chatHistory') { normal.push({ history: true }); used.add(identifier); }
    else if (Object.hasOwn(markers, identifier)) {
      used.add(identifier);
      if (markers[identifier]) normal.push({ role, content: markers[identifier], source: 'materials' });
    } else {
      const content = rendered(entry.content || '');
      if (content.trim()) normal.push({ role, content, source: 'preset' });
    }
  }
  // Apply fixed depth against the original history length, not repeated splice positions.
  depth.sort((a, b) => b.depth - a.depth || a.order - b.order);
  let added = 0;
  for (const { depth: d, order: _order, ...message } of depth) {
    if (!message.content.trim()) continue;
    historyBlock.splice(extras.length + Math.max(0, history.length + 1 - d) + added++, 0, message);
  }
  if (!used.has('chatHistory')) { normal.push({ history: true }); report.warnings.push('预设未启用 chatHistory；插件已补入完整历史与本轮输入。'); }
  const missing = Object.entries(markers).filter(([key, value]) => value && !used.has(key));
  normal.unshift(...missing.map(([, content]) => ({ role: 'system', content, source: 'materials' })));
  if (missing.length) report.warnings.push('预设缺少材料占位项，已补入：' + missing.map(([key]) => key).join('、'));
  let messages = normal.flatMap(item => item.history ? historyBlock : [item]);
  if (doc.squash_system_messages) messages = squash(messages);
  const logicalMessages = messages.map(({ role, content }) => ({ role, content }));
  let plan, toolName;
  if (knownScript) {
    const script = scriptsOf(doc).find(item => isKunlunScript(item.content));
    ({ toolName, ...plan } = buildKunlunRequest(messages, script.content, { userName: env.userName }));
  } else plan = { messages: logicalMessages };
  const parameter = (override, preset, fallback) => override === '' || override === undefined || override === null ? preset ?? fallback : Number(override);
  plan.temperature = parameter(settings.temperature, doc.temperature, undefined);
  plan.maxTokens = parameter(settings.maxTokens, doc.openai_max_tokens ?? doc.max_tokens, 8192);
  plan.contextLimit = parameter(settings.contextLimit, undefined, undefined);
  if (settings.model) plan.model = structuredClone(settings.model);
  for (const key of ['temperature', 'contextLimit']) if (plan[key] === undefined) delete plan[key];
  if (!Number.isSafeInteger(plan.maxTokens) || plan.maxTokens <= 0) throw new Error('输出 token 上限必须是正整数');
  if (plan.contextLimit !== undefined && (!Number.isSafeInteger(plan.contextLimit) || plan.contextLimit <= plan.maxTokens)) throw new Error('上下文上限必须大于输出 token 上限');
  if (plan.temperature !== undefined && (!Number.isFinite(plan.temperature) || plan.temperature < 0 || plan.temperature > 2)) throw new Error('温度必须在 0–2 之间');
  return { request: plan, logicalMessages, toolName, report: { ...report, trigger }, presetDigest: digest(doc), historyMessages: history.length };
}
export function processOutput({ document, response, toolName }) {
  const decoded = decodeResponse(response, toolName);
  const result = applyRegexOnce(decoded, nativeRegexes(document), { placement: 2, depth: 0, channel: 'output' });
  if (!result.text.trim()) throw new Error('预设正则处理后正文为空，未替换宿主正文');
  return { text: result.text, metadata: { presetDigest: digest(document), outputRegexPasses: 1, appliedRegex: result.applied } };
}
