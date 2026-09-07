/* eslint-env node */
const assert = require('assert');
const fc = require('fast-check');
const { createCatalogSnapshot } = require('../../catalog/model-catalog');
const { inspectGGUFBuffer } = require('../../catalog/gguf-inspector');
const { gguf, entry, rawEntry, rawString } = require('../fixtures/gguf');

const nonEmptyText = fc.string({ minLength: 1, maxLength: 18 })
  .filter((value) => value.trim().length > 0);
const source = fc.constantFrom('local', 'curated', 'router', 'discovery');
const recognizedKey = fc.constantFrom(
  'general.architecture',
  'general.name',
  'llama.context_length',
  'tokenizer.ggml.add_bos_token'
);
const metadataCase = fc.oneof(
  recognizedKey.map((key) => ({ kind: 'absent', key })),
  recognizedKey.map((key) => ({ kind: 'malformed-type', key })),
  recognizedKey.map((key) => ({ kind: 'malformed-length', key })),
  recognizedKey.map((key) => ({ kind: 'malformed-encoding', key })),
  fc.record({ kind: fc.constant('known'), value: nonEmptyText })
);

function metadataBuffer(testCase) {
  if (testCase.kind === 'known') return gguf([entry('general.architecture', 8, testCase.value)]);
  if (testCase.kind === 'absent') return gguf([entry('custom.generated', 8, testCase.key)]);
  if (testCase.kind === 'malformed-type') {
    const type = ['general.architecture', 'general.name'].includes(testCase.key) ? 4 : 8;
    return gguf([entry(testCase.key, type, type === 4 ? 7 : 'wrong-type')]);
  }
  if (testCase.kind === 'malformed-length') {
    return gguf([rawEntry(Buffer.from(testCase.key), 8, rawString(Buffer.from('short'), 99))]);
  }
  return gguf([rawEntry(Buffer.from(testCase.key), 8, rawString(Buffer.from([0xc3, 0x28])))]);
}

function modelRecord(overrides = {}) {
  return {
    id: 'generated-model',
    displayName: 'Generated Model',
    providerId: 'local',
    providerGroupId: 'Local',
    source: 'local',
    format: 'gguf',
    reference: 'models/generated.gguf',
    digest: { algorithm: 'sha256', value: 'generated-digest', verified: true },
    verification: 'verified',
    availability: 'available',
    capabilities: ['chat'],
    ...overrides
  };
}

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 6: GGUF and catalog failure tolerance
// **Validates: Requirements 4.2, 4.5, 18.3**
function test(name, property) {
  try {
    property();
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}\\n    ${error.message}`);
    process.exitCode = 1;
  }
}

test('retains a model record and assigns explicit status for generated metadata outcomes', () => {
  fc.assert(
    fc.property(metadataCase, (testCase) => {
      const inspected = inspectGGUFBuffer(metadataBuffer(testCase));
      const record = modelRecord({
        metadata: inspected.metadata,
        metadataStatus: inspected.metadataStatus
      });
      const snapshot = createCatalogSnapshot({ local: [record] }, undefined, { now: 100 });

      assert.strictEqual(snapshot.records.length, 1);
      assert.strictEqual(snapshot.records[0].id, record.id);
      assert.strictEqual(snapshot.records[0].modelLoadAttempted, undefined);
      for (const key of [
        'general.architecture',
        'general.name',
        'llama.context_length',
        'tokenizer.ggml.add_bos_token'
      ]) {
        assert.ok(['known', 'unknown', 'malformed'].includes(inspected.metadataStatus[key]));
        assert.strictEqual(snapshot.records[0].metadataStatus[key], inspected.metadataStatus[key]);
      }
      if (testCase.kind === 'absent') assert.strictEqual(inspected.metadataStatus[testCase.key], 'unknown');
      if (testCase.kind.startsWith('malformed')) {
        assert.strictEqual(inspected.valid, false);
        assert.strictEqual(inspected.metadataStatus[testCase.key], 'malformed');
      }
    }),
    { numRuns: 100 }
  );
});

test('retains previously verified records as stale when generated sources fail', () => {
  fc.assert(
    fc.property(source, nonEmptyText, nonEmptyText, (failedSource, code, message) => {
      const previous = createCatalogSnapshot({
        [failedSource]: [modelRecord({ source: failedSource })]
      }, undefined, { now: 100 });
      const snapshot = createCatalogSnapshot({
        [failedSource]: { error: { code, message, retryable: true } }
      }, previous, { now: 200 });

      assert.strictEqual(snapshot.records.length, 1);
      assert.strictEqual(snapshot.records[0].availability, 'stale');
      assert.strictEqual(snapshot.records[0].digest.value, 'generated-digest');
      assert.deepStrictEqual(snapshot.sourceFailures, [{
        source: failedSource,
        code,
        message,
        retryable: true,
        at: 200
      }]);
    }),
    { numRuns: 100 }
  );
});
