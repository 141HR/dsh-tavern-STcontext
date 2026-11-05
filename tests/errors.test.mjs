import assert from 'node:assert/strict';
import test from 'node:test';
import { createDshGeneration } from '../lib/generation.mjs';
import { modelFailure } from '../lib/errors.mjs';
import { processOutput, compilePreset } from '../lib/preset.mjs';
import { runCompiler } from '../lib/worker-client.mjs';
import { compilerMaterials } from '../lib/materials.mjs';
import { materials, preset } from './fixtures/materials.mjs';

function native(chunks) {
  let calls = 0;
  const run = createDshGeneration({ llm: { async prepareCall(config, signal, configure) {
    return { config: configure(config, { context: { contextWindow: 128000 } }), async *stream() { calls++; yield* chunks; } };
  } } });
  return { run: () => run({ request: { model: { provider: 'fixture', model: 'story' }, maxTokens: 100, messages: [{ role: 'user', content: 'continue' }] } }), calls: () => calls };
}

test('native finish failures retain known reasons and take precedence over partial tools', async () => {
  for (const [reason, code] of [
    [{ kind: 'error', failure: { message: 'Provider finish_reason: content_filter', code: 'PI_AI_ERROR' } }, 'CONTENT_FILTERED'],
    [{ kind: 'error', failure: { code: 'context_length_exceeded' } }, 'CONTEXT_OVERFLOW'],
    [{ kind: 'max-tokens' }, 'OUTPUT_LIMIT'],
    [{ kind: 'error', failure: { message: 'private provider diagnostic' } }, 'GENERATION_INCOMPLETE'],
  ]) {
    const h = native([{ type: 'tool-call-delta', name: 'unknown', argumentsDelta: '{' }, { type: 'finish', reason },
      { type: 'finish', reason: { kind: 'stop' } }]);
    await assert.rejects(h.run(), error => {
      assert.equal(error.code, 'STCONTEXT_' + code); assert.equal(error.stage, 'response');
      assert.doesNotMatch(error.message + JSON.stringify(error), /private/); return true;
    });
    assert.equal(h.calls(), 1);
  }
});

test('native empty, reasoning-only and missing completion receipts remain distinct', async () => {
  for (const [chunks, code] of [
    [[{ type: 'finish', reason: { kind: 'stop' } }], 'EMPTY_RESPONSE'],
    [[{ type: 'reasoning-delta', text: 'private thought' }, { type: 'finish', reason: { kind: 'stop' } }], 'REASONING_ONLY'],
    [[{ type: 'text-delta', text: 'partial body' }], 'STREAM_INTERRUPTED'],
  ]) await assert.rejects(native(chunks).run(), { code: 'STCONTEXT_' + code });
});

test('unrecognized provider errors expose no echoed request, secrets, cause or stack metadata', () => {
  const error = modelFailure({ code: 'sk-private-secret', message: '{"messages":["private content_filter"]}',
    cause: { credentials: 'private' } });
  assert.equal(error.code, 'STCONTEXT_PROVIDER_ERROR');
  assert.deepEqual(error.details, {});
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(error.message + JSON.stringify(error), /private|content_filter/);
});

test('explicit error codes outrank incidental keywords and preparation failures retain their category', async () => {
  assert.equal(modelFailure({ code: 'context_length_exceeded', message: 'The prompt mentions content_filter' }).code, 'STCONTEXT_CONTEXT_OVERFLOW');
  assert.equal(modelFailure({ code: 'invalid_api_key', message: 'maximum context length' }).code, 'STCONTEXT_AUTH_FAILED');
  assert.equal(modelFailure(undefined, { status: 504 }).code, 'STCONTEXT_REQUEST_TIMEOUT');
  const run = createDshGeneration({ llm: { async prepareCall() { throw Object.assign(new Error('private details'), { code: 'context_length_exceeded' }); } } });
  await assert.rejects(run({ request: { model: { provider: 'fixture', model: 'story' }, messages: [{ role: 'user', content: 'continue' }] } }), {
    code: 'STCONTEXT_CONTEXT_OVERFLOW', stage: 'request',
  });
});

