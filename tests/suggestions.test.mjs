import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSuggestions } from '../lib/suggestions.mjs';

test('extractSuggestions returns empty list for empty or non-string input', () => {
  assert.deepEqual(extractSuggestions(''), []);
  assert.deepEqual(extractSuggestions(null), []);
  assert.deepEqual(extractSuggestions(undefined), []);
  assert.deepEqual(extractSuggestions(123), []);
  assert.deepEqual(extractSuggestions('这是一段普通的剧情文本，没有包含任何建议或可选项。'), []);
});

test('extractSuggestions strips thinking blocks before extraction', () => {
  const text = `
<think>
模型在思考中提到了 <advice>思考内部的建议不要被提取</advice>
</think>
正文内容...
<advice>正式输出的剧情建议</advice>
`;
  const result = extractSuggestions(text);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, '正式输出的剧情建议');
});

test('extractSuggestions extracts single-line <advice> with role prefix stripped', () => {
  const text = '“你醒了？”少女轻声问。<advice>Master：询问少女的名字与身处的地点</advice>';
  const result = extractSuggestions(text);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, '询问少女的名字与身处的地点');
  assert.equal(result[0].text, '询问少女的名字与身处的地点');
});

test('extractSuggestions parses multi-line numbered options into discrete choices', () => {
  const text = `
故事正文内容...
<options>
1. 拔剑迎战面前的黑影
2. 转身迅速逃离现场
3. 试图用交涉安抚对方
</options>
`;
  const result = extractSuggestions(text);
  assert.equal(result.length, 3);
  assert.equal(result[0].label, '1. 拔剑迎战面前的黑影');
  assert.equal(result[0].text, '拔剑迎战面前的黑影');
  assert.equal(result[1].label, '2. 转身迅速逃离现场');
  assert.equal(result[1].text, '转身迅速逃离现场');
  assert.equal(result[2].label, '3. 试图用交涉安抚对方');
  assert.equal(result[2].text, '试图用交涉安抚对方');
});

test('extractSuggestions parses inline numbered options', () => {
  const text = '【行动建议：1、握住她的手 2、假装没有看到 3、退后一步】';
  const result = extractSuggestions(text);
  assert.equal(result.length, 3);
  assert.equal(result[0].label, '1、握住她的手');
  assert.equal(result[0].text, '握住她的手');
  assert.equal(result[1].label, '2、假装没有看到');
  assert.equal(result[1].text, '假装没有看到');
  assert.equal(result[2].label, '3、退后一步');
  assert.equal(result[2].text, '退后一步');
});

test('extractSuggestions supports various tag names generically', () => {
  const sampleTags = [
    '<suggest>探索密室</suggest>',
    '<actions>观察周围环境</actions>',
    '<choices>选择红色药水</choices>',
    '<plot_branches>调查图书馆地下室</plot_branches>',
  ];
  for (const snippet of sampleTags) {
    const res = extractSuggestions(snippet);
    assert.equal(res.length, 1);
    assert.ok(res[0].text.length > 0);
  }
});

test('extractSuggestions deduplicates identical choices and enforces bounds', () => {
  const text = `
<advice>
1. 探索
2. 探索
3. 探索
4. 离开
</advice>
`;
  const result = extractSuggestions(text);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, '探索');
  assert.equal(result[1].text, '离开');
});

test('extractSuggestions handles bracketed Chinese suggestions', () => {
  const text = '故事继续发展。【建议：检查左侧的箱子】';
  const result = extractSuggestions(text);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, '检查左侧的箱子');
});
