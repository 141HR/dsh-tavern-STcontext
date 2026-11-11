import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

// Real-browser rendering of the M2 suggestion dock and M3b thinking panel using
// the actual client.js. The host seams (registerComposerSlot / registerTextMarker)
// are captured and driven directly; dock/read is served like the host handler.
test('dock chips and thinking panel render in a real browser', {
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
  const page = await browser.newPage({ viewport: { width: 720, height: 640 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<style>html,body{margin:0;font:14px sans-serif}body{padding:16px}h3{margin:12px 0 6px}</style>'
      + '<h3>建议停靠区（M2）</h3><div id="dock"></div><h3>思维链面板（M3b）</h3><div id="think"></div>');
    await page.addScriptTag({ content: react + '\nwindow.__ModuleLoader__ = { load: value => { window.plugin = value.factory(name => modules[name]); } };' });
    await page.addScriptTag({ content: source });
    const registered = await page.evaluate(() => {
      let slot = null, marker = null; window.submitted = [];
      plugin.apply({
        effect: run => run(),
        slots: { inject: (_n, run) => run(), register: () => {} },
        tavernUi: {
          registerPanel: () => {}, registerComposerAction: () => {}, openOverlay: () => {},
          registerComposerSlot: entry => { slot = entry; },
          registerTextMarker: entry => { marker = entry; },
          watchTurnState: (_gameId, listener) => { listener({}); return () => {}; },
          submitInput: async ({ text }) => { window.submitted.push(text); },
          async callHost(name) { if (name.endsWith('dock/read')) return ['去图书馆', '选项A']; return null; },
        },
      });
      const { createElement: h } = modules.react;
      const client = modules['react-dom/client'];
      if (slot) client.createRoot(document.getElementById('dock')).render(slot.render({ sessionId: 'game' }));
      // Drive the marker with a real CoT match, exactly as the host would.
      let thinkRendered = false;
      if (marker) {
        const sample = '<konatan_planning~>这是思维链内容，分析剧情走向。</konatan_planning~>';
        const m = [...sample.matchAll(marker.pattern)];
        if (m.length) { client.createRoot(document.getElementById('think')).render(marker.render({ match: m[0][0], groups: m[0].slice(1), gameId: 'game', turn: 2, streaming: false })); thinkRendered = true; }
      }
      return { hasSlot: !!slot, hasMarker: !!marker, modes: slot?.modes, thinkRendered };
    });
    assert.equal(registered.hasSlot, true, 'composer slot registered');
    assert.deepEqual(registered.modes, ['play']);
    assert.equal(registered.hasMarker, true, 'text marker registered');
    assert.equal(registered.thinkRendered, true, 'marker matched a CoT block');
    await page.getByRole('button', { name: '去图书馆' }).waitFor();
    assert.equal(await page.locator('#dock .stc-dock-chip').count(), 2);
    await page.getByRole('button', { name: '去图书馆' }).click();
    assert.deepEqual(await page.evaluate(() => window.submitted), ['去图书馆']);
    await page.locator('#think .stc-think').waitFor();
    await page.locator('#think .stc-think-summary').click();
    assert.ok((await page.locator('#think .stc-think-body').textContent()).includes('这是思维链内容'));
    if (process.env.STCONTEXT_SCREENSHOT_DIR) {
      await mkdir(process.env.STCONTEXT_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.STCONTEXT_SCREENSHOT_DIR, 'dock-thinking.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
