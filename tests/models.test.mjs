import test from 'node:test';
import assert from 'node:assert/strict';
import { listGenerationModels } from '../lib/models.mjs';

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
