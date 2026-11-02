import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { parsePreset, inspectPreset, MAX_PRESET_BYTES, digest } from './preset.mjs';

const MAX_STORE_BYTES = 250 * 1024;
const MAX_UPLOAD_CHARS = 2 * 1024 * 1024;
export function encodePreset(source) { return gzipSync(Buffer.from(source, 'utf8')).toString('base64'); }
export function decodePreset(data) {
  return gunzipSync(Buffer.from(data, 'base64'), { maxOutputLength: MAX_PRESET_BYTES }).toString('utf8');
}
export function createPresetStore(tavern, now = Date.now) {
  let tail = Promise.resolve();
  const uploads = new Map();
  async function read() {
    const saved = await tavern.readPluginData();
    if (!saved) return { schemaVersion: 1, activeId: null, presets: [], settings: {} };
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.presets)) throw new Error('插件配置格式无法读取');
    return saved;
  }
  const write = work => {
    const next = tail.then(async () => {
      const state = await read(), result = await work(state);
      if (Buffer.byteLength(JSON.stringify(state)) > MAX_STORE_BYTES) throw new Error('预设压缩后超过插件存储上限，请先删除不再使用的预设');
      await tavern.savePluginData({ data: state });
      return result;
    });
    tail = next.catch(() => {});
    return next;
  };
  async function list() {
    const state = await read();
    return { activeId: state.activeId, settings: state.settings || {}, presets: state.presets.map(({ data, ...record }) => ({ ...record, report: inspectPreset(parsePreset(decodePreset(data)), state.settings || {}) })) };
  }
  function begin({ name, size }) {
    for (const [id, upload] of uploads) if (now() - upload.at > 300000) uploads.delete(id);
    if (uploads.size >= 4) throw new Error('已有预设正在上传，请稍后重试');
    if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new Error('预设文件名无效');
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD_CHARS) throw new Error('预设文件过大');
    const id = randomUUID();
    uploads.set(id, { name, size, chunks: [], length: 0, at: now() });
    return { id };
  }
  function chunk({ id, index, text }) {
    const upload = uploads.get(id);
    if (!upload || now() - upload.at > 300000) throw new Error('上传已失效，请重新导入');
    if (typeof text !== 'string' || text.length > 60000 || index !== upload.chunks.length || upload.length + text.length > upload.size) throw new Error('上传分块无效');
    upload.chunks.push(text); upload.length += text.length; upload.at = now();
    return { received: upload.length };
  }
  async function finish({ id }) {
    const upload = uploads.get(id);
    uploads.delete(id);
    if (!upload || upload.length !== upload.size) throw new Error('预设上传不完整');
    const source = upload.chunks.join(''), doc = parsePreset(source), hash = digest(source), report = inspectPreset(doc);
    const record = { id: hash, name: upload.name, bytes: Buffer.byteLength(source), importedAt: now(), digest: hash, data: encodePreset(source), report };
    await write(state => {
      const old = state.presets.findIndex(item => item.id === hash);
      if (old >= 0) state.presets[old] = record;
      else state.presets.push(record);
      state.activeId = hash;
    });
    return list();
  }
  async function active() {
    const state = await read(), record = state.presets.find(item => item.id === state.activeId);
    if (!record) throw new Error('请先在 STcontext 面板导入并选择预设 JSON');
    return { document: parsePreset(decodePreset(record.data)), settings: state.settings || {}, name: record.name, digest: record.digest };
  }
  return {
    list, begin, chunk, finish, active,
    async select({ id }) { await write(state => { if (!state.presets.some(item => item.id === id)) throw new Error('预设不存在'); state.activeId = id; }); return list(); },
    async remove({ id }) { await write(state => { state.presets = state.presets.filter(item => item.id !== id); if (state.activeId === id) state.activeId = state.presets[0]?.id || null; }); return list(); },
    async export({ id }) { const state = await read(), record = state.presets.find(item => item.id === id); if (!record) throw new Error('预设不存在'); return { name: record.name, text: decodePreset(record.data) }; },
    async settings(input) {
      await write(state => {
        const next = { ...state.settings };
        if (Object.hasOwn(input, 'adapter')) { if (!['auto', 'st'].includes(input.adapter)) throw new Error('请求模式无效'); next.adapter = input.adapter; }
        if (Object.hasOwn(input, 'model')) { if (!['foreground', 'background'].includes(input.model)) throw new Error('模型选择无效'); next.model = input.model; }
        for (const key of ['maxTokens', 'contextLimit', 'temperature']) if (Object.hasOwn(input, key)) {
          if (input[key] === '' || input[key] === null) delete next[key];
          else { const n = Number(input[key]); if (!Number.isFinite(n) || (key === 'temperature' ? n < 0 || n > 2 : !Number.isSafeInteger(n) || n <= 0)) throw new Error(key + ' 无效'); next[key] = n; }
        }
        state.settings = next;
      });
      return list();
    },
  };
}
