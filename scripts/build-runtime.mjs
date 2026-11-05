import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
await mkdir('lib/vendor', { recursive: true });
await build({ entryPoints: ['scripts/runtime-entry.mjs'], outfile: 'lib/vendor/quickjs.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: true, legalComments: 'eof' });
await build({ stdin: { contents: "export { parse } from 'acorn';", resolveDir: process.cwd() }, outfile: 'lib/vendor/parser.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: true, legalComments: 'eof' });
await copyFile(fileURLToPath(import.meta.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')), 'lib/vendor/quickjs.wasm');
const packages = ['quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync', '@jitl/quickjs-ffi-types', 'acorn'];
const licenses = [];
for (const name of packages) licenses.push(name + '\n\n' + await readFile('node_modules/' + name + '/LICENSE', 'utf8'));
await writeFile('lib/vendor/LICENSES.txt', licenses.join('\n\n----------------\n\n'));
const hashes = {};
for (const name of ['quickjs.mjs', 'quickjs.wasm', 'parser.mjs', 'LICENSES.txt']) hashes[name] = createHash('sha256').update(await readFile('lib/vendor/' + name)).digest('hex');
await writeFile('lib/vendor/manifest.json', JSON.stringify({ quickjs: '0.32.0', acorn: '8.19.0', hashes }, null, 2) + '\n');
console.log('Built vendored runtime and parser; no runtime npm installation required.');
