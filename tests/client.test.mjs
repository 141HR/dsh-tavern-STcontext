import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { apply } from '../index.mjs';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const simplePreset = { prompts: [{ identifier: 'chatHistory', marker: true }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'chatHistory', enabled: true }] }] };

// Drive the real client and host entry with a tiny hook scheduler; no DOM or framework dependency.
function harness({ hostReady = true, initialModel, initialSettings = {}, catalogFailure = false, resolveModelInfo } = {}) {
  const hooks = [], effects = [], pending = new Set(), timers = new Map(), calls = [], downloads = [], disposers = [];
  let cursor = 0, dirty = true, tree, component, properties, panel, action, overlay, registered, settingsSection, settingsSpec, saved, status = null, serial = 0;
  const handlers = new Map();
  saved = { schemaVersion: 1, presets: [], activeId: null, settings: { ...initialSettings, ...(initialModel === undefined ? {} : { model: initialModel }) } };
  let modelFailure = catalogFailure;
  const models = [{ id: 'story', name: 'Story', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }, { id: 'other', name: 'Other' }];
  const tavern = { readPluginData: async () => structuredClone(saved), savePluginData: async ({ data }) => { saved = structuredClone(data); },
    handle: (key, fn) => handlers.set(key, fn), onGameRemoved() {} };
  if (hostReady) Object.assign(tavern, {
    bodyRegenerator() {},
    startBodyRegeneration: async input => (status = { id: 'job', gameId: input.gameId, status: 'running', phase: 'generating' }),
    bodyRegenerationStatus: async () => structuredClone(status),
    cancelBodyRegeneration: async () => (status = { ...status, status: 'cancelled' }),
  });
  apply({ tavern, get: () => undefined, llm: {
    listProviders: () => [{ id: 'own', name: 'Own Provider' }],
    listModels: async () => { if (modelFailure) throw new Error('offline'); return models.map(({ reasoning, ...summary }) => summary); },
    resolveModelInfo: resolveModelInfo || (async (provider, model) => {
      if (provider !== 'own') throw new Error('unknown provider');
      return models.find(item => item.id === model);
    }),
  } });
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) }),
    useState(initial) {
      const i = cursor++;
      hooks[i] ||= { value: initial };
      return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; dirty = true; }];
    },
    useRef(initial) { const i = cursor++; hooks[i] ||= { current: initial }; return hooks[i]; },
    useEffect(effect, deps) {
      const i = cursor++, prior = hooks[i];
      if (!prior || deps.some((value, j) => !Object.is(value, prior.deps[j]))) {
        hooks[i] = { deps, cleanup: prior?.cleanup };
        effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = effect(); });
      }
    },
  };
  const ui = {
    callHost(name, input) {
      calls.push({ name: name.replace('dsh-tavern-stcontext/', ''), input: structuredClone(input) });
      const promise = Promise.resolve().then(() => handlers.get(name)(input));
      pending.add(promise); promise.then(() => pending.delete(promise), () => pending.delete(promise));
      return promise;
    },
    registerPanel: entry => { panel = entry; }, registerComposerAction: entry => { action = entry; }, openOverlay: entry => { overlay = entry; },
  };
  const blobs = new Map();
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { registered = value; } } },
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    Blob, URL: { createObjectURL: blob => { const key = 'blob:' + serial++; blobs.set(key, blob); return key; }, revokeObjectURL: key => blobs.delete(key) },
    document: { createElement: () => ({ click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); } }) },
  });
  registered.factory(name => { assert.equal(name, 'react'); return React; }).apply({
    tavernUi: ui,
    effect: run => { disposers.push(run()); },
    slots: {
      inject: (name, run) => { assert.equal(name, 'settings.section'); return run(); },
      register: (spec, render) => {
        assert.equal(spec.name, 'settings.section'); settingsSpec = spec; settingsSection = render;
        return () => { settingsSpec = null; settingsSection = null; };
      },
    },
  });
  function render() {
    if (!dirty || !component) return;
    dirty = false; cursor = 0; tree = component(properties);
    while (effects.length) effects.shift()();
  }
  async function flush() {
    for (let i = 0; i < 50; i++) {
      render();
      if (pending.size) await Promise.allSettled([...pending]);
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !pending.size && !effects.length) return;
    }
    throw new Error('Client did not settle');
  }
  function nodes(node = tree) {
    return node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(child => nodes(child))] : [];
  }
  const contents = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(contents).join('');
  return {
    calls, downloads, get status() { return status; }, set status(value) { status = value; },
    get settingsSpec() { return settingsSpec; },
    get saved() { return structuredClone(saved); }, set modelFailure(value) { modelFailure = value; },
    async mount(useAction = false) {
      let element;
      if (useAction === 'settings') element = settingsSection();
      else if (useAction) { await action.run({ gameId: 'game' }); element = overlay.render({ close() {} }); }
      else element = panel.render({ gameId: 'game' });
      component = element.type; properties = element.props; await flush();
    },
    async input(file) { const target = { files: [file], value: 'selected.json' }; nodes().find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target }); assert.equal(target.value, ''); await flush(); },
    async click(label) { const element = nodes().find(node => node.type === 'button' && contents(node) === label); assert.ok(element, label); assert.ok(!element.props.disabled, label + ' must be enabled'); await element.props.onClick(); await flush(); },
    async poll() { const item = [...timers].find(([, timer]) => timer.delay === 1200); assert.ok(item); timers.delete(item[0]); await item[1].fn(); await flush(); },
    numberInputs: () => nodes().filter(node => node.type === 'input' && node.props.type === 'number').length,
    async choose(label, value, settle = true) { const node = nodes().find(node => node.type === 'select' && node.props['aria-label'] === label); assert.ok(node, label); assert.ok(!node.props.disabled); node.props.onChange({ target: { value } }); if (settle) await flush(); else render(); },
    flush,
    selectDisabled: label => nodes().find(node => node.type === 'select' && node.props['aria-label'] === label)?.props.disabled,
    selectValue: label => nodes().find(node => node.type === 'select' && node.props['aria-label'] === label)?.props.value,
    text: () => contents(tree),
    disabled: label => nodes().find(node => node.type === 'button' && contents(node) === label)?.props.disabled,
    destroy() { for (const item of hooks) item?.cleanup?.(); timers.clear(); for (const dispose of disposers) dispose?.(); },
  };
}
const file = (text, name = 'imported.json') => ({ name, size: Buffer.byteLength(text), text: async () => text });

