import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMaterialsPreserved } from '../lib/request.mjs';
import { compilePreset } from '../lib/preset.mjs';
import { compilerMaterials } from '../lib/materials.mjs';
import { materials, preset } from './fixtures/materials.mjs';

const captured = texts => texts.map(content => ({ content, source: 'history' }));
const request = (texts, descriptions = []) => ({ messages: texts.map(content => ({ role: 'user', content })),
  tools: descriptions.map(description => ({ description })) });

test('a quoted short reply cannot replace its separate historical message', () => {
  const host = structuredClone(materials), document = structuredClone(preset);
  host.history = [{ role: 'user', text: '好的' }, { role: 'assistant', text: '他说：“好的。”' }];
  document.extensions.SPreset = { FinalRequestProcessing: { enabled: true,
    script: '({ request }) => ({ ...request, messages: request.messages.filter(message => message.content !== "好的") })' } };
  assert.throws(() => compilePreset(document, compilerMaterials(host)), /完整历史保护/);
  document.extensions.SPreset.FinalRequestProcessing.script = '({ request }) => request';
  assert.doesNotThrow(() => compilePreset(document, compilerMaterials(host)));
});

test('overlapping substrings and repeated materials require separate output intervals', () => {
  for (const [source, sent] of [
    [['好的', '他说：“好的。”'], ['他说：“好的。”']],
    [['abc', 'bcd'], ['abcd']],
    [['aa', 'aa'], ['aaa']],
    [['重复', '重复', '这里有重复'], ['重复', '这里有重复']],
  ]) assert.throws(() => assertMaterialsPreserved(captured(source), request(sent)), /完整历史保护/);
});

test('complete materials can be reordered, merged or moved between messages and tools', () => {
  const source = captured(['好的', '他说：“好的。”', '重复', '重复']);
  for (const sent of [
    request(['好的\n他说：“好的。”\n重复\n重复']),
    request(['重复', '他说：“好的。”'], ['好的\n重复']),
    request([], ['重复\n重复\n他说：“好的。”\n好的']),
  ]) assert.doesNotThrow(() => assertMaterialsPreserved(source, sent));
  assert.throws(() => assertMaterialsPreserved(captured(['完整材料']), request(['完整'], ['材料'])), /完整历史保护/);
});

test('ambiguous matches backtrack instead of rejecting an intact reordered request', () => {
  // The first abc overlaps the only cde. Reserve the second abc and then cde.
  assert.doesNotThrow(() => assertMaterialsPreserved(captured(['abc', 'cde']), request(['abcde/abc'])));
  // Equal materials use distinct positions, including when a longer one shares
  // their text, and do not need to explore duplicate permutations.
  assert.doesNotThrow(() => assertMaterialsPreserved(captured(['aa', 'aa', 'aab']), request(['aab/aaaa'])));
});

test('large unchanged histories use the ordered path and wrappers preserve raw input', () => {
  const source = captured(Array.from({ length: 20000 }, (_, index) => index % 2 ? '好的' : '他说：“好的。”'));
  assert.doesNotThrow(() => assertMaterialsPreserved(source, request([source.map(message => message.content).join('\n')])));
  assert.doesNotThrow(() => assertMaterialsPreserved([{ source: 'input', rawContent: '输入', content: '<input>输入</input>' }], request(['输入'])));
});

test('pathological overlap reports an explicit verification limit instead of accepting it', () => {
  const source = captured([...Array(14).fill('aa'), ...Array(14).fill('a')]);
  assert.throws(() => assertMaterialsPreserved(source, request(['a'.repeat(40) + 'x'.repeat(8)])), /校验预算.*完整历史保护/);
});
