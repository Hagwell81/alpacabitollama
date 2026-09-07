/* eslint-env node */
const assert = require('assert');
const { Readable } = require('stream');
const { digestStream, digestIdentity, contentIdentity, isExecutableArtifact, executionAvailability,
  normalizeDigest, verifyDigest
} = require('../../catalog/model-identity');
const { createCatalogSnapshot } = require('../../catalog/model-catalog');
const fixtures = require('../fixtures/gguf');

function test(name, fn) {
  Promise.resolve().then(fn).then(() => console.log(`  PASS: ${name}`)).catch((error) => {
    console.error(`  FAIL: ${name}\n    ${error.message}`);
    process.exitCode = 1;
  });
}

console.log('model identity tests');

test('computes a canonical digest from streamed chunks without buffering', async () => {
  const digest = await digestStream(Readable.from([Buffer.from('hello '), Buffer.from('world')]));
  assert.deepStrictEqual(digest, {
    algorithm: 'sha256',
    value: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    verified: true
  });
  assert.strictEqual(digestIdentity(digest), `digest:sha256:${digest.value}`);
});

test('changed artifact bytes produce distinct verified identities', async () => {
  const original = await digestStream(Readable.from([fixtures.changedBytes.original]));
  const changed = await digestStream(Readable.from([fixtures.changedBytes.changed]));
  assert.notStrictEqual(digestIdentity(original), digestIdentity(changed));
});

test('catalog merges verified digest aliases but keeps changed bytes distinct', () => {
  const base = { displayName: 'Model', providerId: 'local', providerGroupId: 'Local', format: 'gguf', capabilities: ['chat'], verification: 'verified', availability: 'available' };
  const snapshot = createCatalogSnapshot({ local: [
    { ...base, id: 'one', reference: '/one.gguf', digest: { algorithm: 'sha256', value: 'aa', verified: true } },
    { ...base, id: 'alias', reference: '/alias.gguf', digest: { algorithm: 'SHA256', value: 'AA', verified: true } },
    { ...base, id: 'changed', reference: '/changed.gguf', digest: { algorithm: 'sha256', value: 'bb', verified: true } }
  ] }, undefined, { now: 1 });
  assert.strictEqual(snapshot.records.length, 2);
  const same = snapshot.records.find((record) => digestIdentity(record.digest) === 'digest:sha256:aa');
  assert.strictEqual(same.aliases.length, 2);
  assert.notStrictEqual(contentIdentity(snapshot.records[0]), contentIdentity(snapshot.records[1]));
});

test('unverified artifacts are never executable or available', () => {
  const record = { verification: 'pending', availability: 'available', digest: { algorithm: 'sha256', value: 'aa', verified: false } };
  assert.strictEqual(isExecutableArtifact(record), false);
  assert.strictEqual(executionAvailability(record, 'available'), 'unavailable');
  const snapshot = createCatalogSnapshot({ local: [{ id: 'pending', displayName: 'Pending', providerId: 'local', reference: '/pending.gguf', format: 'gguf', ...record }] }, undefined, { now: 1 });
  assert.strictEqual(snapshot.records[0].availability, 'unavailable');
});

test('normalizes malformed digest metadata without creating content identity', () => {
  assert.strictEqual(normalizeDigest({ algorithm: 'bad name', value: 'aa', verified: true }), null);
  assert.strictEqual(verifyDigest({ algorithm: 'sha256', value: 'AA', verified: true }, { algorithm: 'SHA256', value: 'aa' }), true);
});