test('native settings configures presets and models without a game and unregisters on unload', async () => {
  const h = harness();
  try {
    assert.equal(h.settingsSpec.id, 'dsh-tavern-stcontext');
    assert.equal(h.settingsSpec.label(), 'STcontext');
    await h.mount('settings');
    await h.input(file(JSON.stringify(simplePreset)));
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'story' }));
    await h.choose('推理等级', 'high');
    await h.click('保存设置');
    assert.equal(h.saved.presets.length, 1);
    assert.deepEqual(h.saved.settings.model, { provider: 'own', model: 'story', reasoningEffort: 'high' });
    assert.match(h.text(), /设置已保存/);
    assert.match(h.text(), /打开游戏后/);
    assert.equal(h.disabled('重新生成最新正文'), undefined);
    assert.equal(h.disabled('查看本次请求'), undefined);
    assert.equal(h.calls.some(call => ['status', 'start', 'cancel', 'request'].includes(call.name)), false);
  } finally { h.destroy(); }
  assert.equal(h.settingsSpec, null);
});

test('client imports in chunks, exports exact JSON, saves controls, starts and cancels', async () => {
  const h = harness();
  try {
    await h.mount(true);
    assert.equal(h.disabled('重新生成最新正文'), true);
    const source = JSON.stringify(simplePreset) + ' '.repeat(110000);
    await h.input(file(source));
    assert.equal(h.calls.filter(call => call.name === 'upload/chunk').length, 3);
    assert.match(h.text(), /预设已导入/);
    assert.equal(h.disabled('重新生成最新正文'), true);
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'story' }));
    await h.choose('推理等级', 'high');
    assert.equal(h.disabled('重新生成最新正文'), false);
    await h.click('导出原文件');
    assert.equal(await h.downloads[0].blob.text(), source);
    assert.equal(h.numberInputs(), 0);
    assert.doesNotMatch(h.text(), /输出\s*token\s*上限|上下文预算|温度/);
    await h.click('保存设置');
    assert.deepEqual(h.saved.settings.model, { provider: 'own', model: 'story', reasoningEffort: 'high' });
    await h.click('重新生成最新正文');
    assert.equal(h.calls.filter(call => call.name === 'start').at(-1).input.gameId, 'game');
    assert.match(h.text(), /独立生成中/);
    assert.equal(h.disabled('导入 JSON'), true);
    assert.equal(h.disabled('取消生成'), false);
    await h.click('取消生成');
    assert.match(h.text(), /已取消/);
    assert.equal(h.calls.filter(call => call.name === 'cancel').at(-1).input.id, 'job');
    assert.equal(h.disabled('重新生成最新正文'), false);
    assert.equal(h.disabled('取消生成'), true);
    await h.click('移除');
    assert.equal(h.disabled('重新生成最新正文'), true);
  } finally { h.destroy(); }
});

