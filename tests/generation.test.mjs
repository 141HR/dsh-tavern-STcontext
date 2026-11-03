import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createDshGeneration, selectGenerationModel } from '../lib/generation.mjs'

function harness(chunks, capacity = 128000) {
  const sent = []
  const run = createDshGeneration({ selection: async () => ({ provider: 'test', model: 'story' }),
    llm: { async prepareCall(config, _signal, configure) {
      const { provider, model, ...controls } = config
      return { config: { ...configure(controls, { context: { contextWindow: capacity } }), provider, model },
        async *stream(request) { sent.push(request); yield* chunks } }
    } } })
  return { sent, run: request => run({ gameId: 'game', request }) }
}
const base = { messages: [{ role: 'system', content: '写作要求' }, { role: 'user', content: '完整历史' }], maxTokens: 500 }
const tool = { name: 'return_body', description: '全部上下文', parameters: { type: 'object', properties: { text: { type: 'string' } } } }

test('isolated generation sends exact messages and tool descriptions without adding session history', async () => {
  const h = harness([{ type: 'tool-call-delta', index: 0, id: 'one', name: 'return_body', argumentsDelta: '{"text":' },
    { type: 'tool-call-delta', index: 0, id: 'one', argumentsDelta: '"正文"}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'one', name: 'return_body', arguments: '{"text":"正文"}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } }])
  const result = await h.run({ ...base, tools: [tool], toolChoice: 'auto' })
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0].arguments, '{"text":"正文"}')
  assert.deepEqual(h.sent[0].messages.map(row => [row.role, row.content[0].text]), base.messages.map(row => [row.role, row.content]))
  assert.deepEqual(h.sent[0].tools, [tool])
  assert.equal(h.sent[0].system, '')
})

