/* eslint-env node */
/**
 * Route planner tests (Tasks 14.1, 14.3)
 * Requirements: 20.1-20.6, 17.2-17.4
 * Validates: no-route, fallback, visible model changes, prior metadata
 * preservation, phase gate, cancellation, bounded admission, provider parity.
 */
const assert = require('assert');
const { planRoute } = require('../../routing/route-planner');
const { ROUTE_OUTCOMES } = require('../../routing/route-result');

async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.stack || error.message}`); process.exitCode = 1; }
}

const phaseGatesPassed = { phase1ExitCriteriaPassed: true };
const phaseGatesNotPassed = { phase1ExitCriteriaPassed: false };

const candidates = [
  { id: 'model-a', providerId: 'local-llama-server', digest: 'sha256:aaa', capabilities: ['chat', 'streaming'], fitPlan: { status: 'fits' }, availability: 'available', origin: 'local', verification: 'verified' },
  { id: 'model-b', providerId: 'local-llama-server', digest: 'sha256:bbb', capabilities: ['chat', 'streaming'], fitPlan: { status: 'tight' }, availability: 'available', origin: 'local', verification: 'verified' },
  { id: 'model-c', providerId: 'openai-compatible', digest: 'sha256:ccc', capabilities: ['chat', 'streaming'], fitPlan: { status: 'fits' }, availability: 'available', origin: 'remote', verification: 'unknown' }
];

(async () => {
  console.log('Route planner tests');

  await test('phase gate blocks routing when phase 1 not passed', async () => {
    const result = planRoute({ candidates, phaseGates: phaseGatesNotPassed, requestCapabilities: { chat: true } });
    assert.strictEqual(result.outcome, 'no-route');
    assert.ok(result.reason.includes('Phase 1'));
  });

  await test('no candidates returns no-route', async () => {
    const result = planRoute({ candidates: [], phaseGates: phaseGatesPassed, requestCapabilities: { chat: true } });
    assert.strictEqual(result.outcome, 'no-route');
  });

  await test('single candidate returns no-route (routing requires 2+)', async () => {
    const result = planRoute({ candidates: [candidates[0]], phaseGates: phaseGatesPassed, requestCapabilities: { chat: true } });
    assert.strictEqual(result.outcome, 'no-route');
    assert.ok(result.reason.includes('at least two'));
  });

  await test('routed result selects best-fit model', async () => {
    const result = planRoute({ candidates, phaseGates: phaseGatesPassed, requestCapabilities: { chat: true } });
    assert.strictEqual(result.outcome, 'routed');
    assert.strictEqual(result.modelDigest, 'sha256:aaa');
  });

  await test('preferLocal preference excludes remote when local available', async () => {
    const result = planRoute({ candidates, phaseGates: phaseGatesPassed, requestCapabilities: { chat: true }, preferences: { preferLocal: true } });
    assert.strictEqual(result.outcome, 'routed');
    assert.strictEqual(result.providerId, 'local-llama-server');
  });

  await test('no candidate with required capabilities returns no-route', async () => {
    const result = planRoute({ candidates, phaseGates: phaseGatesPassed, requestCapabilities: { tools: true } });
    assert.strictEqual(result.outcome, 'no-route');
    assert.ok(result.reason.includes('capabilities'));
  });

  await test('does-not-fit candidates are excluded', async () => {
    const allDoesNotFit = candidates.map(c => ({ ...c, fitPlan: { status: 'does-not-fit' } }));
    const result = planRoute({ candidates: allDoesNotFit, phaseGates: phaseGatesPassed, requestCapabilities: { chat: true } });
    assert.strictEqual(result.outcome, 'no-route');
    assert.ok(result.reason.includes('fits'));
  });

  await test('fallback when no available candidate but fallback configured', async () => {
    const allUnavailable = candidates.map(c => ({ ...c, availability: 'unavailable' }));
    const result = planRoute({ candidates: allUnavailable, phaseGates: phaseGatesPassed, requestCapabilities: { chat: true }, fallbackModelId: 'model-a' });
    assert.strictEqual(result.outcome, 'fallback');
  });

  await test('cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = planRoute({ candidates, phaseGates: phaseGatesPassed, requestCapabilities: { chat: true }, signal: controller.signal });
    assert.strictEqual(result.outcome, 'cancelled');
  });

  await test('scheduler with active load prefers currently loaded model', async () => {
    const result = planRoute({
      candidates,
      phaseGates: phaseGatesPassed,
      requestCapabilities: { chat: true },
      schedulerState: { hasActiveLoad: true, activeModelId: 'model-b' }
    });
    assert.strictEqual(result.outcome, 'routed');
    assert.strictEqual(result.modelDigest, 'sha256:bbb');
    assert.ok(result.reason.includes('one-load-at-a-time'));
  });

  await test('route result preserves model digest and provider identity', async () => {
    const result = planRoute({ candidates, phaseGates: phaseGatesPassed, requestCapabilities: { chat: true } });
    assert.ok(result.modelDigest);
    assert.ok(result.providerId);
    assert.ok(result.reason);
  });

  await test('preferVerified filters unverified when verified available', async () => {
    const result = planRoute({
      candidates,
      phaseGates: phaseGatesPassed,
      requestCapabilities: { chat: true },
      preferences: { preferLocal: false, preferVerified: true }
    });
    assert.strictEqual(result.outcome, 'routed');
    assert.strictEqual(result.modelDigest, 'sha256:aaa');
  });

  await test('all route outcomes are valid types', async () => {
    const results = [
      planRoute({ candidates: [], phaseGates: phaseGatesPassed, requestCapabilities: {} }),
      planRoute({ candidates, phaseGates: phaseGatesPassed, requestCapabilities: { chat: true } }),
      planRoute({ candidates: candidates.map(c => ({ ...c, availability: 'unavailable' })), phaseGates: phaseGatesPassed, requestCapabilities: { chat: true }, fallbackModelId: 'x' })
    ];
    for (const r of results) {
      assert.ok(ROUTE_OUTCOMES.includes(r.outcome), `Invalid outcome: ${r.outcome}`);
    }
  });

  console.log('\nRoute planner tests complete.');
})();
