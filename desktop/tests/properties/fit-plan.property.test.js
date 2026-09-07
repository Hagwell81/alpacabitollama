import assert from 'node:assert';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateFitPlan } = require('../../planning/fit-plan');

const positiveBytes = fc.integer({ min: 1, max: 16 * 1024 * 1024 * 1024 });
const positiveTokens = fc.integer({ min: 1, max: 131072 });
const positiveArchitectureValue = fc.integer({ min: 1, max: 128 });

const model = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  sizeBytes: positiveBytes,
  contextLimit: positiveTokens,
  metadata: fc.record({
    block_count: positiveArchitectureValue,
    n_head: positiveArchitectureValue,
    embedding_length: fc.integer({ min: 1, max: 16384 })
  })
});

const completeHardware = fc.record({
  usableMemoryBytes: fc.integer({ min: 1, max: 64 * 1024 * 1024 * 1024 }),
  accelerator: fc.record({ memoryBytes: positiveBytes }),
  backendCapabilities: fc.record({ cuda: fc.boolean() })
});

const incompleteHardware = fc.oneof(
  fc.constant({}),
  fc.record({ backendCapabilities: fc.record({ cuda: fc.boolean() }) }),
  fc.record({ usableMemoryBytes: positiveBytes })
);

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 7: Deterministic conservative fit planning
// **Validates: Requirements 5.2, 5.3, 5.5**
it('is deterministic, non-mutating, and conservative when fit inputs are incomplete', () => {
  fc.assert(
    fc.property(model, fc.oneof(completeHardware, incompleteHardware), (inputModel, inputHardware) => {
    const modelBefore = JSON.stringify(inputModel);
    const hardwareBefore = JSON.stringify(inputHardware);
    const first = evaluateFitPlan(inputModel, inputHardware);
    const second = evaluateFitPlan(inputModel, inputHardware);

    assert.deepStrictEqual(second, first);
    assert.strictEqual(JSON.stringify(inputModel), modelBefore);
    assert.strictEqual(JSON.stringify(inputHardware), hardwareBefore);
    assert.ok(['fits', 'tight', 'does-not-fit', 'unknown'].includes(first.status));
    assert.strictEqual(first.modelId, inputModel.id);
    assert.ok(Array.isArray(first.assumptions));
    assert.ok(Array.isArray(first.alternatives));

    const hasRequiredFitInputs = Number.isFinite(inputModel.sizeBytes)
      && inputModel.sizeBytes > 0
      && Number.isFinite(inputModel.contextLimit)
      && inputModel.contextLimit > 0
      && Number.isFinite(inputHardware.usableMemoryBytes)
      && inputHardware.usableMemoryBytes > 0
      && inputModel.metadata.block_count > 0
      && inputModel.metadata.n_head > 0
      && inputModel.metadata.embedding_length >= inputModel.metadata.n_head;
    if (!hasRequiredFitInputs) assert.notStrictEqual(first.status, 'fits');
    }),
    { numRuns: 100 }
  );
});
