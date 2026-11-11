import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guards the actual inline registerTextMarker pattern in client.js (M3b): it must
// match thinking-chain tags and capture their inner content, not other tags.
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const found = client.match(/pattern:\s*(\/[^\n]+?\/g),/);
assert.ok(found, 'client.js registerTextMarker pattern exists');
const literal = found[1];
const pattern = new RegExp(literal.slice(1, literal.lastIndexOf('/')), literal.slice(literal.lastIndexOf('/') + 1));

test('thinking marker matches think/thinking/konatan_planning~ and captures content', () => {
  for (const [tag, inner] of [['think', '计划'], ['thinking', '分析'], ['konatan_planning~', '思考内容']]) {
    const m = [...(`<${tag}>${inner}</${tag}>`).matchAll(pattern)];
    assert.equal(m.length, 1, tag);
    assert.equal(m[0][1], tag);
    assert.equal(m[0][2], inner);
  }
});
test('thinking marker handles multiline content and ignores other tags', () => {
  const m = [...'<konatan_planning~>第一行\n第二行</konatan_planning~>'.matchAll(pattern)];
  assert.equal(m[0][2], '第一行\n第二行');
  assert.equal([...'<advice>建议</advice>'.matchAll(pattern)].length, 0);
  assert.equal([...'<options><option>A</option></options>'.matchAll(pattern)].length, 0);
  assert.equal([...'普通正文'.matchAll(pattern)].length, 0);
});
