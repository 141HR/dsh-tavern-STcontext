import test from 'node:test';
import assert from 'node:assert/strict';
import { executeScript } from '../lib/sandbox.mjs';
import { inspectScript } from '../lib/script-syntax.mjs';

test('guest only sees JSON and standard JS; constructors cannot escape into Node', () => {
  const result = executeScript(`input => ({ input, globals: [typeof process, typeof require, typeof fetch, typeof window, typeof document, typeof Deno, typeof setTimeout],
    constructorProbe: ({}).constructor.constructor('return typeof process')() })`, { safe: 'data' });
  assert.deepEqual(result.input, { safe: 'data' });
  assert.deepEqual(result.globals, Array(7).fill('undefined'));
  assert.equal(result.constructorProbe, 'undefined');
  assert.throws(() => executeScript("() => globalThis['fe' + 'tch']('https://example.invalid')", null), /not a function|undefined/);
  assert.throws(() => executeScript("async () => import('node:fs')", null), /load|module|模块/);
});

test('each hook is isolated from the host and previous hooks, including prototype mutation', () => {
  const input = { value: 1 };
  assert.equal(executeScript('x => { x.value=2; globalThis.saved=42; Object.prototype.mark=9; return x.value; }', input), 2);
  assert.equal(input.value, 1);
  assert.equal(Object.prototype.mark, undefined);
  assert.deepEqual(executeScript('() => [typeof saved, typeof ({}).mark]', null), ['undefined', 'undefined']);
});

test('pure async jobs work; pending promises, CPU loops, memory exhaustion and oversized results fail', () => {
  assert.equal(executeScript('async x => (await Promise.resolve(x)) + 1', 2), 3);
  assert.throws(() => executeScript('() => new Promise(() => {})', null), /未完成|超时/);
  assert.throws(() => executeScript('() => { while (true) {} }', null, { timeout: 30 }), /超时/);
  assert.throws(() => executeScript('() => new Array(16000000).fill("many")', null), /memory|内存|超时/i);
  assert.throws(() => executeScript('() => "x".repeat(9000000)', null), /限制|memory|内存/i);
  assert.equal(executeScript('() => "still healthy"', null), 'still healthy');
});

test('import syntax inspection never invokes a function or initializer', () => {
  assert.equal(inspectScript('() => { throw new Error("only at generation"); }').error, undefined);
  assert.ok(inspectScript('(() => { throw new Error("initializer"); })()').error);
  assert.ok(inspectScript('x => {').error);
  assert.deepEqual(inspectScript('x => fetch(x)').capabilities, ['fetch']);
});