test('text block-end replaces streamed deltas, and incomplete/tool protocol failures are rejected', async () => {
  const h = harness([{ type: 'text-delta', index: 0, text: '正文' }, { type: 'block-end', index: 0, block: { type: 'text', text: '正文' } }, { type: 'finish', reason: { kind: 'stop' } }])
  assert.equal((await h.run(base)).text, '正文')
  for (const kind of ['max-tokens', 'aborted', 'error']) {
    await assert.rejects(harness([{ type: 'text-delta', text: '不完整' }, { type: 'finish', reason: { kind } }]).run(base), { code: 'STCONTEXT_GENERATION_INCOMPLETE' })
  }
  await assert.rejects(harness([{ type: 'block-end', block: { type: 'tool-call', name: 'return_body', arguments: '{' } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]).run({ ...base, tools: [tool] }), /完整 JSON/)
})

test('overflow includes tool description and sends nothing; unsupported controls fail explicitly', async () => {
  const h = harness([], 2000)
  await assert.rejects(h.run({ ...base, tools: [{ ...tool, description: '历史'.repeat(2000) }] }), { code: 'STCONTEXT_CONTEXT_OVERFLOW' })
  assert.equal(h.sent.length, 0)
  await assert.rejects(h.run({ ...base, tools: [tool], toolChoice: 'required' }), { code: 'STCONTEXT_TOOL_CHOICE_UNSUPPORTED' })
  assert.equal(h.sent.length, 0)
})

test('a cancelled request never starts the provider', async () => {
  let started = false
  const controller = new AbortController()
  controller.abort(new Error('取消'))
  const run = createDshGeneration({ llm: {}, selection() { started = true } })
  await assert.rejects(run({ gameId: 'g', request: base, signal: controller.signal }), /取消/)
  assert.equal(started, false)
})

test('installed DSH preserves the complete request and budgets against its dispatch-bound adapter metadata', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { LlmAdapter, LlmRuntime } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const { Context } = await import(new URL('../../cordis/lib/index.js', bootUrl))
  const ctx = new Context(), llm = new LlmRuntime(ctx)
  t.after(async () => { await ctx.fiber.dispose() })
  const requests = [], lookupSignals = []
  const controller = new AbortController()
  let capacity = 2000
  class Model extends LlmAdapter {
    async resolveModel() { assert.fail('a separate model lookup must not determine this call budget') }
    async prepareCall(provider, model, signal) {
      lookupSignals.push(signal)
      return { model: { provider, id: model, name: model, defaultMaxTokens: 384,
        ...(capacity === undefined ? {} : { context: { contextWindow: capacity } }) },
      stream: options => this.stream(options) }
    }
    async *stream(options) {
      requests.push(options)
      yield { type: 'text-delta', index: 0, text: '独立正文' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  llm.registerAdapter(['isolated-fixture'], new Model())
  const run = createDshGeneration({ llm, selection: async () => ({ provider: 'isolated-fixture', model: 'story' }) })
  const request = { ...base, temperature: 0.75, tools: [tool], messages: [
    { role: 'system', content: '开头规则' }, { role: 'user', content: '第一轮输入' },
    { role: 'assistant', content: '第一轮正文' }, { role: 'system', content: '深度插入规则' },
    { role: 'user', content: '本轮原输入' }
  ] }
  const result = await run({ gameId: 'game', request, signal: controller.signal })
  assert.equal(result.text, '独立正文')
  assert.deepEqual(lookupSignals, [controller.signal])
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].messages.map(row => ({ role: row.role, content: row.content[0].text })), request.messages)
  assert.ok(requests[0].messages.every(row => row.id && row.source.kind === 'plugin:dsh-tavern-STcontext'))
  assert.equal(requests[0].system, '')
  assert.equal(requests[0].toolHistory, undefined)
  assert.deepEqual(requests[0].tools, [tool])
  assert.equal(requests[0].temperature, 0.75)
  assert.equal(requests[0].maxTokens, 500)

  // An imported preset cannot enlarge the actual model window. The full tool
  // description participates in the budget; rejection dispatches nothing.
  await assert.rejects(run({ gameId: 'game', request: { ...request, contextLimit: 128000,
    tools: [{ ...tool, description: '完整历史'.repeat(1000) }] } }), { code: 'STCONTEXT_CONTEXT_OVERFLOW' })
  assert.equal(requests.length, 1)

  const { maxTokens: _maxTokens, ...withModelDefault } = request
  await run({ gameId: 'game', request: withModelDefault })
  assert.equal(requests.at(-1).maxTokens, 384)

  capacity = undefined
  await assert.rejects(run({ gameId: 'game', request }), { code: 'STCONTEXT_CONTEXT_CAPACITY_UNKNOWN' })
  assert.equal(requests.length, 2)
  await run({ gameId: 'game', request: { ...request, contextLimit: 2000 } })
  assert.equal(requests.length, 3)
})


test('foreground uses the public current selection; background uses its existing Tavern setting', async () => {
  let backgroundReads = 0;
  let selected = { provider: 'configured', model: 'next-model', reasoningEffort: 'high' };
  const ctx = { agents: { get: id => {
    assert.equal(id, 'game');
    return { model: { current: () => selected }, session: { requestHeader() { assert.fail('must not read stale request headers'); } } };
  } }, tavern: { backgroundModel: async ({ gameId }) => {
    assert.equal(gameId, 'game'); backgroundReads++;
    return { provider: 'background', model: 'settlement', reasoningEffort: 'low' };
  } } };
  assert.deepEqual(await selectGenerationModel(ctx, 'game', 'foreground'), selected);
  assert.equal(backgroundReads, 0);
  assert.deepEqual(await selectGenerationModel(ctx, 'game', 'background'), { provider: 'background', model: 'settlement', reasoningEffort: 'low' });
  assert.equal(backgroundReads, 1);
  selected = { provider: 'configured', model: 'changed' };
  assert.deepEqual(await selectGenerationModel(ctx, 'game', 'foreground'), selected);
  selected = undefined;
  await assert.rejects(selectGenerationModel(ctx, 'game', 'foreground'), /没有可用模型/);
});

test('cancellation propagates into the DSH stream and rejects partial output without retry', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const run = createDshGeneration({ selection: async () => ({ provider: 'fixture', model: 'story' }), llm: {
    async prepareCall(config, signal, configure) {
      assert.equal(signal, controller.signal);
      const { provider, model, ...controls } = config;
      return { config: { ...configure(controls, { context: { contextWindow: 128000 } }), provider, model },
        async *stream(options) {
          attempts++;
          assert.equal(options.signal, signal);
          yield { type: 'text-delta', text: '未完成正文' };
          controller.abort(new Error('用户取消'));
          yield { type: 'finish', reason: { kind: 'stop' } };
        } };
    }
  } });
  await assert.rejects(run({ gameId: 'game', request: base, signal: controller.signal }), /用户取消/);
  assert.equal(attempts, 1);
});
