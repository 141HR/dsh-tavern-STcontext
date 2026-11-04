import { createPresetStore } from './lib/store.mjs';
import { inspectPreset } from './lib/preset.mjs';
import { runCompiler } from './lib/worker-client.mjs';
import { createDshGeneration, selectGenerationModel } from './lib/generation.mjs';
import { listGenerationModels, readGenerationModelReasoning } from './lib/models.mjs';

export const name = 'dsh-tavern-STcontext';
// DSH Cordis expects service names, not the legacy required/optional shape.
export const inject = ['tavern', 'llm'];
const PREFIX = 'dsh-tavern-stcontext';
const PROVIDER = 'st-context';
export function apply(ctx) {
  const generateBody = createDshGeneration({ llm: ctx.llm, meter: ctx.get('tokenMeter') });
  const store = createPresetStore(ctx.tavern), previews = new Map();
  const capable = () => typeof ctx.tavern.bodyRegenerator === 'function' && typeof ctx.tavern.startBodyRegeneration === 'function';
  function requireHost() { if (!capable()) throw new Error('当前宿主缺少插件重生成接口，请先更新 DSH Tavern'); }
  const handle = (key, callback) => ctx.tavern.handle(PREFIX + '/' + key, callback);
  handle('config', async () => ({ ...(await store.list()), hostReady: capable(), generationReady: typeof ctx.tavern.bodyGenerator === 'function' }));
  handle('models', () => listGenerationModels(ctx.llm));
  handle('model-reasoning', input => readGenerationModelReasoning(ctx.llm, input));
  handle('upload/begin', input => store.begin(input));
  handle('upload/chunk', input => store.chunk(input));
  handle('upload/finish', input => store.finish(input));
  handle('select', input => store.select(input));
  handle('remove', input => store.remove(input));
  handle('export', input => store.export(input));
  handle('settings', input => store.settings(input));
  handle('start', async input => {
    requireHost();
    const active = await store.active(), report = inspectPreset(active.document, active.settings);
    if (report.blockers.length) throw new Error(report.blockers.join('；'));
    selectGenerationModel(active.settings.model);
    return ctx.tavern.startBodyRegeneration({ gameId: input.gameId, name: PROVIDER, ...(input.turn ? { turn: input.turn } : {}) });
  });
  handle('status', async input => {
    requireHost();
    return ctx.tavern.bodyRegenerationStatus({ gameId: input.gameId, ...(input.id ? { id: input.id } : {}) });
  });
  handle('cancel', async input => {
    requireHost();
    return ctx.tavern.cancelBodyRegeneration({ gameId: input.gameId, ...(input.id ? { id: input.id } : {}) });
  });
  handle('request', async ({ gameId, offset = 0 }) => {
    const item = previews.get(gameId);
    if (!item) return null;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > item.json.length) throw new Error('请求预览位置无效');
    return { createdAt: item.createdAt, report: item.report, total: item.json.length, offset, text: item.json.slice(offset, offset + 60000) };
  });
  if (typeof ctx.tavern.onGameRemoved === 'function') ctx.tavern.onGameRemoved(({ gameId }) => previews.delete(gameId));
  async function generate({ materials, signal }) {
    const active = await store.active();
    signal?.throwIfAborted();
    selectGenerationModel(active.settings.model);
    const compiled = await runCompiler('compile', { document: active.document, materials, settings: active.settings }, { signal });
    const report = { ...compiled.report, preset: active.name, presetDigest: compiled.presetDigest, historyMessages: compiled.historyMessages };
    const json = JSON.stringify({ report, logicalMessages: compiled.logicalMessages, request: compiled.request }, null, 2);
    previews.delete(materials.gameId);
    previews.set(materials.gameId, { json, report, createdAt: Date.now() });
    while (previews.size > 3) previews.delete(previews.keys().next().value);
    const response = await generateBody({ request: compiled.request, signal });
    signal?.throwIfAborted();
    const result = await runCompiler('output', { document: active.document, response, toolName: compiled.toolName }, { signal });
    return { ...result, metadata: { ...result.metadata, preset: active.name, protocol: report.protocol } };
  }
  if (capable()) ctx.tavern.bodyRegenerator({ name: PROVIDER, title: 'STcontext 重生成', generate });
  if (typeof ctx.tavern.bodyGenerator === 'function') {
    ctx.tavern.bodyGenerator({ name: PROVIDER, title: 'STcontext', generate });
  }
}
