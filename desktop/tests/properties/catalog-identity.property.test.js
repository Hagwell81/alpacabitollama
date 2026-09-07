/* eslint-env node */
const assert = require('assert');
const fc = require('fast-check');
const {
  createCatalogSnapshot,
  serializeSnapshot,
  deserializeSnapshot
} = require('../../catalog/model-catalog');
const { contentIdentity, digestIdentity } = require('../../catalog/model-identity');

const nonEmptyText = fc.string({ minLength: 1, maxLength: 18 }).filter((value) => value.trim().length > 0);
const digestValue = fc.integer({ min: 0, max: 0xffffffff })
  .map((value) => value.toString(16).padStart(8, '0'));
const capabilities = fc.uniqueArray(
  fc.constantFrom('chat', 'completion', 'vision', 'tool-use', 'reasoning'),
  { maxLength: 5 }
);
const metadata = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  fc.oneof(fc.boolean(), fc.integer(), nonEmptyText),
  { maxKeys: 3 }
);
const modelRecord = fc.record({
  id: nonEmptyText,
  displayName: nonEmptyText,
  providerId: nonEmptyText,
  providerGroupId: nonEmptyText,
  reference: nonEmptyText,
  capabilities,
  contextLimit: fc.integer({ min: 1, max: 131072 }),
  sizeBytes: fc.integer({ min: 1, max: 0x7fffffff }),
  metadata,
  metadataStatus: fc.dictionary(
    fc.constantFrom('general.architecture', 'general.name', 'general.file_type'),
    fc.constantFrom('known', 'unknown', 'malformed'),
    { maxKeys: 3 }
  )
}).map((record) => ({
  ...record,
  source: 'local',
  format: 'gguf',
  digest: { algorithm: 'sha256', value: 'placeholder', verified: true },
  verification: 'verified',
  availability: 'available',
  lastSeenAt: 1000
}));

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 5: Catalog identity and serialization round trip
// **Validates: Requirements 4.3, 4.4, 4.6**
function test(name, property) {
  try {
    property();
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}\\n    ${error.message}`);
    process.exitCode = 1;
  }
}

test('preserves normalized identity and digest semantics through serialization', () => {
  fc.assert(
    fc.property(modelRecord, digestValue, (record, firstDigest) => {
      const first = { ...record, digest: { algorithm: 'sha256', value: firstDigest, verified: true } };
      const snapshot = createCatalogSnapshot({ local: [first] }, undefined, { now: 2000 });
      const restored = deserializeSnapshot(serializeSnapshot(snapshot));

      assert.deepStrictEqual(restored, snapshot);
      assert.strictEqual(restored.records[0].id, first.id);
      assert.strictEqual(restored.records[0].providerId, first.providerId);
      assert.deepStrictEqual(restored.records[0].capabilities, first.capabilities);
      assert.strictEqual(restored.records[0].verification, 'verified');
      assert.strictEqual(restored.records[0].digest.value, firstDigest);
      assert.strictEqual(contentIdentity(restored.records[0]), `digest:sha256:${firstDigest}`);
    }),
    { numRuns: 100 }
  );
});

test('collapses equal verified digests and preserves different verified digests as distinct identities', () => {
  fc.assert(
    fc.property(modelRecord, digestValue, fc.integer({ min: 0, max: 0xffffffff }), (record, digest, differentDigestNumber) => {
      const differentDigest = differentDigestNumber.toString(16).padStart(8, '0');
      fc.pre(digest !== differentDigest);
      const first = { ...record, digest: { algorithm: 'sha256', value: digest, verified: true } };
      const equal = { ...record, source: 'curated', id: `${record.id}-alias`, reference: `${record.reference}-alias`, digest: { algorithm: 'SHA256', value: digest.toUpperCase(), verified: true } };
      const different = { ...record, id: `${record.id}-different`, reference: `${record.reference}-different`, digest: { algorithm: 'sha256', value: differentDigest, verified: true } };
      const snapshot = createCatalogSnapshot({ local: [first, different], curated: [equal] }, undefined, { now: 2000 });

      assert.strictEqual(snapshot.records.length, 2);
      const sameContent = snapshot.records.find((item) => digestIdentity(item.digest) === `digest:sha256:${digest}`);
      const changedContent = snapshot.records.find((item) => digestIdentity(item.digest) === `digest:sha256:${differentDigest}`);
      assert.ok(sameContent);
      assert.ok(changedContent);
      assert.strictEqual(sameContent.aliases.length, 2);
      assert.strictEqual(contentIdentity(sameContent), `digest:sha256:${digest}`);
      assert.strictEqual(contentIdentity(changedContent), `digest:sha256:${differentDigest}`);
    }),
    { numRuns: 100 }
  );
});
