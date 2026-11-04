import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply } from '../index.mjs';

// Uses production host preparation/commit and the real plugin compiler with a
// deterministic model response. No imported preset or paid request is needed.
for (const mode of ['plugin-direct', 'plugin-tool-call']) test(`upstream ${mode}: frozen config -> STcontext -> reusable receipt -> one settlement`, {
  skip: !process.env.STCONTEXT_HOST_REPO,
}, async () => {
  const host = path => import(pathToFileURL(resolve(process.env.STCONTEXT_HOST_REPO, 'tavern-plugin/lib', path)).href);
  const [{ createTurnOrchestrator }, { createStoryTimeline }, { createForegroundFrameBuilder },
    { createPluginBodyGeneration }, { createBodyGenerationProviders }, { projectReplyLayers },
    { registerTurnLifecycleHooks }, { createForegroundHandoff }] = await Promise.all([
    host('domain/turn-orchestration.js'), host('domain/story-timeline.js'), host('domain/agent-input-frame.js'),
    host('domain/plugin-body-generation.js'), host('domain/body-generation-providers.js'), host('domain/reply-presentation.js'),
    host('hooks/turn-lifecycle.js'), host('domain/foreground-handoff.js'),
  ]);
  const copy = structuredClone, revisions = new Map();
  let state = { id: 'chat', sessionId: 'session', cardPath: 'cards/test.json', cardName: '角色', mode: 'story',
    messages: [{ role: 'assistant', greeting: true, turn: 1, text: 'summary', projectionText: '完整历史正文' }],
    cardContextSnapshot: '已解析人物设定', macroState: { userName: '玩家', local: {}, global: {} }, variables: { hp: 10 }, posture: '起点', _storageRevision: 1 };
  revisions.set(1, copy(state));
  const store = {
    async chatForSession() { return copy(state); },
    async readCard() { return { name: '角色', description: '人物设定' }; },
    async writeChat(next) { state = { ...copy(next), _storageRevision: state._storageRevision + 1 }; revisions.set(state._storageRevision, copy(state)); return copy(state); },
    async updateChat(id, callback) { const next = await callback(copy(state)); if (next) await this.writeChat(next); return copy(state); },
  };
  const providers = createBodyGenerationProviders({ allowed: async () => true });
  const generation = createPluginBodyGeneration({ chatForSession: store.chatForSession,
    updateChat: store.updateChat.bind(store), readRevision: async (id, rev) => copy(revisions.get(rev)), providers,
    settings: async () => ({ storyGenerationMode: mode, storyGenerationProvider: 'dsh-tavern-STcontext:st-context' }) });
  const turns = createTurnOrchestrator({ store, timeline: createStoryTimeline(), frameBuilder: createForegroundFrameBuilder(),
    bodyGeneration: () => generation.route('session'), prepareBodyGeneration: () => generation.prepare('session'),
    planner: { plan: async () => ({ text: '写作要求' }) }, projectReply: projectReplyLayers });
  let pluginData, requests = 0;
  const handlers = new Map();
  apply({ get: () => undefined, tavern: { capabilities: { bodyGeneration: 1 }, handle: (name, callback) => handlers.set(name, callback),
    readPluginData: async () => copy(pluginData), savePluginData: async ({ data }) => { pluginData = copy(data); },
    bodyGenerator: entry => providers.register('dsh-tavern-STcontext', entry) },
    get agents() { assert.fail('plugin generation must be independent of foreground selection'); },
    llm: { async prepareCall(config, signal, configure) {
      return { config: configure(config, { context: { contextWindow: 128000 } }), async *stream(request) {
        requests++;
        assert.equal(request.provider, 'independent');
        assert.equal(request.model, 'plugin-story');
        const wire = JSON.stringify(request.messages);
        for (const value of ['完整历史正文', '已解析人物设定', '继续', '起点', 'normal-only']) assert.ok(wire.includes(value), value);
        assert.doesNotMatch(wire, /regenerate-only|summary|不可传入的读取结果/);
        assert.equal(wire.split('本轮查询补充').length - 1, mode === 'plugin-tool-call' ? 1 : 0);
        yield { type: 'text-delta', index: 0, text: '<div>X</div>' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } };
    } },
  });
  const call = (name, args) => handlers.get('dsh-tavern-stcontext/' + name)(args);
  const preset = JSON.stringify({ prompts: [{ identifier: 'chatHistory', marker: true },
    { identifier: 'normal', role: 'system', content: 'normal-only', injection_trigger: ['normal'] },
    { identifier: 'regen', role: 'system', content: 'regenerate-only', injection_trigger: ['regenerate'] }],
    prompt_order: [{ character_id: 100001, order: ['normal', 'regen', 'chatHistory'].map(identifier => ({ identifier, enabled: true })) }],
    extensions: { regex_scripts: [{ id: 'once', placement: [2], findRegex: '/X/g', replaceString: 'XX', markdownOnly: true, promptOnly: true }] } });
  const { id } = await call('upload/begin', { name: 'test.json', size: preset.length });
  await call('upload/chunk', { id, index: 0, text: preset }); await call('upload/finish', { id });
  await call('settings', { model: { provider: 'independent', model: 'plugin-story' } });
  await turns.prepare({ sessionId: 'session', turn: 2, userText: '继续', requestId: 'r' });
  // Settings changed after preparation must not change this operation's model.
  await call('settings', { model: { provider: 'later', model: 'next-turn' } });
  const session = { id: 'session', events: [{ type: 'turn/start', data: { turn: 2 } }] };
  if (mode === 'plugin-tool-call') {
    for (const [id, name, text] of [['lookup', 'worldbook_search', '本轮查询补充'], ['read', 'read', '不可传入的读取结果']]) {
      session.events.push(
        { type: 'assistant/message', data: { turn: 2, message: { source: { kind: 'model' }, content: [{ type: 'tool-call', id, name, arguments: '{}' }] } } },
        { type: 'tool/call', data: { turn: 2, callId: id, name, arguments: '{}' } },
        { type: 'tool/result', data: { turn: 2, message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text }] } } });
    }
  }
  const direct = await generation.direct(session, new AbortController().signal);
  if (mode === 'plugin-direct') {
    const chunks = []; for await (const chunk of direct) chunks.push(chunk);
    assert.equal(chunks[0].block.name, 'tavern_generate_body');
  } else assert.equal(direct, null);
  let concludes = 0;
  const receipt = await generation.tool.execute({}, { agent: { session }, signal: new AbortController().signal, concludeTurn() { concludes++; } });
  assert.equal(JSON.parse(receipt).text, '<div>XX</div>');
  const reused = await generation.tool.execute({}, { agent: { session }, signal: new AbortController().signal, concludeTurn() {} });
  assert.equal(reused, receipt);
  assert.equal(requests, 1);
  session.events.push({ type: 'assistant/message', data: { turn: 2, step: 1, message: { id: 'model', source: { kind: 'model' }, content: [
    { type: 'tool-call', id: 'body', name: 'tavern_generate_body', arguments: '{}' }] } } },
    { type: 'tool/call', data: { turn: 2, callId: 'body', name: 'tavern_generate_body', arguments: '{}' } },
    { type: 'tool/result', data: { turn: 2, message: { role: 'tool', toolCallId: 'body', content: [{ type: 'text', text: receipt }] } } });
  const hooks = new Map(), pending = []; let settlements = 0, projected;
  const handoff = createForegroundHandoff({ turns, store, tasks: { activity: chat => ({ role: 'settlement', phase: chat.settleStatus }) },
    queueBackground: async () => { settlements++; }, defer: callback => pending.push(callback) });
  registerTurnLifecycleHooks({ ctx: { on: (name, callback) => hooks.set(name, callback) }, pluginBodyGeneration: generation,
    clearRuntimePresetRequestState() {}, backgroundAgentRunner: { owns: () => false },
    userMessageForTurn: () => ({ role: 'user', content: [{ type: 'text', text: '继续' }] }), contentText: () => '继续',
    requestIdForTurn: () => 'r', turnOrchestrator: turns, foregroundHandoff: handoff,
    replaceAssistantReply(session, result, text) { projected = text; } });
  await hooks.get('agent/turn-stopping')({ agent: { session }, turn: 2 });
  handoff.end({ sessionId: 'session', turn: 2, reason: 'completed' });
  for (const work of pending) work();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1); assert.equal(concludes, 1); assert.equal(settlements, 1);
  assert.equal(state.messages.length, 3);
  assert.equal(state.messages.at(-1).text, '<div>XX</div>');
  assert.equal(state.messages.at(-1).bodyRegenerationProcessed, true);
  assert.equal(projected, '<div>XX</div>');
});