test('client displays structured errors and committed settlement failure without losing status', async () => {
  const h = harness({ initialModel: { provider: 'own', model: 'story' } });
  try {
    await h.mount(); await h.input(file(JSON.stringify(simplePreset)));
    h.status = { id: 'job', status: 'failed', phase: 'generating', error: { code: 'REJECTED', message: '模型拒绝这次请求' } };
    await h.poll(); assert.match(h.text(), /模型拒绝这次请求/);
    h.status = { id: 'job', status: 'running', phase: 'settling', committed: true, cancellable: false };
    await h.poll(); assert.equal(h.disabled('取消生成'), true);
    h.status = { id: 'job', status: 'completed', phase: 'completed', result: { settlementStatus: 'failed', warning: '后台模型暂不可用' } };
    await h.poll();
    assert.match(h.text(), /后台模型暂不可用/); assert.match(h.text(), /新正文已保留/);
    assert.equal(h.disabled('重新生成最新正文'), false);
    await h.click('查看本次请求'); assert.match(h.text(), /还没有已编译请求/);
  } finally { h.destroy(); }
});

test('client reports invalid imports and keeps unsupported hosts unable to generate', async () => {
  const h = harness({ hostReady: false });
  try {
    await h.mount(); assert.match(h.text(), /宿主尚未提供重生成接口/);
    await h.input(file('{ broken')); assert.match(h.text(), /JSON/);
    await h.input(file(JSON.stringify(simplePreset))); assert.match(h.text(), /预设已导入/);
    assert.equal(h.disabled('重新生成最新正文'), true);
    assert.equal(h.calls.some(call => call.name === 'status'), false);
  } finally { h.destroy(); }
});

test('legacy selection requires a new choice; catalog failure can be refreshed without losing settings', async () => {
  const h = harness({ initialModel: 'background', catalogFailure: true });
  try {
    await h.mount(); await h.input(file(JSON.stringify(simplePreset)));
    assert.match(h.text(), /旧版前台\/后台跟随设置需重新选择/);
    assert.match(h.text(), /模型列表读取失败/);
    assert.equal(h.selectValue('插件正文模型'), '');
    assert.equal(h.disabled('重新生成最新正文'), true);
    await h.choose('请求模式', 'st');
    h.modelFailure = false;
    await h.click('刷新模型列表');
    assert.doesNotMatch(h.text(), /模型列表读取失败/);
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'story' }));
    await h.choose('推理等级', 'high');
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'other' }));
    await h.click('保存设置');
    assert.deepEqual(h.saved.settings.model, { provider: 'own', model: 'other' });
    assert.equal(h.saved.settings.adapter, 'st');
  } finally { h.destroy(); }
});

test('saved unavailable models stay visible instead of silently selecting another route', async () => {
  const model = { provider: 'removed-provider', model: 'saved-story' };
  const h = harness({ initialModel: model });
  try {
    await h.mount();
    assert.equal(h.selectValue('插件正文模型'), JSON.stringify(model));
    assert.match(h.text(), /saved-story（未在列表中找到）/);
    await h.click('刷新模型列表'); await h.click('保存设置');
    assert.deepEqual(h.saved.settings.model, model);
  } finally { h.destroy(); }
});

