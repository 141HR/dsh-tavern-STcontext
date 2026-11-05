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
  await store.settings({ maxTokens: '1234', model: { provider: 'configured', model: 'story' }, adapter: 'st' });
  assert.equal((await store.active()).settings.maxTokens, 1234);
  await store.remove({ id: imported.activeId });
  await assert.rejects(store.active(), /先.*导入/);
});
test('compressed store rejects malformed and oversized decompressed payloads', () => {
  assert.equal(decodePreset(encodePreset('你好')), '你好');
  assert.throws(() => decodePreset('invalid'));
  assert.throws(() => decodePreset(encodePreset('a'.repeat(2 * 1024 * 1024 + 1))));
});

test('independent model persists across reloads, validates atomically and can be cleared', async () => {
  const tavern = fakeTavern(), store = createPresetStore(tavern);
  const model = { provider: ' own-provider ', model: 'story', reasoningEffort: 'high' };
  await store.settings({ model, maxTokens: 2048 });
  const expected = { ...model, provider: 'own-provider' };
  assert.deepEqual((await createPresetStore(tavern).list()).settings.model, expected);
  model.model = 'changed-after-save';
  for (const invalid of ['foreground', 'background', {}, [], { provider: 'p', model: '' },
    { provider: 'p', model: 'm', reasoningEffort: 123 }, { provider: 'p', model: 'm', apiKey: 'never-store' }]) {
    await assert.rejects(store.settings({ model: invalid, maxTokens: 1 }), /模型选择无效/);
    assert.deepEqual((await store.list()).settings, { model: expected, maxTokens: 2048 });
  }
  await store.settings({ model: null });
  assert.deepEqual((await store.list()).settings, { maxTokens: 2048 });
});

test('legacy following settings keep presets and sampling but require an independent choice', async () => {
  for (const slot of ['foreground', 'background']) {
    const tavern = fakeTavern(), store = createPresetStore(tavern);
    const original = await upload(store, JSON.stringify(document));
    const data = await tavern.readPluginData();
    data.settings = { model: slot, maxTokens: 1234 };
    await tavern.savePluginData({ data });
    const migrated = createPresetStore(tavern);
    assert.equal((await migrated.list()).activeId, original.activeId);
    assert.deepEqual((await migrated.active()).settings, { maxTokens: 1234 });
    await migrated.settings({ temperature: .5 });
    assert.deepEqual((await tavern.readPluginData()).settings, { maxTokens: 1234, temperature: .5 });
  }
});

test('removed adapter settings migrate without losing presets, models or sampling and cannot be restored by stale clients', async () => {
  for (const adapter of ['st', 'auto', 'spreset']) {
    const tavern = fakeTavern(), store = createPresetStore(tavern);
    const original = await upload(store, JSON.stringify(document));
    const data = await tavern.readPluginData(), model = { provider: 'p', model: 'm' };
    data.settings = { adapter, model, maxTokens: 2048, temperature: 0.7 };
    await tavern.savePluginData({ data });
    const expected = { model, maxTokens: 2048, temperature: 0.7 };
    assert.deepEqual((await store.list()).settings, expected);
    assert.deepEqual((await store.active()).settings, expected);
    await store.settings({ adapter });
    assert.deepEqual((await tavern.readPluginData()).settings, expected);
    assert.equal((await store.list()).activeId, original.activeId);
    assert.equal((await store.export({ id: original.activeId })).text, JSON.stringify(document));
  }
});
