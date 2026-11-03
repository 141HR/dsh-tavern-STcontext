import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, name } from '../index.mjs';
const minimal = {
  prompts: [{ identifier: 'chatHistory', marker: true }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'chatHistory', enabled: true }] }],
  extensions: { regex_scripts: [{ id: 'once', placement: [2], findRegex: '/X/g', replaceString: 'XX', markdownOnly: true, promptOnly: true }] },
};
const material = { schemaVersion: 1, gameId: 'test', target: { turn: 2 }, card: { name: '角色' }, cardContext: '人物材料',
  persona: { name: '玩家' }, worldbook: { context: '' }, writingRequirements: [], history: [{ role: 'assistant', text: '开场白' }],
  input: { raw: '本轮输入', projected: '本轮输入' }, beforeState: {}, completeness: { history: 'all-visible' } };
function fixture(ready = true) {
  let saved, provider, generator, latest, respond;
  const handlers = new Map(), controller = new AbortController();
  const tavern = {
    readPluginData: async () => structuredClone(saved),
    savePluginData: async ({ data }) => { saved = structuredClone(data); },
    handle: (key, fn) => handlers.set(key, fn),
    onGameRemoved() {},
  };
  if (ready) Object.assign(tavern, {
    bodyGenerator: value => { generator = value; },
    bodyRegenerator: value => { provider = value; },
    startBodyRegeneration: async input => { latest = { id: 'job', status: 'queued', ...input }; return latest; },
    bodyRegenerationStatus: async () => latest,
    cancelBodyRegeneration: async () => ({ ...latest, status: 'cancelled' }),
  });
  const llm = { async prepareCall(config, signal, configure) {
    const { provider, model, ...controls } = config;
    return { config: { ...configure(controls, { context: { contextWindow: 128000 } }), provider, model },
      async *stream(request) {
        const response = await respond(request);
        yield { type: 'text-delta', index: 0, text: response.text };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } };
  } };
  apply({ tavern, llm, get: key => { assert.equal(key, 'tokenMeter'); },
    get tokenMeter() { assert.fail('optional services must be read through ctx.get'); },
    agents: { get: () => ({ model: { current: () => ({ provider: 'fixture', model: 'story', reasoningEffort: 'high' }) } }) } });
  return { handlers, tavern, get provider() { return provider; }, get generator() { return generator; }, call: (key, value) => handlers.get('dsh-tavern-stcontext/' + key)(value),
    generate: (response, current = false) => { respond = response; return (current ? generator : provider).generate({ materials: current ? { ...material, trigger: 'normal', target: { kind: 'generate', turn: 2 } } : material, signal: controller.signal, get runIsolated() { assert.fail('must use DSH directly, including on an older host'); } }); } };
}
async function importPreset(f) {
  const text = JSON.stringify(minimal), { id } = await f.call('upload/begin', { name: 'example.json', size: text.length });
  await f.call('upload/chunk', { id, index: 0, text });
  await f.call('upload/finish', { id });
}
test('host entry imports without a bundled preset and runs the owned provider', async () => {
  const f = fixture();
  assert.equal(name, 'dsh-tavern-STcontext');
  await assert.rejects(f.call('start', { gameId: 'test' }), /先.*导入/);
  await importPreset(f);
  assert.equal((await f.call('start', { gameId: 'test' })).name, 'st-context');
  const output = await f.generate(async request => {
    assert.equal(request.provider, 'fixture');
    assert.equal(request.model, 'story');
    assert.equal(request.reasoningEffort, 'high');
    assert.equal(request.messages.at(-1).content[0].text, '本轮输入');
    return { text: 'X', toolCalls: [], finishReason: { kind: 'stop' } };
  });
  assert.equal(output.text, 'XX');
  assert.equal(output.metadata.outputRegexPasses, 1);
  const preview = await f.call('request', { gameId: 'test' });
  assert.ok(preview.text.includes('开场白'));
  assert.equal((await f.call('cancel', { gameId: 'test' })).status, 'cancelled');
});
test('unsupported hosts still allow import but cannot start a fake regeneration', async () => {
  const f = fixture(false);
  await importPreset(f);
  assert.equal((await f.call('config')).hostReady, false);
  await assert.rejects(f.call('start', { gameId: 'test' }), /宿主缺少/);
});
test('model failure never returns a candidate or runs output replacement', async () => {
  const f = fixture(); await importPreset(f);
  await assert.rejects(f.generate(async () => { throw new Error('model failure'); }), /model failure/);
});

test('current-turn generation and regeneration share one compiler and one output pass', async () => {
  const f = fixture(); await importPreset(f);
  assert.equal(f.generator.generate, f.provider.generate);
  assert.equal((await f.call('config')).generationReady, true);
  assert.equal((await f.generate(async () => ({ text: 'X' }), true)).text, 'XX');
  const preview = await f.call('request', { gameId: 'test' });
  assert.equal(preview.report.trigger, 'normal');
});
