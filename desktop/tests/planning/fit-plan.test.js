/* eslint-env node */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const { evaluateFitPlan } = require('../../planning/fit-plan');

const gib = 1024 ** 3;

function createModel(overrides = {}) {
  return {
    id: 'model-7b',
    displayName: 'Example 7B',
    sizeBytes: 2 * gib,
    contextLimit: 4096,
    metadata: {
      block_count: 32,
      n_head: 32,
      embedding_length: 4096
    },
    ...overrides
  };
}

function createHardware(overrides = {}) {
  return {
    usableMemoryBytes: 16 * gib,
    accelerator: { memoryBytes: 8 * gib },
    backendCapabilities: { cuda: true },
    ...overrides
  };
}

describe('fit-plan examples', () => {
  it('plans a known model and hardware combination as fitting with GPU allocation', () => {
    const plan = evaluateFitPlan(createModel(), createHardware());

    assert.strictEqual(plan.status, 'fits');
    assert.strictEqual(plan.modelId, 'model-7b');
    assert.strictEqual(plan.allocation.contextTokens, 4096);
    assert.ok(plan.estimated.weightsBytes === 2 * gib);
    assert.ok(plan.estimated.kvCacheBytes > 0);
    assert.ok(plan.allocation.acceleratorBytes > 0);
    assert.ok(plan.allocation.gpuOffloadLayers > 0);
    assert.match(plan.explanation, /fits/i);
  });

  it('returns unknown when required memory or model architecture data is missing', () => {
    const noMemory = evaluateFitPlan(createModel(), {
      backendCapabilities: { cpu: true }
    });
    const noArchitecture = evaluateFitPlan(createModel({ metadata: {} }), createHardware());

    assert.strictEqual(noMemory.status, 'unknown');
    assert.ok(noMemory.assumptions.some((assumption) => /memory is unavailable/i.test(assumption)));
    assert.strictEqual(noArchitecture.status, 'unknown');
    assert.ok(noArchitecture.assumptions.some((assumption) => /KV-cache architecture metadata is incomplete/i.test(assumption)));
    assert.match(noArchitecture.explanation, /not enough verified/i);
  });

  it('does not claim a fit at a conservative memory boundary', () => {
    const plan = evaluateFitPlan(createModel(), createHardware({
      usableMemoryBytes: 2 * gib,
      accelerator: undefined,
      backendCapabilities: { cpu: true }
    }));

    assert.strictEqual(plan.status, 'does-not-fit');
    assert.strictEqual(plan.allocation.gpuOffloadLayers, 0);
    assert.ok(plan.estimated.totalBytes > 2 * gib * 0.8);
    assert.strictEqual(plan.allocation.contextTokens, undefined);
    assert.ok(plan.assumptions.some((assumption) => /conservative 15% model-size margin/i.test(assumption)));
    assert.match(plan.explanation, /exceeds/i);
  });

  it('returns available alternatives in deterministic size and id order', () => {
    const plan = evaluateFitPlan(createModel(), createHardware({ usableMemoryBytes: 4 * gib }), {
      alternatives: [
        { id: 'large', sizeBytes: 20 * gib, availability: 'available' },
        { id: 'small-b', sizeBytes: 512 * 1024 ** 2, availability: 'available' },
        { id: 'small-a', sizeBytes: 256 * 1024 ** 2, availability: 'available' },
        { id: 'unknown-size', availability: 'available' },
        { id: 'model-7b', sizeBytes: 1 * gib, availability: 'available' }
      ]
    });

    assert.deepStrictEqual(plan.alternatives, ['small-a', 'small-b', 'unknown-size']);
  });

  it('repeats deterministically without mutating model or hardware inputs', () => {
    const model = createModel();
    const hardware = createHardware();
    const modelBefore = structuredClone(model);
    const hardwareBefore = structuredClone(hardware);

    const first = evaluateFitPlan(model, hardware);
    const second = evaluateFitPlan(model, hardware);

    assert.deepStrictEqual(second, first);
    assert.deepStrictEqual(model, modelBefore);
    assert.deepStrictEqual(hardware, hardwareBefore);
  });
});
