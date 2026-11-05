import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { parsePreset, inspectPreset, MAX_PRESET_BYTES, digest } from './preset.mjs';
import { normalizeModelSelection } from './models.mjs';
import { parseEditedPreset } from './preset-edit.mjs';

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
    // Legacy slots cannot identify an independent route. Require a new choice.
    saved.settings = { ...saved.settings };
    // The unified compiler selects extensions from the preset itself.
    delete saved.settings.adapter;
    if (['foreground', 'background'].includes(saved.settings.model)) delete saved.settings.model;
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
  function begin({ name, size, operation = 'import', presetId, revision }) {
    for (const [id, upload] of uploads) if (now() - upload.at > 300000) uploads.delete(id);
    if (uploads.size >= 4) throw new Error('已有预设正在上传，请稍后重试');
    if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new Error('预设文件名无效');
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD_CHARS) throw new Error('预设文件过大');
    if (!['import', 'replace', 'copy', 'validate'].includes(operation)) throw new Error('预设保存操作无效');
    if (operation !== 'import' && (typeof presetId !== 'string' || !presetId || typeof revision !== 'string' || !revision)) throw new Error('缺少预设编辑版本，请重新打开编辑器');
    const id = randomUUID();
    uploads.set(id, { name, size, operation, presetId, revision, chunks: [], length: 0, at: now() });
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
    if (now() - upload.at > 300000) throw new Error('上传已失效，请重新导入或保存');
    const source = upload.chunks.join(''), doc = (upload.operation === 'import' ? parsePreset : parseEditedPreset)(source), hash = digest(source), report = inspectPreset(doc);
    if (upload.operation === 'validate') return { report };
    const record = { id: hash, name: upload.name.trim(), bytes: Buffer.byteLength(source), importedAt: now(), digest: hash, revision: randomUUID(), data: encodePreset(source), report };
    await write(state => {
      if (upload.operation === 'replace' || upload.operation === 'copy') {
        const old = state.presets.findIndex(item => item.id === upload.presetId);
        if (old < 0) throw new Error('原预设已被移除；请导出草稿后重新导入');
        const previous = state.presets[old];
        if (upload.operation === 'replace' && (previous.revision || previous.digest) !== upload.revision) throw new Error('预设已在其他窗口修改；请另存为副本，或导出草稿后重新打开');
        if (upload.operation === 'replace') {
          state.presets[old] = { ...previous, ...record, id: previous.id, importedAt: previous.importedAt, updatedAt: now() };
        } else {
          record.id = randomUUID(); state.presets.push(record); state.activeId = record.id;
        }
        return;
      }
      // An edited record keeps its ID. Reimporting its original bytes must not
      // overwrite the edited content just because that ID was once a digest.
      const old = state.presets.findIndex(item => item.digest === hash);
      if (old >= 0) record.id = state.presets[old].id;
      else if (state.presets.some(item => item.id === hash)) record.id = randomUUID();
      if (old >= 0) state.presets[old] = record;
      else state.presets.push(record);
      state.activeId = record.id;
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
    cancel({ id }) { uploads.delete(id); return { cancelled: true }; },
    async read({ id, offset = 0, revision }) {
      const state = await read(), record = state.presets.find(item => item.id === id);
      if (!record) throw new Error('预设不存在');
      const currentRevision = record.revision || record.digest;
      if (revision !== undefined && revision !== currentRevision) throw new Error('预设已修改，请重新打开编辑器');
      const text = decodePreset(record.data);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new Error('预设读取位置无效');
      return { id, name: record.name, digest: record.digest, revision: currentRevision, offset, total: text.length, text: text.slice(offset, offset + 50000) };
    },
    async select({ id }) { await write(state => { if (!state.presets.some(item => item.id === id)) throw new Error('预设不存在'); state.activeId = id; }); return list(); },
    async remove({ id }) { await write(state => { state.presets = state.presets.filter(item => item.id !== id); if (state.activeId === id) state.activeId = state.presets[0]?.id || null; }); return list(); },
    async export({ id }) { const state = await read(), record = state.presets.find(item => item.id === id); if (!record) throw new Error('预设不存在'); return { name: record.name, text: decodePreset(record.data) }; },
    async settings(input) {
      await write(state => {
        const next = { ...state.settings };
        // Ignore this removed field from stale clients, including when saving.
        delete next.adapter;
        if (Object.hasOwn(input, 'model')) {
          const model = normalizeModelSelection(input.model);
          if (model) next.model = model;
          else delete next.model;
        }
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