const document = () => { const doc = structuredClone(preset); doc.extensions.regex_scripts = []; return doc; };
const output = (doc, response, extra = {}) => ({ document: doc, response, toolNames: ['story'], ...extra });

test('empty tool formatting, output scripts and regexes report their own stage across the worker', async () => {
  const toolDoc = document();
  toolDoc.extensions.SPreset = { OutputPreprocessing: { consumeToolCalls: true,
    toolCallFormatter: { enabled: true, script: '({calls}) => calls[0].arguments.body || ""' } } };
  const scriptDoc = document();
  scriptDoc.extensions.SPreset = { OutputPreprocessing: { enabled: true, script: '() => ({output:""})' } };
  const regexDoc = document();
  regexDoc.extensions.regex_scripts = [{ placement: [2], findRegex: '/[\\s\\S]+/g', replaceString: '' }];
  const cases = [
    [output(toolDoc, { toolCalls: [{ name: 'story', arguments: {} }] }), 'tool-formatter', /工具正文格式化后正文为空/],
    [output(scriptDoc, { text: '正文' }), 'output-script', /输出脚本处理后正文为空/],
    [output(regexDoc, { text: '正文' }), 'output-regex', /正则处理后正文为空/],
    [output(document(), { text: '' }), 'response', /模型未返回有效正文/],
  ];
  for (const [payload, stage, pattern] of cases) {
    const check = error => { assert.equal(error.code, 'STCONTEXT_OUTPUT_EMPTY'); assert.equal(error.stage, stage);
      assert.match(error.message, pattern); if (stage !== 'output-regex') assert.doesNotMatch(error.message, /正则/); return true; };
    assert.throws(() => processOutput(payload), check);
    await assert.rejects(runCompiler('output', payload), check);
  }
  // A later script may intentionally create text from an empty intermediate.
  toolDoc.extensions.SPreset.OutputPreprocessing.enabled = true;
  toolDoc.extensions.SPreset.OutputPreprocessing.script = '() => ({output:"补全正文"})';
  assert.equal(processOutput(output(toolDoc, { toolCalls: [{ name: 'story', arguments: {} }] })).text, '补全正文');
  toolDoc.extensions.SPreset.OutputPreprocessing.script = '({buffer}) => ({output:buffer})';
  assert.throws(() => processOutput(output(toolDoc, { toolCalls: [{ name: 'story', arguments: {} }] })), { stage: 'tool-formatter' });
});

test('helper output loss is attributed before unrelated formatter and regex stages', async () => {
  const doc = document();
  doc.extensions.tavern_helper = { scripts: [{ enabled: true, name: 'empty response', content: `
    const original = fetch;
    fetch = async (...args) => {
      const response = await original(...args), body = await response.json();
      body.choices[0].message.content = '';
      return new Response(JSON.stringify(body));
    };
  ` }] };
  const compiled = compilePreset(doc, compilerMaterials(materials), { model: { provider: 'fixture', model: 'story' } });
  await assert.rejects(runCompiler('output', output(doc, { text: '正文' }, { helperState: compiled.helperState })), {
    code: 'STCONTEXT_OUTPUT_EMPTY', stage: 'helper-output', message: '助手输出处理后正文为空，未替换宿主正文',
  });
});

test('script exceptions keep stage diagnostics through worker serialization', async () => {
  const doc = document();
  doc.extensions.SPreset = { OutputPreprocessing: { enabled: true, script: '() => { throw Error("output fixture"); }' } };
  await assert.rejects(runCompiler('output', output(doc, { text: '正文' })), error => {
    assert.equal(error.code, 'STCONTEXT_OUTPUT_PROCESSING'); assert.equal(error.stage, 'output-script');
    assert.match(error.message, /预设输出脚本处理失败/); assert.match(error.message, /output fixture/); return true;
  });
});