test('preset import keeps unsaved model edits and saving preserves hidden sampling settings', async () => {
  const sampling = { maxTokens: 2048, contextLimit: 32768, temperature: .7 };
  const h = harness({ initialSettings: sampling });
  try {
    await h.mount();
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'story' }));
    await h.choose('推理等级', 'high');
    await h.choose('请求模式', 'st');
    await h.input(file(JSON.stringify(simplePreset)));
    assert.match(h.text(), /有未保存的更改/);
    assert.equal(h.selectValue('推理等级'), 'high');
    assert.equal(h.selectValue('请求模式'), 'st');
    assert.equal(h.numberInputs(), 0);
    await h.click('重新生成最新正文');
    assert.deepEqual(h.saved.settings, { ...sampling, adapter: 'st', model: { provider: 'own', model: 'story', reasoningEffort: 'high' } });
    const patch = h.calls.filter(call => call.name === 'settings').at(-1).input;
    for (const key of Object.keys(sampling)) assert.equal(Object.hasOwn(patch, key), false);
    assert.doesNotMatch(h.text(), /有未保存的更改/);
  } finally { h.destroy(); }
});

test('reasoning selector stays visible and disabled for models without levels', async () => {
  const h = harness();
  try {
    await h.mount();
    assert.equal(h.selectValue('推理等级'), '');
    assert.equal(h.selectDisabled('推理等级'), true);
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'story' }));
    assert.equal(h.selectDisabled('推理等级'), false);
    await h.choose('推理等级', 'high');
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'other' }));
    assert.equal(h.selectValue('推理等级'), '');
    assert.equal(h.selectDisabled('推理等级'), true);
    assert.match(h.text(), /该模型未提供可选推理等级，使用模型默认/);
    await h.click('保存设置');
    assert.deepEqual(h.saved.settings.model, { provider: 'own', model: 'other' });
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'story' }));
    assert.equal(h.selectDisabled('推理等级'), false);
    await h.choose('推理等级', 'high');
    await h.choose('推理等级', '');
    await h.click('保存设置');
    assert.deepEqual(h.saved.settings.model, { provider: 'own', model: 'story' });
  } finally { h.destroy(); }
});

test('confirmed models without levels clear an obsolete saved override', async () => {
  const h = harness({ initialModel: { provider: 'own', model: 'other', reasoningEffort: 'high' } });
  try {
    await h.mount();
    assert.equal(h.selectValue('推理等级'), '');
    assert.equal(h.selectDisabled('推理等级'), true);
    assert.match(h.text(), /有未保存的更改/);
    await h.click('保存设置');
    assert.deepEqual(h.saved.settings.model, { provider: 'own', model: 'other' });
  } finally { h.destroy(); }
});

test('capability failure keeps saved effort, reports an error and can be retried', async () => {
  let failure = true;
  const model = { provider: 'own', model: 'story', reasoningEffort: 'high' };
  const h = harness({ initialModel: model, resolveModelInfo: async () => {
    if (failure) throw new Error('Authorization: secret');
    return { id: 'story', reasoning: { efforts: [{ id: 'high' }] } };
  } });
  try {
    await h.mount();
    assert.equal(h.selectDisabled('推理等级'), true);
    assert.equal(h.selectValue('推理等级'), 'high');
    assert.match(h.text(), /推理等级读取失败/);
    assert.doesNotMatch(h.text(), /该模型未提供|secret/);
    await h.click('保存设置');
    assert.deepEqual(h.saved.settings.model, model);
    failure = false;
    await h.click('刷新模型列表');
    assert.equal(h.selectDisabled('推理等级'), false);
    assert.equal(h.selectValue('推理等级'), 'high');
    assert.doesNotMatch(h.text(), /推理等级读取失败/);
  } finally { h.destroy(); }
});

test('late capability responses cannot enable reasoning for a subsequently selected model', async () => {
  let finish;
  const delayed = new Promise(resolve => { finish = resolve; });
  const h = harness({ resolveModelInfo: async (_provider, model) => model === 'story' ? delayed : { id: model } });
  try {
    await h.mount();
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'story' }), false);
    assert.equal(h.selectDisabled('推理等级'), true);
    assert.equal(h.disabled('保存设置'), true);
    await h.choose('插件正文模型', JSON.stringify({ provider: 'own', model: 'other' }), false);
    finish({ id: 'story', reasoning: { efforts: [{ id: 'high' }] } });
    await h.flush();
    assert.equal(h.selectValue('推理等级'), '');
    assert.equal(h.selectDisabled('推理等级'), true);
    assert.match(h.text(), /该模型未提供可选推理等级/);
    await h.click('保存设置');
    assert.deepEqual(h.saved.settings.model, { provider: 'own', model: 'other' });
  } finally { finish({ id: 'story' }); h.destroy(); }
});
