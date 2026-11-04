import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

// Reuse the host's development dependencies; the distributed plugin stays dependency-free.
test('sidebar, overlay and native settings reach all content in short and narrow windows', {
  skip: !process.env.STCONTEXT_HOST_REPO,
}, async t => {
  const require = createRequire(resolve(process.env.STCONTEXT_HOST_REPO, 'package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.STCONTEXT_BROWSER_EXECUTABLE ? { executablePath: process.env.STCONTEXT_BROWSER_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  let react = 'const modules = {};\n';
  for (const [name, file] of [['react', 'react.production.js'], ['scheduler', 'scheduler.production.js'],
    ['react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom-client.production.js']]) {
    react += `modules[${JSON.stringify(name)}] = (() => { const module = { exports: {} }, exports = module.exports, require = name => modules[name];\n`
      + await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8') + '\nreturn module.exports; })();\n';
  }
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  for (const surface of ['sidebar', 'overlay', 'settings']) {
    for (const viewport of [{ width: 300, height: 420 }, { width: 1000, height: 360 }]) {
      await t.test(`${surface} ${viewport.width}×${viewport.height}`, async () => {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.setContent(`<style>
            html,body{margin:0;height:100%;overflow:hidden;font:14px sans-serif}
            body{display:flex;flex-direction:column}header.fixture{height:56px;flex:none}
            /* Same flex/overflow contract as better-sidebar's paneContent. */
            main{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
            main.settings{display:block;overflow:auto;padding:16px}
            main.overlay{position:fixed;inset:0;overflow:auto}
          </style><header class="fixture">Harness</header><main class="${surface}"></main>`);
          await page.addScriptTag({ content: react + '\nwindow.__ModuleLoader__ = { load: value => { window.plugin = value.factory(name => modules[name]); } };' });
          await page.addScriptTag({ content: source });
          await page.evaluate(surface => {
            const { createElement: h } = modules.react;
            let panel, action, overlay, Settings;
            const config = { hostReady: true, generationReady: true, activeId: 'preset',
              settings: { adapter: 'auto', model: { provider: 'own', model: 'story' } },
              presets: [{ id: 'preset', name: '测试预设', digest: 'a'.repeat(64),
                report: { enabledPrompts: 10, regexCount: 3, order: 100001, protocol: 'chat', blockers: [],
                  warnings: Array.from({ length: 25 }, (_, i) => `兼容提示 ${i + 1}：这是一条用于检查完整内容可达性的说明。`) } }] };
            window.calls = [];
            plugin.apply({
              effect: run => run(),
              slots: { inject: (_name, run) => run(), register: (_spec, render) => { Settings = render; } },
              tavernUi: {
                registerPanel: entry => { panel = entry; }, registerComposerAction: entry => { action = entry; },
                openOverlay: entry => { overlay = entry; },
                async callHost(name, input) {
                  const method = name.split('/').at(-1); window.calls.push({ method, input });
                  if (method === 'config') return config;
                  if (method === 'models') return { groups: [{ provider: 'own', providerName: 'Own', models: [{ id: 'story', name: 'Story' }] }] };
                  if (method === 'model-reasoning') return { efforts: [] };
                  if (method === 'status') return null;
                  if (method === 'settings') { config.settings = input; return config; }
                  if (method === 'request') return { createdAt: 1, report: config.presets[0].report, total: 2, text: '{}' };
                  throw Error('Unexpected call: ' + method);
                },
              },
            });
            action.run({ gameId: 'game' });
            const element = surface === 'settings' ? h(Settings)
              : surface === 'overlay' ? overlay.render({ close() {} }) : panel.render({ gameId: 'game' });
            modules['react-dom/client'].createRoot(document.querySelector('main')).render(element);
          }, surface);
          await page.waitForFunction(() => document.querySelector('.stc-header-status')?.textContent === '配置就绪');
          await page.getByText('兼容报告', { exact: false }).click();
          if (surface !== 'settings') await page.getByRole('button', { name: '查看本次请求' }).click();
          const selector = surface === 'settings' ? 'main' : '.stc-scroll';
          const area = page.locator(selector);
          await area.evaluate(element => { element.scrollTop = 0; });
          await page.mouse.move(viewport.width / 2, 100);
          await page.mouse.wheel(0, 260);
          await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0, selector);
          await area.evaluate(element => { element.scrollTop = element.scrollHeight; });
          const metrics = await area.evaluate(element => {
            const bottom = document.querySelector('.stc-panel').lastElementChild.getBoundingClientRect();
            return { top: element.scrollTop, height: element.clientHeight, scrollHeight: element.scrollHeight,
              width: element.clientWidth, scrollWidth: element.scrollWidth, bottom: bottom.bottom, edge: element.getBoundingClientRect().bottom };
          });
          assert.ok(metrics.top > 0 && metrics.height < metrics.scrollHeight, JSON.stringify(metrics));
          assert.ok(metrics.bottom <= metrics.edge + 1, 'last section must fit inside the visible scroll area');
          assert.ok(metrics.scrollWidth <= metrics.width + 1, 'no horizontal overflow');
          await area.evaluate(element => { element.scrollTop = 0; });
          await page.getByRole('button', { name: '保存设置', exact: true }).click();
          await page.getByText('设置已保存', { exact: true }).waitFor();
          if (surface === 'settings') {
            assert.equal(await page.getByRole('button', { name: '重新生成最新正文' }).count(), 0);
            assert.equal(await page.evaluate(() => calls.some(call => ['status', 'start', 'cancel', 'request'].includes(call.method))), false);
          }
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }
  }
});
