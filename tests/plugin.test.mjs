import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, name } from '../index.mjs';
import { materials, preset } from './fixtures/materials.mjs';

function fixture(capability = 1, apiVersion = 7) {
  let saved, generator, respond, requests = 0;
  const handlers = new Map();
  const tavern = {
    apiVersion, capabilities: { bodyGeneration: capability },
    readPluginData: async () => structuredClone(saved),
    savePluginData: async ({ data }) => { saved = structuredClone(data); },
    handle: (key, fn) => handlers.set(key, fn), onGameRemoved() {},
    bodyGenerator: entry => { assert.equal(generator, undefined); generator = entry; },
    get bodyRegenerator() { assert.fail('must not access fork APIs'); },
  };
  const llm = { async prepareCall(config, signal, configure) {
    const { provider, model, ...controls } = config;
    return { config: { ...configure(controls, { context: { contextWindow: 128000 } }), provider, model },
      async *stream(request) {
        requests++;
        const response = await respond(request);
        yield { type: 'text-delta', index: 0, text: response.text };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } };
  } };
  apply({ tavern, llm, get: key => { assert.equal(key, 'tokenMeter'); },
    get agents() { assert.fail('must not read the foreground model'); } });
  return {
    get generator() { return generator; }, get requests() { return requests; }, handlers,
    call: (key, value) => handlers.get('dsh-tavern-stcontext/' + key)(value),
    prepare: () => generator.prepare({ gameId: 'test', reason: 'normal', signal: new AbortController().signal }),
    generate: (response, config, input = materials, signal = new AbortController().signal) => {
      respond = response;
      return generator.generate({ materials: structuredClone(input), config, signal });
    },
  };
}
async function importPreset(f, document = preset) {
  const text = JSON.stringify(document), { id } = await f.call('upload/begin', { name: 'example.json', size: text.length });
  await f.call('upload/chunk', { id, index: 0, text });
  await f.call('upload/finish', { id });
  await f.call('settings', { model: { provider: 'fixture', model: 'story', reasoningEffort: 'high' } });
}

test('upstream API 7 registers once, imports, and freezes configuration without a model request', async () => {
  const f = fixture();
  assert.equal(name, 'dsh-tavern-STcontext');
  await assert.rejects(f.prepare(), /先.*导入/);
  await importPreset(f);
  const config = await f.prepare();
  assert.equal(f.requests, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
  assert.equal((await f.call('config')).hostReady, true);
  assert.equal((await f.call('config')).generationReady, true);
  for (const key of ['start', 'status', 'cancel']) assert.equal(f.handlers.has('dsh-tavern-stcontext/' + key), false);
});

test('capabilities, not fork API versions or method presence alone, control registration', async () => {
  for (const capability of [0, null, 2]) {
    const f = fixture(capability, 8);
    await importPreset(f);
    assert.equal((await f.call('config')).hostReady, false);
    assert.equal(f.generator, undefined);
  }
  assert.ok(fixture(1, 7).generator);
});

for (const reason of ['normal', 'regenerate', 'retry']) {
  test(`${reason} uses complete upstream materials and runs output regex once`, async () => {
    const f = fixture(); await importPreset(f);
    const config = await f.prepare();
    const output = await f.generate(async request => {
      assert.equal(request.provider, 'fixture'); assert.equal(request.model, 'story');
      assert.equal(request.reasoningEffort, 'high');
      const text = request.messages.map(m => m.content[0].text).join('\n');
      for (const value of [...materials.history.map(m => m.text), ...materials.context.map(m => m.text),
        '测试角色与测试玩家', '输入处理后的状态', '"hp":10', '"inputCount":2', '本轮已处理输入', '额外指导']) {
        assert.equal(text.split(value).length - 1, 1, value + ' must occur once');
      }
      assert.ok(text.includes(reason === 'normal' ? 'normal-only' : 'regenerate-only'));
      assert.ok(!text.includes(reason === 'normal' ? 'regenerate-only' : 'normal-only'));
      assert.ok(!text.includes('原始输入'));
      return { text: '<div>X</div>' };
    }, config, { ...materials, reason, guidance: '额外指导' });
    assert.deepEqual(output, { text: '<div>XX</div>' });
    assert.equal(f.requests, 1);
    const preview = await f.call('request', { gameId: 'test' });
    assert.equal(preview.report.reason, reason);
    assert.equal(preview.report.operationId, 'operation');
    assert.deepEqual(JSON.parse(preview.text).request.model, config.settings.model);
  });
}

test('prepared preset/model survive selection changes and removal until the next operation', async () => {
  const f = fixture(); await importPreset(f);
  const firstId = (await f.call('config')).activeId, frozen = JSON.parse(JSON.stringify(await f.prepare()));
  const next = structuredClone(preset); next.extensions.regex_scripts[0].replaceString = 'YY';
  await importPreset(f, next);
  await f.call('settings', { model: { provider: 'later', model: 'next' } });
  await f.call('remove', { id: firstId });
  const old = await f.generate(async request => { assert.equal(request.model, 'story'); return { text: 'X' }; }, frozen);
  const current = await f.generate(async request => { assert.equal(request.model, 'next'); return { text: 'X' }; }, await f.prepare());
  assert.equal(old.text, 'XX'); assert.equal(current.text, 'YY');
  await assert.rejects(f.generate(() => assert.fail('no model request'), null), /冻结的预设配置/);
  assert.equal(f.requests, 2);
});

test('invalid selection/materials fail before dispatch; model failure never returns a candidate', async () => {
  const f = fixture(); await importPreset(f);
  await f.call('settings', { model: null });
  await assert.rejects(f.prepare(), /选择插件正文模型/);
  await importPreset(f);
  const config = await f.prepare();
  await assert.rejects(f.generate(() => assert.fail('no dispatch'), config, { ...materials, schemaVersion: 2 }), /材料格式/);
  assert.equal(f.requests, 0);
  await assert.rejects(f.generate(async () => { throw new Error('model failure'); }, config), /model failure/);
});

test('cancellation before compilation or after a late model response cannot return prose', async () => {
  const f = fixture(); await importPreset(f);
  const config = await f.prepare(), early = new AbortController(); early.abort(new Error('stopped early'));
  await assert.rejects(f.generate(() => assert.fail('no dispatch'), config, materials, early.signal), /stopped early/);
  assert.equal(f.requests, 0);
  const late = new AbortController();
  await assert.rejects(f.generate(async () => { late.abort(new Error('stopped late')); return { text: 'X' }; }, config, materials, late.signal), /stopped late/);
});
