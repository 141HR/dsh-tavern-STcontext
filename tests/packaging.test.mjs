import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('distributed runtime hashes match and the copied plugin works without node_modules', async t => {
  const vendor = new URL('../lib/vendor/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', vendor), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.hashes)) assert.equal(createHash('sha256').update(await readFile(new URL(name, vendor))).digest('hex'), expected, name);
  const dir = await mkdtemp(join(tmpdir(), 'stcontext-package-'));
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
  t.after(async () => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    await rm(dir, { recursive: true, force: true });
  });
  for (const name of ['index.mjs', 'package.json', 'lib']) await cp(new URL('../' + name, import.meta.url), join(dir, name), { recursive: true });
  const url = pathToFileURL(join(dir, 'lib/sandbox.mjs')).href;
  const entry = pathToFileURL(join(dir, 'index.mjs')).href;
  const code = `const {executeScript}=await import(${JSON.stringify(url)}); const p=await import(${JSON.stringify(entry)}); if(executeScript('x => x + 1', 1)!==2 || typeof p.apply!=='function') process.exit(1);`;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, timeout: 10000 });
  assert.equal(result.stdout, '');
});
