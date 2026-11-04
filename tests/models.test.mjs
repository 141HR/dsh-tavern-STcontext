import test from 'node:test';
import assert from 'node:assert/strict';
import { listGenerationModels, readGenerationModelReasoning } from '../lib/models.mjs';

test('catalog includes configured text models and advertised efforts without connection settings', async () => {
  const reads = [];
  const result = await listGenerationModels({
    listProviders: () => [{ id: 'a', name: 'Provider A', apiKey: 'secret' }, { id: 'b' }],
    async listModels(provider) {
      reads.push(provider);
      return [{ id: 'story', name: 'Story', inputModalities: ['text', 'image'], endpoint: 'secret',
        reasoning: { efforts: [{ id: 'high', name: 'High', extra: 'secret' }] } },
      { id: 'image-only', inputModalities: ['image'] }, { id: 'legacy-text' }];
    },
  });
  assert.deepEqual(reads, ['a', 'b']);
  assert.deepEqual(result.groups[0], { provider: 'a', providerName: 'Provider A', models: [
    { id: 'story', name: 'Story', efforts: [{ id: 'high', name: 'High' }] },
    { id: 'legacy-text', name: 'legacy-text', efforts: [] },
  ] });
  assert.equal(result.groups[1].providerName, 'b');
  assert.doesNotMatch(JSON.stringify(result), /secret|image-only/);
});

test('one provider failure leaves other model choices available and reports a safe error', async () => {
  const result = await listGenerationModels({ listProviders: () => [{ id: 'broken' }, { id: 'working' }],
    async listModels(provider) {
      if (provider === 'broken') throw new Error('Authorization: secret');
      return [{ id: 'story' }];
    } });
  assert.match(result.groups[0].error, /读取失败/);
  assert.equal(result.groups[1].models[0].id, 'story');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('selected model reasoning uses resolved capabilities rather than the summary catalog', async () => {
  const reads = [];
  const result = await readGenerationModelReasoning({
    listModels() { assert.fail('must resolve the selected model rather than rely on list summaries'); },
    async resolveModelInfo(provider, model) {
      reads.push({ provider, model });
      return { id: model, endpoint: 'secret', reasoning: { efforts: [
        { id: 'off', name: '关闭', extra: 'secret' }, { id: 'high' },
      ] } };
    },
  }, { provider: 'own', model: 'story' });
  assert.deepEqual(reads, [{ provider: 'own', model: 'story' }]);
  assert.deepEqual(result, { efforts: [{ id: 'off', name: '关闭' }, { id: 'high', name: 'high' }] });
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('models without reasoning levels return no selectable overrides', async () => {
  for (const reasoning of [undefined, null, {}, { efforts: [] }]) {
    assert.deepEqual(await readGenerationModelReasoning({
      resolveModelInfo: async () => ({ id: 'story', reasoning }),
    }, { provider: 'own', model: 'story' }), { efforts: [] });
  }
});

test('older hosts can use advertised list capabilities but errors are not reported as no support', async () => {
  const selection = { provider: 'own', model: 'story' };
  assert.deepEqual(await readGenerationModelReasoning({
    listModels: async provider => {
      assert.equal(provider, 'own');
      return [{ id: 'another' }, { id: 'story', reasoning: { efforts: [{ id: 'low' }] } }];
    },
  }, selection), { efforts: [{ id: 'low', name: 'low' }] });
  for (const llm of [
    { resolveModelInfo: async () => { throw new Error('Authorization: secret'); } },
    { resolveModelInfo: async () => undefined },
    { listModels: async () => [] },
  ]) {
    await assert.rejects(readGenerationModelReasoning(llm, selection), error => {
      assert.match(error.message, /推理等级读取失败/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
});
