/* eslint-env node */
const assert = require('assert');
const {
  ModelCatalog, createCatalogSnapshot, mergeCatalogSources, serializeSnapshot, deserializeSnapshot
} = require('../../catalog/model-catalog');
const fixtures = require('../fixtures/catalog');
const { digestStream, digestIdentity } = require('../../catalog/model-identity');

function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.message}`); process.exitCode = 1; }
}

console.log('model catalog snapshot tests');

const local = (overrides = {}) => ({
  id: 'local-model', displayName: 'Local Model', providerId: 'local', providerGroupId: 'Local',
  source: 'local', format: 'gguf', reference: '/models/local.gguf',
  digest: { algorithm: 'sha256', value: 'ABC123', verified: true },
  verification: 'verified', availability: 'available', capabilities: ['chat'], ...overrides
});

test('uses catalog fixtures to preserve all source observations and deterministic order', () => {
  const first = createCatalogSnapshot(fixtures.orderedSources, undefined, { now: 10 });
  const reversed = createCatalogSnapshot({
    router: fixtures.orderedSources.router,
    curated: fixtures.orderedSources.curated,
    local: fixtures.orderedSources.local,
    discovery: fixtures.orderedSources.discovery
  }, undefined, { now: 10 });
  assert.deepStrictEqual(first.records, reversed.records);
  assert.deepStrictEqual(first.records.map((record) => record.displayName), ['Curated', 'Alpha', 'Zeta', 'Router']);
});

test('fixture records with equal and changed digests have distinct expected identities', () => {
  const aliases = createCatalogSnapshot({ local: fixtures.duplicateDigestAliases }, undefined, { now: 1 });
  assert.strictEqual(aliases.records.length, 1);
  assert.strictEqual(aliases.records[0].aliases.length, 2);
  const changed = createCatalogSnapshot({ local: fixtures.changedDigestArtifacts }, undefined, { now: 1 });
  assert.strictEqual(changed.records.length, 2);
  assert.notStrictEqual(digestIdentity(changed.records[0].digest), digestIdentity(changed.records[1].digest));
});

test('fixture source failure retains the prior record as stale', () => {
  const first = createCatalogSnapshot({ local: [fixtures.model()] }, undefined, { now: 1 });
  const second = createCatalogSnapshot(fixtures.unavailableLocal, first, { now: 2 });
  assert.strictEqual(second.records[0].availability, 'stale');
  assert.strictEqual(second.sourceFailures[0].code, 'E_OFFLINE');
});

test('normalizes all sources and sorts records deterministically', () => {
  const snapshot = createCatalogSnapshot({
    discovery: [local({ id: 'z', displayName: 'Zeta', source: 'discovery', providerId: 'remote', providerGroupId: 'Remote', reference: 'z', digest: { algorithm: 'sha256', value: 'ZZZ', verified: true } })],
    local: [local(), local({ id: 'a', displayName: 'Alpha', reference: '/models/a.gguf', digest: { algorithm: 'sha256', value: 'AAA', verified: true } })],
    curated: [local({ id: 'c', displayName: 'Curated', source: 'curated', providerId: 'curated', providerGroupId: 'Curated', reference: 'c', digest: { algorithm: 'sha256', value: 'CCC', verified: true } })],
    router: [local({ id: 'r', displayName: 'Router', source: 'router', providerId: 'router', providerGroupId: 'Router', reference: 'r', digest: { algorithm: 'sha256', value: 'RRR', verified: true } })]
  }, undefined, { now: 100 });
  assert.deepStrictEqual(snapshot.records.map((record) => record.displayName), ['Curated', 'Alpha', 'Local Model', 'Zeta', 'Router']);
  assert.strictEqual(Object.isFrozen(snapshot), true);
  assert.strictEqual(Object.isFrozen(snapshot.records[0]), true);
  assert.strictEqual(snapshot.records[0].lastSeenAt, 100);
});

test('collapses equal verified digests and retains source/path aliases', () => {
  const snapshot = mergeCatalogSources({
    local: [local()],
    curated: [local({ source: 'curated', providerId: 'curated', providerGroupId: 'Curated', id: 'curated-copy', reference: 'manifest://model' })]
  }, undefined, { now: 10 });
  assert.strictEqual(snapshot.records.length, 1);
  assert.strictEqual(snapshot.records[0].aliases.length, 2);
  assert.strictEqual(snapshot.records[0].sources.length, 2);
  assert.strictEqual(Object.keys(snapshot.aliases).length, 2);
});

test('does not expose unverified records as available', () => {
  const snapshot = createCatalogSnapshot({ local: [local({ verification: 'pending', availability: 'available' })] }, undefined, { now: 1 });
  assert.strictEqual(snapshot.records[0].availability, 'unavailable');
});

test('retains records as stale and records source failures', () => {
  const first = createCatalogSnapshot({ local: [local()] }, undefined, { now: 1 });
  const second = createCatalogSnapshot({ local: { error: { code: 'E_OFFLINE', message: 'Local scan failed', retryable: true } } }, first, { now: 2 });
  assert.strictEqual(second.records.length, 1);
  assert.strictEqual(second.records[0].availability, 'stale');
  assert.deepStrictEqual(second.sourceFailures[0], { source: 'local', code: 'E_OFFLINE', message: 'Local scan failed', retryable: true, at: 2 });
  assert.strictEqual(second.records[0].digest.value, 'ABC123');
});

test('refresh removes obsolete source records but preserves other sources', () => {
  const first = createCatalogSnapshot({ local: [local()], curated: [local({ source: 'curated', providerId: 'curated', providerGroupId: 'Curated', id: 'curated', reference: 'curated', digest: { algorithm: 'sha256', value: 'CURATED', verified: true } })] }, undefined, { now: 1 });
  const second = createCatalogSnapshot({ local: [] }, first, { now: 2 });
  assert.deepStrictEqual(second.records.map((record) => record.id), ['curated']);
});

test('snapshot serialization round trips without mutable references', () => {
  const snapshot = new ModelCatalog({ sources: { local: [local()] }, now: 1 }).getSnapshot();
  const restored = deserializeSnapshot(serializeSnapshot(snapshot));
  assert.deepStrictEqual(restored, snapshot);
  assert.notStrictEqual(restored.records, snapshot.records);
  assert.strictEqual(Object.isFrozen(restored), true);
});

console.log('All model catalog tests completed.');
