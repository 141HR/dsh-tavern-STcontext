import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../index.mjs';

// Exercise dependency resolution and the installed guard, not a direct apply()
// call: a blocked Cordis fiber never registers even the preset upload handlers.
const enabled = process.env.DSH_BOOT_MODULE && process.env.STCONTEXT_HOST_REPO;
for (const withMeter of [false, true]) {
  test(`DSH guard loads STcontext and imports presets (tokenMeter: ${withMeter})`, { skip: !enabled }, async t => {
    const host = file => import(pathToFileURL(resolve(process.env.STCONTEXT_HOST_REPO, file)).href);
    const [{ Context }, { guardSource }, { createTavernPluginApi }] = await Promise.all([
      import(new URL('../../cordis/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE))),
      host('tavern-plugin/lib/domain/user-plugins.js'),
      host('tavern-plugin/lib/plugin-api.js'),
    ]);
    const dir = await mkdtemp(join(tmpdir(), 'stcontext-loading-'));
    assert.equal(dirname(dir), resolve(tmpdir()));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const ctx = new Context(), data = new Map();
    t.after(() => ctx.fiber.dispose());
    const api = createTavernPluginApi({ ctx, pluginData: {
      read: async owner => structuredClone(data.get(owner)),
      save: async (owner, value) => { data.set(owner, structuredClone(value)); },
    } });
    ctx.provide('tavern', api.service);
    ctx.provide('llm', { prepareCall() { assert.fail('loading/import must not request a model'); },
      listProviders: () => [{ id: 'configured' }], listModels: async () => [{ id: 'story' }] });
    if (withMeter) ctx.provide('tokenMeter', { estimateMessage: () => 1 });

    const entry = join(dir, '.tavern-entry.mjs');
    await writeFile(entry, guardSource({ folder: plugin.name, name: plugin.name,
      main: new URL('../index.mjs', import.meta.url).href }));
    const guarded = await import(pathToFileURL(entry).href);
    let fiber = ctx.plugin(guarded);
    await fiber.await();
    const call = (name, args) => api.callHandler('dsh-tavern-stcontext/' + name, args);
    const source = JSON.stringify({ prompts: [{ identifier: 'chatHistory', marker: true }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'chatHistory', enabled: true }] }] });
    const { id } = await call('upload/begin', { name: 'fixture.json', size: source.length });
    await call('upload/chunk', { id, index: 0, text: source });
    await call('upload/finish', { id });
    const model = { provider: 'configured', model: 'story' };
    await call('settings', { model });
    assert.equal((await call('models')).groups[0].models[0].id, 'story');
    const config = await call('config');
    assert.equal(config.presets.length, 1);
    assert.equal(config.hostReady, true);
    assert.equal(config.generationReady, true);
    assert.equal((await call('export', { id: config.activeId })).text, source);
    assert.ok(data.has(plugin.name), 'the real Tavern API binds data to the plugin owner');
    assert.equal(JSON.parse(await readFile(join(dir, '.tavern-status.json'), 'utf8')).ok, true);
    assert.deepEqual((await api.bodyGenerators.list()).map(value => value.id), [plugin.name + ':st-context']);

    await fiber.dispose();
    await assert.rejects(call('config'), { code: 'TAVERN_PLUGIN_NOT_FOUND' });
    assert.deepEqual(await api.bodyGenerators.list(), []);
    fiber = ctx.plugin(guarded);
    await fiber.await();
    assert.equal((await call('config')).activeId, config.activeId, 'reloading keeps imported presets');
    assert.deepEqual((await call('config')).settings.model, model, 'reloading keeps the independent model');
    assert.equal((await api.bodyGenerators.list()).length, 1, 'reloading does not duplicate registration');
  });
}
