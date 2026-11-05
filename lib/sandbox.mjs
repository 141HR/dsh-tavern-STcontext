import { createEngine } from './vendor/quickjs.mjs';
import { scriptExpression } from './script-syntax.mjs';

const engine = await createEngine();
const MAX_JSON = 8 * 1024 * 1024;

// Guest JavaScript runs in WASM QuickJS, never in Node's realm. No host function,
// module loader, network, filesystem, timers, DOM, credentials or DSH API is bound.
// A fresh runtime is used for every hook, so globals cannot leak between stages.
export function executeScript(source, input, { kind = 'function', stage = 'script', timeout = 500 } = {}) {
  const { expression } = scriptExpression(source, kind);
  const json = JSON.stringify(input);
  if (json === undefined || Buffer.byteLength(json) > MAX_JSON) throw new Error(stage + '：脚本输入超过 8 MiB 或不是 JSON');
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(48 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + Math.min(Math.max(timeout, 1), 2000);
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const context = runtime.newContext();
  let result;
  try {
    const inputHandle = context.newString(json);
    context.setProp(context.global, '__inputJSON', inputHandle); inputHandle.dispose();
    // Capture serialization before guest code can replace JSON or its methods.
    // The only values crossing this boundary are bounded JSON strings.
    result = context.evalCode(`(() => {
      const stringify = JSON.stringify, parse = JSON.parse;
      const input = parse(globalThis.__inputJSON);
      delete globalThis.__inputJSON;
      globalThis.console = Object.freeze({ log() {}, warn() {}, error() {}, info() {}, debug() {} });
      const serialize = value => {
        const text = stringify(value);
        if (typeof text !== 'string' || text.length > ${MAX_JSON}) throw new Error('脚本结果不是 JSON 或超过限制');
        return text;
      };
      const value = (${expression})(input);
      return value && typeof value.then === 'function' ? value.then(serialize) : serialize(value);
    })()`, 'preset-hook.js');
    if (result.error) throw new Error(context.dump(result.error)?.message || '脚本执行失败');
    // Allow async pure computations, but no timers or indefinitely pending work.
    let state = context.getPromiseState(result.value), jobs = 0;
    while (state.type === 'pending') {
      if (++jobs > 1000 || Date.now() >= deadline || !runtime.hasPendingJob()) throw new Error('脚本异步任务未完成或超时');
      const pending = runtime.executePendingJobs(1);
      if (pending.error) { pending.error.dispose(); throw new Error('脚本异步任务失败'); }
      state = context.getPromiseState(result.value);
    }
    const handle = state.type === 'rejected' ? state.error : state.value;
    try {
      if (state.type === 'rejected') throw new Error(context.dump(handle)?.message || '脚本异步任务失败');
      const output = context.getString(handle);
      if (Buffer.byteLength(output) > MAX_JSON) throw new Error('脚本输出超过 8 MiB');
      return JSON.parse(output);
    } finally { if (handle !== result.value) handle.dispose(); }
  } catch (error) {
    const detail = Date.now() >= deadline ? '脚本执行超时' : String(error?.message || error).slice(0, 350);
    throw new Error(stage + '：' + detail);
  } finally {
    if (result?.error) result.error.dispose();
    if (result?.value) result.value.dispose();
    context.dispose(); runtime.dispose();
  }
}
