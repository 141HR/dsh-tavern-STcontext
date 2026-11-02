import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetStore, encodePreset, decodePreset } from '../lib/store.mjs';
const document = { prompts: [{ identifier: 'chatHistory', marker: true }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'chatHistory', enabled: true }] }] };
function fakeTavern() {
  let data;
  return { readPluginData: async () => structuredClone(data), savePluginData: async input => { data = structuredClone(input.data); } };
}
async function upload(store, text, name = 'preset.json') {
  const { id } = store.begin({ name, size: text.length });
  for (let index = 0, offset = 0; offset < text.length; index++, offset += 50000) store.chunk({ id, index, text: text.slice(offset, offset + 50000) });
  return store.finish({ id });
}
test('large JSON is chunked, persisted compressed and exported byte-for-byte', async () => {
  const source = JSON.stringify({ ...document, notes: '原始预设数据'.repeat(40000) });
  assert.ok(Buffer.byteLength(source) > 256 * 1024);
  const tavern = fakeTavern(), store = createPresetStore(tavern);
  const imported = await upload(store, source);
  assert.equal(imported.presets.length, 1);
  assert.equal((await store.export({ id: imported.activeId })).text, source);
  assert.equal((await store.active()).document.notes.length, 240000);
  assert.ok(Buffer.byteLength(JSON.stringify(await tavern.readPluginData())) < 256 * 1024);
  assert.equal((await createPresetStore(tavern).list()).activeId, imported.activeId);
});
test('incomplete/out-of-order uploads never replace the active preset', async () => {
  const store = createPresetStore(fakeTavern());
  const original = await upload(store, JSON.stringify(document));
  const { id } = store.begin({ name: 'broken.json', size: 100 });
  assert.throws(() => store.chunk({ id, index: 1, text: 'x' }), /分块/);
  await assert.rejects(store.finish({ id }), /不完整/);
  assert.equal((await store.list()).activeId, original.activeId);
});
test('preset export preserves script data without executing it; edits select/delete persist', async () => {
  const store = createPresetStore(fakeTavern());
  const source = JSON.stringify({ ...document, extensions: { tavern_helper: { scripts: [{ enabled: false, content: 'process.exit(1)' }] } } });
  const imported = await upload(store, source);
  assert.equal((await store.export({ id: imported.activeId })).text, source);
  await store.settings({ maxTokens: '1234', model: 'background', adapter: 'st' });
  assert.equal((await store.active()).settings.maxTokens, 1234);
  await store.remove({ id: imported.activeId });
  await assert.rejects(store.active(), /先.*导入/);
});
test('compressed store rejects malformed and oversized decompressed payloads', () => {
  assert.equal(decodePreset(encodePreset('你好')), '你好');
  assert.throws(() => decodePreset('invalid'));
  assert.throws(() => decodePreset(encodePreset('a'.repeat(2 * 1024 * 1024 + 1))));
});
