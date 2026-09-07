/* eslint-env node */
/**
 * Discovery cache tests (Task 12.2)
 * Requirements: 18.2-18.3, 16.2-16.3
 * Validates: source attribution, verification status, pagination,
 * cancellation, expiry, previous-record retention, bounded results,
 * and no implicit network access.
 */
const assert = require('assert');
const { DiscoveryCache, createDiscoveryRecord } = require('../../catalog/discovery-cache');

async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.stack || error.message}`); process.exitCode = 1; }
}

(async () => {
  console.log('Discovery cache tests');

  await test('disabled cache refuses discovery', async () => {
    const cache = new DiscoveryCache();
    const result = await cache.discover('hf');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'DISCOVERY_DISABLED');
  });

  await test('no implicit network access on enable', async () => {
    let fetchCount = 0;
    const cache = new DiscoveryCache();
    cache.registerSource('hf', async () => { fetchCount++; return { records: [] }; });
    cache.enable();
    assert.strictEqual(fetchCount, 0);
  });

  await test('discover returns records with source attribution', async () => {
    const cache = new DiscoveryCache();
    cache.registerSource('hf', async () => ({
      records: [{ id: 'model-1', displayName: 'Model 1', digest: 'sha256:abc' }]
    }));
    cache.enable();
    const result = await cache.discover('hf');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.records.length, 1);
    assert.strictEqual(result.data.records[0].source, 'hf');
    assert.strictEqual(result.data.records[0].verification, 'unknown');
  });

  await test('pagination: nextCursor passed to fetcher', async () => {
    const calls = [];
    const cache = new DiscoveryCache();
    cache.registerSource('hf', async (cursor) => {
      calls.push(cursor);
      if (!cursor) return { records: [{ id: 'page1' }], nextCursor: 'page2' };
      if (cursor === 'page2') return { records: [{ id: 'page2-model' }], nextCursor: null };
      return { records: [] };
    });
    cache.enable();
    await cache.discover('hf');
    assert.strictEqual(calls[0], undefined);
    const result2 = await cache.discover('hf', { cursor: 'page2' });
    assert.strictEqual(result2.data.records[0].id, 'page2-model');
  });

  await test('cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    const cache = new DiscoveryCache();
    cache.registerSource('hf', async () => ({ records: [] }));
    cache.enable();
    const result = await cache.discover('hf', { signal: controller.signal });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'CALLER_CANCELLED');
  });

  await test('source failure retains previous records as stale', async () => {
    let shouldFail = false;
    const cache = new DiscoveryCache();
    cache.registerSource('hf', async () => {
      if (shouldFail) throw new Error('Network down');
      return { records: [{ id: 'model-1', digest: 'sha256:abc' }] };
    });
    cache.enable();
    await cache.discover('hf');
    shouldFail = true;
    const result = await cache.discover('hf');
    assert.strictEqual(result.success, true);
    const stale = result.data.records.find((r) => r.id === 'model-1');
    assert.ok(stale);
    assert.strictEqual(stale.verification, 'stale');
  });

  await test('bounded results: max per source enforced', async () => {
    const cache = new DiscoveryCache({ maxResultsPerSource: 3 });
    cache.registerSource('hf', async () => ({
      records: Array.from({ length: 10 }, (_, i) => ({ id: `model-${i}` }))
    }));
    cache.enable();
    const result = await cache.discover('hf');
    assert.strictEqual(result.data.records.length, 3);
  });

  await test('snapshot returns cached records without network access', async () => {
    let fetchCount = 0;
    const cache = new DiscoveryCache();
    cache.registerSource('hf', async () => {
      fetchCount++;
      return { records: [{ id: 'model-1' }] };
    });
    cache.enable();
    await cache.discover('hf');
    const before = fetchCount;
    const records = cache.snapshot();
    assert.strictEqual(fetchCount, before);
    assert.strictEqual(records.length, 1);
  });

  await test('expiry marks records stale', async () => {
    const cache = new DiscoveryCache({ expiryMs: 1000 });
    cache.registerSource('hf', async () => ({ records: [{ id: 'model-1' }] }));
    cache.enable();
    await cache.discover('hf');
    await new Promise((r) => setTimeout(r, 1100));
    const records = cache.snapshot();
    assert.strictEqual(records[0].verification, 'stale');
  });

  await test('disable marks all records stale', async () => {
    const cache = new DiscoveryCache();
    cache.registerSource('hf', async () => ({ records: [{ id: 'model-1', verification: 'verified' }] }));
    cache.enable();
    await cache.discover('hf');
    cache.disable();
    const records = cache.snapshot();
    assert.strictEqual(records[0].verification, 'stale');
  });

  await test('clear removes records but keeps sources', async () => {
    const cache = new DiscoveryCache();
    cache.registerSource('hf', async () => ({ records: [{ id: 'model-1' }] }));
    cache.enable();
    await cache.discover('hf');
    cache.clear();
    assert.strictEqual(cache.snapshot().length, 0);
    assert.strictEqual(cache.listSources().length, 1);
  });

  await test('multi-source discover aggregates records', async () => {
    const cache = new DiscoveryCache();
    cache.registerSource('hf', async () => ({ records: [{ id: 'hf-1' }] }));
    cache.registerSource('ollama', async () => ({ records: [{ id: 'ollama-1' }] }));
    cache.enable();
    const result = await cache.discover();
    assert.strictEqual(result.data.records.length, 2);
    const sources = new Set(result.data.records.map((r) => r.source));
    assert.ok(sources.has('hf'));
    assert.ok(sources.has('ollama'));
  });

  console.log('\nDiscovery cache tests complete.');
})();
