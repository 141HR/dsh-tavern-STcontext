import { createHash, randomBytes } from 'node:crypto';

// The hash identifies a supported script protocol; preset text is never bundled.
const KNOWN_SCRIPT_SHA256 = 'faa2acc0ced56fd4594cc9bca70e3cb788aa736834dd4666031ec04fa6b539a4';
const tick = String.fromCharCode(96);
export function scriptHash(script) { return createHash('sha256').update(script).digest('hex'); }
export function isKunlunScript(script) { return scriptHash(script) === KNOWN_SCRIPT_SHA256; }

// Imported templates are data: interpolate known names, never execute script.
function literalAt(source, start) {
  const quote = source[start];
  if (!["'", '"', tick].includes(quote)) throw new Error('脚本模板不是字符串');
  let text = '', i = start + 1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[++i];
      const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
      if (next === 'u' || next === 'x') {
        const n = next === 'u' ? 4 : 2, digits = source.slice(i + 1, i + 1 + n);
        if (!new RegExp('^[0-9a-f]{' + n + '}$', 'i').test(digits)) throw new Error('脚本字符串转义无效');
        text += String.fromCharCode(parseInt(digits, 16)); i += n;
      } else text += escapes[next] ?? next;
    } else if (ch === quote) return { text, end: i + 1 };
    else if (quote === tick && ch === '$' && source[i + 1] === '{') {
      let depth = 1, end = i + 2;
      for (; end < source.length && depth; end++) {
        if (["'", '"', tick].includes(source[end])) { end = literalAt(source, end).end - 1; continue; }
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
      }
      if (depth) throw new Error('脚本模板插值未闭合');
      text += source.slice(i, end); i = end - 1;
    } else text += ch;
  }
  throw new Error('脚本字符串未闭合');
}
function after(source, marker) {
  const index = source.indexOf(marker);
  if (index < 0) throw new Error('缺少预设脚本模板：' + marker);
  const tail = source.slice(index + marker.length);
  return literalAt(tail, tail.length - tail.trimStart().length).text;
}
function expression(value, vars) {
  const key = value.trim();
  if (/^[a-zA-Z_]\w*$/.test(key) && Object.hasOwn(vars, key)) return String(vars[key] ?? '');
  const cast = key.match(/^String\((\w+)\)\.trim\(\)$/);
  if (cast && Object.hasOwn(vars, cast[1])) return String(vars[cast[1]] ?? '').trim();
  const conditional = key.match(/^(\w+)\s*\?\s*/);
  if (conditional && Object.hasOwn(vars, conditional[1])) {
    const yes = literalAt(key, conditional[0].length), rest = key.slice(yes.end).trimStart();
    if (!rest.startsWith(':')) throw new Error('不支持的脚本模板条件');
    const noSource = rest.slice(1).trimStart(), no = literalAt(noSource, 0);
    if (noSource.slice(no.end).trim()) throw new Error('不支持的脚本模板条件');
    return interpolate(vars[conditional[1]] ? yes.text : no.text, vars);
  }
  throw new Error('不支持的脚本模板插值：' + key);
}
function interpolate(text, vars) {
  let result = '', position = 0;
  while (position < text.length) {
    const index = text.indexOf('$' + '{', position);
    if (index < 0) return result + text.slice(position);
    result += text.slice(position, index);
    let end = index + 2, depth = 1;
    for (; end < text.length && depth; end++) {
      if (["'", '"', tick].includes(text[end])) { end = literalAt(text, end).end - 1; continue; }
      if (text[end] === '{') depth++;
      if (text[end] === '}') depth--;
    }
    if (depth) throw new Error('脚本模板插值未闭合');
    result += expression(text.slice(index + 2, end - 1), vars);
    position = end;
  }
  return result;
}
export function readKunlunTemplates(source) {
  const preview = source.slice(source.indexOf('function formatIDEUserPreview('));
  const perspectives = [...source.matchAll(/perspectiveRules\s*=\s*/g)]
    .filter(match => source[match.index + match[0].length] === tick)
    .map(match => literalAt(source, match.index + match[0].length).text);
  if (perspectives.length !== 3) throw new Error('无法识别脚本人称模板');
  const assistantTail = source.slice(source.indexOf('const formattedAssistant ='));
  return {
    title: after(source, 'const DEFAULT_NOVEL_TITLE = '),
    prefix: after(source, 'const DEFAULT_TOOL_PREFIX = '),
    payload: after(source, 'const OBFUSCATION_PAYLOAD = '),
    workspace: after(source.slice(source.indexOf('if (dynamicHistory)')), 'toolDesc = '),
    path: after(preview, 'const fullMainPath = '),
    preview: after(preview, 'return '),
    perspectiveComment: after(preview, 'targetPerspective ? '),
    encodingHeader: after(preview, 'const encodingHeader = isEncoded ? '),
    perspectives,
    assistant: literalAt(assistantTail, assistantTail.indexOf(tick)).text,
  };
}
function detectSettings(messages, templates) {
  let targetLength = '1500', targetPerspective = '第三人称受限视角', novelTitle = templates.title;
  for (const { content } of messages) {
    const title = content.match(/novel_title\s*=\s*"([^"]+)"/i) || content.match(/【作品代号】\s*[:：]\s*([a-zA-Z0-9_-]+)/i);
    if (title) novelTitle = title[1].trim();
    for (const line of content.split(/\r?\n/)) {
      if (/^[#\/;]/.test(line.trim())) continue;
      const length = line.trim().match(/^(?:target_length|word_count|length)\s*=\s*["']?(\d+)/i);
      if (length) { targetLength = length[1]; break; }
    }
    const wordCount = content.match(/\[WordCount\]\s*:\s*约?(\d+)字/i);
    if (wordCount) targetLength = wordCount[1];
    const mode = content.match(/mode\s*=\s*["']?(first_person|second_person|third_person|第一人称|第二人称|第三人称)/i);
    const v = mode?.[1] ?? '';
    if (/second|第二/i.test(v)) targetPerspective = '第二人称代入沉浸视角';
    else if (/first|第一/i.test(v)) targetPerspective = '第一人称主观沉浸视角';
    else if (v) targetPerspective = '第三人称受限视角';
    else if (/perspective_second_person\.conf|second_person_immersive|第二人称代入沉浸视角|第二人称沉浸视角|第二人称/i.test(content)) targetPerspective = '第二人称代入沉浸视角';
    else if (/perspective_first_person\.conf|first_person_immersive|第一人称主观沉浸视角/i.test(content)) targetPerspective = '第一人称主观沉浸视角';
    else if (/perspective_third_person\.conf|third_person_limited|第三人称视角锁定/i.test(content)) targetPerspective = '第三人称受限视角';
    if (/第一人称|第二人称/.test(targetPerspective)) {
      const name = content.match(/(?:target_user|protagonist)\s*=\s*"([^"]+)"/i);
      if (name && !name[1].includes('{{user}}')) targetPerspective += '（' + name[1].trim() + '）';
    }
  }
  return { targetLength, targetPerspective, novelTitle };
}
export function buildKunlunRequest(messages, script, { toolName, userName = '你' } = {}) {
  const templates = readKunlunTemplates(script);
  toolName ||= templates.prefix + randomBytes(8).toString('hex');
  const settings = detectSettings(messages, templates);
  const currentChapter = messages.filter(m => m.source === 'history' && m.role === 'user').length + 1;
  const chapter = n => 'chapter_' + String(n).padStart(2, '0');
  const vars = { ...settings, currentChapterFile: chapter(currentChapter) + '.txt', currentPreviewFile: chapter(currentChapter) + '_preview.txt' };
  const perspectiveIndex = settings.targetPerspective.includes('第二') ? 0 : settings.targetPerspective.includes('第一') ? 1 : 2;
  const rules = interpolate(templates.perspectives[perspectiveIndex], vars).replace(/\{\{user\}\}/g, userName);
  const placeholders = {
    novel_title: settings.novelTitle, current_chapter_file: vars.currentChapterFile, current_preview_file: vars.currentPreviewFile,
    perspective: settings.targetPerspective, perspective_rules: rules, target_length: settings.targetLength, zishu: settings.targetLength,
  };
  const expand = text => text.replace(/\{\{(novel_title|current_chapter_file|current_preview_file|perspective|perspective_rules|target_length|zishu)\}\}/g, (_, key) => placeholders[key])
    .replace(/\{\{getvar::zishu\}\}/g, settings.targetLength);
  const context = [], guides = [];
  let toolDescription = '', fieldDescription = '', forced = false, archive = false, historyChapter = 0;
  function preview(content, latest, n) {
    const mainFileName = chapter(n) + '.txt';
    const values = { ...settings, content, mainFileName, targetLength: latest ? settings.targetLength : null, targetPerspective: latest ? settings.targetPerspective : null };
    values.fullMainPath = interpolate(templates.path, values);
    values.perspectiveComment = latest ? interpolate(templates.perspectiveComment, values) : '';
    values.encodingHeader = latest ? templates.encodingHeader : '';
    values.attachmentHeader = '';
    return interpolate(templates.preview, values);
  }
  for (const message of messages) {
    let content = message.content;
    const isMaterial = message.source !== 'preset';
    if (!isMaterial) {
      if (/mode\s*=\s*["']FORCED_SPECIFIC_TOOL["']/i.test(content)) forced = true;
      content = content.replace(/mode\s*=\s*["']FORCED_SPECIFIC_TOOL["']/gi, '')
        .replace(/(?:^|\r?\n)\s*[#\/;]?\s*(?:target_length|word_count|length)\s*=\s*["']?\d+["']?/gi, '').trim();
      if (!content) continue;
      content = expand(content);
    }
    if (!isMaterial && content.includes('【ToolCall引导】')) {
      content = content.replace(/%TOOL_NAME%/g, toolName);
      for (const block of content.match(/【ToolCall引导】[\s\S]*?(?=【ToolCall引导】|$)/g) || []) {
        if (/^【ToolCall引导】(?:工具说明|工具描述)/i.test(block)) toolDescription = block.replace(/^【ToolCall引导】(?:工具说明|工具描述)\s*/i, '').trim();
        else if (/^【ToolCall引导】(?:字段说明|正文说明|参数说明)/i.test(block)) fieldDescription = block.replace(/^【ToolCall引导】(?:字段说明|正文说明|参数说明)\s*/i, '').trim();
        else {
          const clean = block.replace(/^【ToolCall引导】\s*/, '').trim();
          const role = /^\[SYSTEM_/i.test(clean) ? 'system' : /^\[(?:Runtime ?Router|Action ?Directive|User)/i.test(clean) ? 'user'
            : /^\[(?:Execution ?Kernel|Assistant)/i.test(clean) ? 'assistant' : message.role;
          if (clean) guides.push({ role, content: expand(clean) });
        }
      }
      const remaining = content.replace(/【ToolCall引导】[\s\S]*?(?=【ToolCall引导】|$)/g, '').trim();
      if (remaining) context.push(remaining);
      continue;
    }
    if (message.source === 'input') {
      context.push(preview(content.replace(/^【LAST_USER_INPUT】/, ''), true, currentChapter)); continue;
    }
    if (message.source === 'history' && message.role === 'user') {
      context.push(preview(content.replace(/^【HISTORICAL_USER_INPUT】/, ''), false, ++historyChapter)); continue;
    }
    if (content.includes('<已归档历史章节>') || content.includes('<历史记录>')) archive = true;
    if (content.includes('</已归档历史章节>') || content.includes('</历史记录>')) archive = false;
    if (archive && message.source === 'history' && message.role === 'assistant' && !content.startsWith('<ide_viewport_log>')) {
      context.push(interpolate(templates.assistant, { histFile: chapter(Math.max(1, historyChapter)) + '.txt', trimmedText: content }));
    } else context.push(content);
  }
  if (!guides.length || guides.at(-1).role !== 'user') throw new Error('昆仑请求引导链不完整，末尾需要 user 消息；请检查导入预设');
  let history = context.join('\n\n---\n\n');
  if (templates.payload && !/作家小说工程只读读取规范|作家小说工程文件夹只读检视契约|【POSIX 存储节点/.test(history)) history = templates.payload + '\n\n---\n\n' + history;
  const description = interpolate(templates.workspace, { toolDesc: expand(toolDescription), dynamicHistory: history });
  const tool = { name: toolName, description, parameters: { type: 'object', properties: { buffer_content: { type: 'string', description: expand(fieldDescription) } }, required: ['buffer_content'] } };
  return { messages: guides, tools: [tool], toolChoice: forced ? { name: toolName } : 'auto', toolName };
}
export function decodeResponse(response, expectedToolName) {
  if (!response || typeof response !== 'object') throw new Error('模型未返回结果');
  const candidates = [];
  for (const call of response.toolCalls || []) {
    const name = call.name || call.function?.name;
    if (!expectedToolName || name?.slice(name.lastIndexOf(':') + 1) !== expectedToolName) throw new Error('模型返回了未声明的工具调用');
    const args = call.arguments ?? call.function?.arguments;
    let data;
    try { data = typeof args === 'string' ? JSON.parse(args) : args; }
    catch { throw new Error('工具正文参数不是完整 JSON，未替换正文'); }
    if (typeof data?.buffer_content !== 'string') throw new Error('工具结果缺少 buffer_content');
    candidates.push(data.buffer_content);
  }
  if (typeof response.text === 'string' && response.text.trim()) candidates.push(response.text);
  const text = candidates.sort((a, b) => b.length - a.length)[0] || '';
  if (!text.trim()) throw new Error('模型返回空正文');
  return text;
}
