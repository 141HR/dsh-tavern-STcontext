import test from 'node:test';
import assert from 'node:assert/strict';
import { compilerMaterials } from '../lib/materials.mjs';
import { materials } from './fixtures/materials.mjs';

test('adapter preserves complete history and generation state without mutating host snapshots', () => {
  const input = structuredClone(materials), output = compilerMaterials(input);
  assert.deepEqual(output.history, input.history);
  assert.deepEqual(output.beforeState, { variables: { hp: 10 }, messageVariables: { inputCount: 2 }, posture: materials.state.status });
  output.history[0].text = 'changed'; output.beforeState.variables.hp = 0;
  assert.deepEqual(input, materials);
});

test('empty valid context/input work, while incompatible or malformed DTOs fail explicitly', () => {
  assert.equal(compilerMaterials({ ...materials, context: [], input: { raw: '', text: '' } }).input.projected, '');
  for (const patch of [{ schemaVersion: 2 }, { reason: 'unknown' }, { input: { projected: 'legacy' } },
    { context: [{ kind: 'new-unknown-kind', text: 'must not be dropped' }] }, { context: [null] },
    { history: null }, { state: null }, { identities: {} }]) {
    assert.throws(() => compilerMaterials({ ...materials, ...patch }), /材料格式不受支持/);
  }
});
