/* eslint-env node */
const assert = require('assert');
const { inspectGGUF, inspectGGUFBuffer } = require('../../catalog/gguf-inspector');
const fixtures = require('../fixtures/gguf');

const pending = [];
function test(name, fn) {
  pending.push(Promise.resolve().then(fn).then(() => console.log(`  PASS: ${name}`)).catch((error) => {
    console.error(`  FAIL: ${name}\n    ${error.message}`); process.exitCode = 1;
  }));
}

console.log('GGUF metadata inspector tests');
test('parses recognized typed fields and retains safe unknown extensions', () => {
  const result = inspectGGUFBuffer(fixtures.valid);
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.metadata, {
    'general.architecture': 'llama', 'llama.context_length': 4096,
    'tokenizer.ggml.add_bos_token': true
  });
  assert.strictEqual(result.metadataStatus['general.architecture'], 'known');
  assert.deepStrictEqual(result.extensions['custom.safe_extension'], { type: 'string', value: 'kept' });
  assert.strictEqual(result.modelLoadAttempted, false);
});

test('marks absent recognized fields unknown without rejecting the model record', () => {
  const result = inspectGGUFBuffer(fixtures.absent);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.metadataStatus['llama.context_length'], 'unknown');
  assert.strictEqual(result.metadataStatus['general.architecture'], 'known');
});

test('reports malformed recognized types explicitly', () => {
  const result = inspectGGUFBuffer(fixtures.malformedType);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.metadataStatus['llama.context_length'], 'malformed');
  assert.ok(result.errors.some((item) => item.code === 'MALFORMED_TYPE'));
});

test('reports malformed string lengths and encodings explicitly', () => {
  const lengthResult = inspectGGUFBuffer(fixtures.malformedLength);
  assert.strictEqual(lengthResult.valid, false);
  assert.strictEqual(lengthResult.metadataStatus['general.name'], 'malformed');
  assert.ok(lengthResult.errors.some((item) => item.code === 'TRUNCATED'));

  const encodingResult = inspectGGUFBuffer(fixtures.malformedEncoding);
  assert.strictEqual(encodingResult.valid, false);
  assert.strictEqual(encodingResult.metadataStatus['general.name'], 'malformed');
  assert.ok(encodingResult.errors.some((item) => item.code === 'MALFORMED_ENCODING'));
});

test('enforces string and metadata byte bounds', () => {
  const result = inspectGGUFBuffer(fixtures.oversized, { maxStringBytes: 4 });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((item) => item.code === 'LIMIT_EXCEEDED'));
  const metadataBound = inspectGGUFBuffer(fixtures.valid, { maxMetadataBytes: 8 });
  assert.strictEqual(metadataBound.valid, false);
  assert.strictEqual(metadataBound.truncated, true);
});

test('reports truncated metadata instead of throwing or loading a model', () => {
  const result = inspectGGUFBuffer(fixtures.truncated);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.truncated, true);
  assert.ok(result.errors.some((item) => item.code === 'TRUNCATED'));
  assert.strictEqual(result.modelLoadAttempted, false);
});

test('streams a source within the configured byte bound', async () => {
  const result = await inspectGGUF((async function* stream() {
    yield fixtures.valid.subarray(0, 10); yield fixtures.valid.subarray(10);
  })());
  assert.strictEqual(result.valid, true);
  const bounded = await inspectGGUF((async function* stream() { yield fixtures.valid; })(), { maxBytes: 24 });
  assert.strictEqual(bounded.valid, false);
  assert.ok(bounded.errors.some((item) => item.code === 'LIMIT_EXCEEDED'));
});

Promise.all(pending).then(() => console.log('All GGUF inspector tests completed.'));
