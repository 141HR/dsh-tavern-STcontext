import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSuggestions } from '../lib/dock.mjs';

test('extracts advice and option chips, strips inner tags and whitespace', () => {
  const text = '<advice>去图书馆</advice>正文<options><option>选项A</option><option> 选项B </option></options>';
  assert.deepEqual(extractSuggestions(text), ['去图书馆', '选项A', '选项B']);
});
test('handles attributes and nested markup', () => {
  const text = '<advice type="x">先<b>休息</b>一下</advice><option data-i="1">喝杯茶</option>';
  assert.deepEqual(extractSuggestions(text), ['先休息一下', '喝杯茶']);
});
test('deduplicates and bounds count and label length', () => {
  const many = Array.from({ length: 20 }, (_, i) => '<advice>建议' + i + '</advice>').join('');
  const out = extractSuggestions(many + '<advice>建议0</advice>');
  assert.equal(out.length, 12);
  const long = extractSuggestions('<advice>' + '字'.repeat(500) + '</advice>');
  assert.equal(long[0].length, 200);
});
test('returns empty for no tags or empty input', () => {
  assert.deepEqual(extractSuggestions('普通正文，没有建议标签'), []);
  assert.deepEqual(extractSuggestions(''), []);
  assert.deepEqual(extractSuggestions(null), []);
  assert.deepEqual(extractSuggestions('<advice>   </advice>'), []);
});
