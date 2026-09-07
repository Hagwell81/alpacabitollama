/* eslint-env node */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const { evaluateFitPlan, estimateKvBytes } = require('../planning/fit-plan');

describe('fit plan evaluator', () => {
  const model = {
    id: 'model-a',
    displayName: 'Model A',
    sizeBytes: 2 * 1024 ** 3,
    contextLimit: 4096,
    metadata: { block_count: 32, n_head: 32, embedding_length: 4096 }
  };
  const hardware = {
    usableMemoryBytes: 16 * 1024 ** 3,
    accelerator: { memoryBytes: 8 * 1024 ** 3 },
    backendCapabilities: { cuda: true }
  };

  it('returns a conservative deterministic plan and does not mutate inputs', () => {
    const modelBefore = JSON.parse(JSON.stringify(model));
    const hardwareBefore = JSON.parse(JSON.stringify(hardware));
    const first = evaluateFitPlan(model, hardware);
    const second = evaluateFitPlan(model, hardware);

    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(model, modelBefore);
    assert.deepStrictEqual(hardware, hardwareBefore);
    assert.strictEqual(first.status, 'fits');
    assert.strictEqual(first.allocation.contextTokens, 4096);
    assert.ok(first.estimated.weightsBytes > 0);
    assert.ok(first.estimated.kvCacheBytes > 0);
    assert.ok(first.allocation.gpuOffloadLayers > 0);
    assert.ok(first.assumptions.some((value) => value.includes('80%')));
  });

  it('marks missing required hardware or KV metadata as unknown', () => {
    const noMemory = evaluateFitPlan(model, { backendCapabilities: { cpu: true } });
    const noKvMetadata = evaluateFitPlan({ ...model, metadata: {} }, hardware);

    assert.strictEqual(noMemory.status, 'unknown');
    assert.strictEqual(noKvMetadata.status, 'unknown');
    assert.ok(noMemory.assumptions.some((value) => value.includes('memory')));
    assert.ok(noKvMetadata.assumptions.some((value) => value.includes('KV-cache')));
  });

  it('uses the configured memory fraction and deterministic available alternatives', () => {
    const result = evaluateFitPlan(model, hardware, {
      safetyFraction: 0.5,
      alternatives: [
        { id: 'large', sizeBytes: 20 * 1024 ** 3, availability: 'available' },
        { id: 'small-b', sizeBytes: 512 * 1024 ** 2, availability: 'available' },
        { id: 'small-a', sizeBytes: 256 * 1024 ** 2, availability: 'available' }
      ]
    });

    assert.strictEqual(result.status, 'fits');
    assert.deepStrictEqual(result.alternatives, ['small-a', 'small-b']);
    assert.ok(result.assumptions.some((value) => value.includes('50%')));
  });

  it('calculates KV cache bytes from model architecture metadata', () => {
    assert.strictEqual(estimateKvBytes(model, 1), 524288);
  });
});
