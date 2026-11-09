import { randomBytes } from 'node:crypto';

const failure = () => new Error('预设改写后无法确定冻结材料来源，未发送请求（完整历史保护）');
const fields = wire => [
  ...(wire.messages || []).flatMap((message, index) => typeof message.content === 'string' ? [{ key: 'message:' + index, owner: message, property: 'content' }] : []),
  ...(wire.tools || []).flatMap((tool, index) => typeof tool.function?.description === 'string' ? [{ key: 'tool:' + index, owner: tool.function, property: 'description' }] : []),
];

// Keep provenance while it is known, before messages lose their source fields.
// Raw SPreset hooks still receive prose; only helper/macro stages see tokens.
export function createMaterialProtection() {
  const prefix = 'STCONTEXT_MATERIAL_' + randomBytes(12).toString('hex') + '_';
  const tokens = new Map(), textTokens = new Map();
  const tokenFor = text => {
    if (!text) return text;
    if (textTokens.has(text)) return textTokens.get(text);
    const token = prefix + tokens.size + '_END';
    tokens.set(token, text); textTokens.set(text, token); return token;
  };
  const pattern = () => new RegExp(prefix + '\\d+_END', 'g');
  const restoreText = text => text.replace(pattern(), token => tokens.get(token) ?? token);
  const protectMessages = messages => messages.map(message => {
    if (message.source === 'preset' || !message.content) return { ...message };
    const raw = message.rawContent ?? message.content;
    const index = raw ? message.content.indexOf(raw) : -1;
    // Input wrappers remain visible when the original has an unambiguous span.
    // Otherwise keep the entire source field opaque instead of masking matching
    // substrings of a wrapper (a one-letter input may occur in its markup).
    const content = index >= 0 && message.content.indexOf(raw, index + raw.length) < 0
      ? message.content.slice(0, index) + tokenFor(raw) + message.content.slice(index + raw.length)
      : tokenFor(message.content);
    return { ...message, content };
  });
  const restore = wire => {
    const result = structuredClone(wire);
    for (const { owner, property } of fields(result)) owner[property] = restoreText(owner[property]);
    if (JSON.stringify(result).includes(prefix)) throw new Error('助手将冻结材料移动到不支持的字段，未发送请求');
    return result;
  };

  function remap(previous, next) {
    const before = fields(previous), result = structuredClone(next), after = fields(result);
    const anchors = new Map();
    const add = (raw, protectedText) => {
      if (!raw) return;
      const values = anchors.get(raw) || new Set(); values.add(protectedText); anchors.set(raw, values);
    };
    // Whole fields also include templates: reserve those spans before trying
    // shorter material fragments, so history "c" cannot mask {{custom}}.
    for (const { owner, property } of before) {
      add(restoreText(owner[property]), owner[property]);
      // A changed surrounding template can no longer anchor its whole field.
      // Reserve its still-unexpanded macro independently from short material.
      for (const match of owner[property].matchAll(/\{\{[\s\S]*?\}\}/g)) add(match[0], match[0]);
    }
    const used = new Set(before.flatMap(({ owner, property }) => owner[property].match(pattern()) || []));
    for (const token of used) add(tokens.get(token), token);
    // A raw hook can introduce a new template, not just edit an existing one.
    // Give its complete macro span precedence over shorter captured text. If
    // that entire macro is also captured material, changed boundaries must be
    // unambiguous; unchanged fields retain their exact origin below.
    for (const { owner, property } of after) {
      for (const match of owner[property].matchAll(/\{\{[\s\S]*?\}\}/g)) add(match[0], match[0]);
    }
    const ordered = [...anchors].sort((a, b) => b[0].length - a[0].length);
    const originals = new Map(before.map(field => [field.key, field]));
    for (const { key, owner, property } of after) {
      const text = owner[property], original = originals.get(key);
      const metadata = (owner, property) => JSON.stringify({ ...owner, [property]: undefined });
      if (original && restoreText(original.owner[original.property]) === text
        && metadata(original.owner, original.property) === metadata(owner, property)) {
        owner[property] = original.owner[original.property]; continue;
      }
      let parts = [{ text }];
      for (const [raw, replacements] of ordered) {
        parts = parts.flatMap(part => {
          if (part.protected !== undefined) return [part];
          const pieces = part.text.split(raw);
          if (pieces.length === 1) return [part];
          if (replacements.size !== 1) throw failure();
          const protectedText = replacements.values().next().value;
          return pieces.flatMap((piece, index) => index ? [{ protected: protectedText }, { text: piece }] : [{ text: piece }]);
        });
      }
      owner[property] = parts.map(part => part.protected ?? part.text).join('');
    }
    return result;
  }
  const remapText = (previous, next) => remap({ messages: [{ content: previous }] }, { messages: [{ content: next }] }).messages[0].content;
  return { protectMessages, tokenFor, restore, restoreText, remap, remapText };
}
