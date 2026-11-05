import { readFileSync } from 'node:fs';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';

export function createEngine() {
  const bytes = readFileSync(new URL('./quickjs.wasm', import.meta.url));
  return newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmBinary: bytes }));
}
