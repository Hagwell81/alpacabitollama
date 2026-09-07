const assert = require('node:assert/strict');
const { ModelResourceManager, ModelResourceError } = require('../../scheduling/model-resource-manager');

const model = (id, digest) => ({ id, providerId: 'local', source: 'local', reference: id, ...(digest ? { digest: { algorithm: 'sha256', value: digest, verified: true } } : {}) });

test('tracks reservations and streams without allowing duplicate release to go negative', () => {
  let now = 100;
  const manager = new ModelResourceManager({ now: () => now, idleMs: 10 });
  const reservation = manager.reserve(model('alpha'), { streamId: 'stream-1' });
  assert.equal(manager.getSnapshot().resources[0].referenceCount, 1);
  assert.equal(manager.getSnapshot().resources[0].activeStreams, 1);
  assert.equal(manager.release(reservation).released, true);
  assert.equal(manager.release(reservation).released, false);
  manager.endStream(model('alpha'), 'stream-1');
  now = 110;
  assert.equal(manager.isIdleUnloadEligible(model('alpha')), true);
  assert.equal(manager.getSnapshot().resources[0].referenceCount, 0);
});

test('reservation, EnsureReady ownership, and active streams protect idle resources', () => {
  let now = 50;
  const manager = new ModelResourceManager({ now: () => now, idleMs: 0 });
  manager.markLoaded(model('reserved'), { bytes: 10 });
  const reservation = manager.reserve(model('reserved'));
  assert.equal(manager.isIdleUnloadEligible(model('reserved')), false);
  manager.release(reservation);
  const ensure = manager.acquireEnsureReady(model('reserved'));
  assert.equal(manager.isIdleUnloadEligible(model('reserved')), false);
  manager.release(ensure);
  const stream = manager.startStream(model('reserved'), 's');
  assert.equal(manager.isIdleUnloadEligible(model('reserved')), false);
  stream.release();
  assert.equal(manager.isIdleUnloadEligible(model('reserved')), true);
});

test('uses inclusive idle deadline and protects pinned and selected resources', () => {
  let now = 0;
  const manager = new ModelResourceManager({ now: () => now, idleMs: 10 });
  manager.markLoaded(model('pinned'), { bytes: 1 }, { pinned: true });
  manager.markLoaded(model('selected'), { bytes: 1 }, { selected: true });
  manager.markLoaded(model('idle'), { bytes: 1 });
  now = 10;
  assert.equal(manager.isIdleUnloadEligible(model('idle')), true);
  assert.equal(manager.isIdleUnloadEligible(model('pinned')), false);
  assert.equal(manager.isIdleUnloadEligible(model('selected')), false);
  assert.equal(manager.unloadIdle().evicted.length, 1);
  assert.equal(manager.getSnapshot().loaded, 2);
});

test('evicts by LRU and canonical identity tie-breaker, collapsing verified aliases', () => {
  let now = 0;
  const manager = new ModelResourceManager({ now: () => now, idleMs: 0, maxBytes: 5 });
  manager.markLoaded(model('zeta', 'bbb'), { bytes: 2 });
  manager.markLoaded(model('alias', 'aaa'), { bytes: 3 });
  manager.markLoaded(model('same-alias', 'bbb'), { bytes: 4 });
  assert.equal(manager.getSnapshot().loaded, 2);
  const result = manager.evictForCapacity({ bytes: 1 }, { reason: 'capacity' });
  assert.deepEqual(result.evicted.map((item) => item.identity), ['digest:sha256:aaa']);
  assert.equal(manager.getSnapshot().resources[0].bytes, 4);
});

test('reports typed capacity failure when every candidate is protected', () => {
  const manager = new ModelResourceManager({ maxResources: 1, maxBytes: 10, idleMs: 0 });
  manager.markLoaded(model('active'), { bytes: 10 }, { selected: true });
  assert.throws(() => manager.evictForCapacity({ bytes: 1 }), (error) => {
    assert.ok(error instanceof ModelResourceError);
    return error.code === 'RESOURCE_CAPACITY' && error.retryable === true;
  });
});

test('snapshots are sorted and do not expose mutable internal collections', () => {
  const manager = new ModelResourceManager({ idleMs: 0 });
  manager.markLoaded(model('b'), { bytes: 2 });
  manager.markLoaded(model('a'), { bytes: 1 });
  const snapshot = manager.getSnapshot();
  assert.deepEqual(snapshot.resources.map((entry) => entry.modelId), ['a', 'b']);
  snapshot.resources[0].referenceCount = 99;
  snapshot.resources.pop();
  assert.equal(manager.getSnapshot().resources.length, 2);
  assert.equal(manager.getSnapshot().resources[0].referenceCount, 0);
});

test('ensure-ready and recovery protection participate in idle eligibility', () => {
  const manager = new ModelResourceManager({ idleMs: 0 });
  manager.markLoaded(model('protected'), { bytes: 4 }, { recoveryProtected: true });
  assert.equal(manager.isIdleUnloadEligible(model('protected')), false);
  manager.setRecoveryProtected(model('protected'), false);
  const ensure = manager.acquireEnsureReady(model('protected'));
  assert.equal(manager.isIdleUnloadEligible(model('protected')), false);
  manager.release(ensure);
  assert.equal(manager.isIdleUnloadEligible(model('protected')), true);
});

test('unloadIdle honors limits, reports reasons, and calls the unload hook', () => {
  const unloaded = [];
  const manager = new ModelResourceManager({ idleMs: 0, unload: (resource, reason) => unloaded.push({ identity: resource.identity, reason }) });
  manager.markLoaded(model('older'), { bytes: 1 }, { lastUsedAt: 1 });
  manager.markLoaded(model('newer'), { bytes: 1 }, { lastUsedAt: 2 });
  const result = manager.unloadIdle({ limit: 1, reason: 'test-eviction', at: 3 });
  assert.deepEqual(result.evicted.map((entry) => entry.identity), ['source:local:local:older:older']);
  assert.deepEqual(unloaded, [{ identity: 'source:local:local:older:older', reason: 'test-eviction' }]);
  assert.equal(manager.getSnapshot().loaded, 1);
});

test('capacity eviction accounts for both resource count and bytes', () => {
  let now = 0;
  const manager = new ModelResourceManager({ now: () => now, idleMs: 0, maxResources: 2, maxBytes: 10 });
  manager.markLoaded(model('a'), { bytes: 3 });
  now = 1;
  manager.markLoaded(model('b'), { bytes: 4 });
  now = 2;
  manager.markLoaded(model('c'), { bytes: 2 });
  const result = manager.evictForCapacity({ bytes: 5 }, { at: 2 });
  assert.deepEqual(result.evicted.map((entry) => entry.identity), ['source:local:local:a:a', 'source:local:local:b:b']);
  assert.equal(manager.getSnapshot().loaded, 1);
  assert.equal(manager.getSnapshot().loadedBytes, 2);
});
