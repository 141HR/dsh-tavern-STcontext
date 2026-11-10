import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runHostGeneration, hostRules } from './fixtures/host-harness.mjs';

// Uses production host preparation/commit and the real plugin compiler with a
// deterministic model response. No imported preset or paid request is needed.
for (const mode of ['plugin-direct', 'plugin-tool-call']) test(`upstream ${mode}: frozen config -> STcontext -> reusable receipt -> one settlement`, {
  skip: !process.env.STCONTEXT_HOST_REPO,
}, async () => {
  let requests = 0;
  const presetText = JSON.stringify({ notes: 'x'.repeat(3 * 1024 * 1024), prompts: [{ identifier: 'chatHistory', marker: true },
    { identifier: 'normal', role: 'system', content: 'normal-only', injection_trigger: ['normal'] },
    { identifier: 'regen', role: 'system', content: 'regenerate-only', injection_trigger: ['regenerate'] }],
    prompt_order: [{ character_id: 100001, order: ['normal', 'regen', 'chatHistory'].map(identifier => ({ identifier, enabled: true })) }],
    extensions: { regex_scripts: [{ id: 'once', placement: [2], findRegex: '/X/g', replaceString: 'XX', markdownOnly: true, promptOnly: true }] } });
  const result = await runHostGeneration({ mode, presetText, async *stream(request) {
    requests++;
    assert.equal(request.provider, 'independent');
    assert.equal(request.model, 'plugin-story');
    const wire = JSON.stringify(request.messages);
    for (const value of ['完整历史正文', '已解析人物设定', '继续', '起点', 'normal-only']) assert.ok(wire.includes(value), value);
    assert.doesNotMatch(wire, /regenerate-only|summary|不可传入的读取结果/);
    assert.equal(wire.split('本轮查询补充').length - 1, mode === 'plugin-tool-call' ? 1 : 0);
    yield { type: 'text-delta', index: 0, text: '<div>X</div>' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  const { receipt, supportsHostRegex, saved, projected } = result;
  assert.equal(JSON.parse(receipt).text, '<div>XX</div>');
  assert.equal(requests, 1); assert.equal(result.concludes, 1); assert.equal(result.settlements, 1);
  const state = result.state();
  assert.equal(state.messages.length, 3);
  assert.equal(saved.sourceText, '<div>XX</div>');
  assert.equal(saved.text, supportsHostRegex ? '<div>CONTEXT</div>' : '<div>XX</div>');
  assert.equal(saved.displayText, supportsHostRegex ? '<div>DISPLAY</div>' : '<div>XX</div>');
  assert.equal(saved.bodyRegenerationProcessed, true);
  assert.equal(projected, saved.text);
  const reopened = JSON.parse(JSON.stringify(state));
  const { global, preset, context, card } = hostRules;
  assert.equal(result.projectReplyHistory(reopened.messages, { regexScripts: [global, preset, context, card] }).projections.at(-1).text, saved.displayText);
  assert.equal((await result.call('request', { gameId: 'session' })).report.outputProcessing?.hostRegex, supportsHostRegex ? true : undefined);
});

// A bundled UI + generation-hook + ToolManager preset (a ~1.5 MiB script) through the
// same production host path. The file is a user-supplied fixture and is never copied
// into the repository; only the tool switch is enabled, as a user would in the editor.
const izumi = process.env.STCONTEXT_IZUMI_FIXTURE;
test('upstream plugin-direct: bundled helper preset uploads, freezes, compiles, formats ToolManager output and settles once', {
  skip: !process.env.STCONTEXT_HOST_REPO || !izumi,
}, async () => {
  const document = JSON.parse(await readFile(izumi, 'utf8'));
  const toolEntry = document.prompt_order[0].order.find(o => o.identifier === '8180a080-5881-47ad-8de8-83c8be9f90db');
  if (toolEntry) toolEntry.enabled = true;
  let requests = 0, toolNames = [], wire = '';
  const result = await runHostGeneration({ mode: 'plugin-direct', presetText: JSON.stringify(document), async *stream(request) {
    requests++;
    wire = JSON.stringify(request.messages);
    toolNames = (request.tools || []).map(tool => tool.name);
    yield { type: 'tool-call-delta', index: 0, id: 'call-1', name: toolNames[0] || 'missing-tool',
      argumentsDelta: JSON.stringify({ content: '小此看着ㄍㄠ ㄓㄨㄥㄕㄠˇㄋㄩˇ的娇\u200B嫩\n<IzumiEdit>\n新建 记忆\n</IzumiEdit>' }) };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  } });
  assert.equal(requests, 1);
  assert.deepEqual(toolNames, ['izumi_content']);
  for (const value of ['完整历史正文', '已解析人物设定', '继续', '起点']) assert.ok(wire.includes(value), value);
  assert.doesNotMatch(wire, /IZUMI_ANTI_ROUTE/);
  const text = JSON.parse(result.receipt).text.trim();
  assert.equal(text, '小此看着高中少女的娇嫩');
  assert.equal(result.concludes, 1); assert.equal(result.settlements, 1);
  assert.equal(result.state().messages.length, 3);
  assert.equal(result.saved.sourceText.trim(), text);
  assert.equal(result.projected, result.saved.text);
});
