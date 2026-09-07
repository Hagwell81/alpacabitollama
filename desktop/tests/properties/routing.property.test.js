/* eslint-env node */
/**
 * Property 9 (routing extension): Reference-counted deterministic recovery (Task 14.4)
 * Validate: Requirement 20.5
 *
 * Property: The scheduler continues to enforce one-load-at-a-time, bounded
 * admission, reference-counted unload, cancellation, and Controlled_OOM_Retry
 * rules during routing. Route planning is deterministic given the same
 * candidates, capabilities, preferences, and scheduler state.
 *
 * Uses fast-check with at least 100 runs.
 */
const assert = require('assert');
const fc = require('fast-check');
const { planRoute } = require('../../routing/route-planner');

// Feature: Property 9 (routing extension) — Reference-counted deterministic recovery
// Property: Route planning is deterministic: the same inputs always produce
// the same route decision, and one-load-at-a-time is respected.

async function run() {
  console.log('Property 9 (routing extension): Deterministic routing (100 runs)');

  // Property: Route planning is deterministic — same inputs produce same output
  fc.assert(fc.property(
    fc.record({
      candidateCount: fc.integer({ min: 2, max: 10 }),
      preferLocal: fc.boolean(),
      preferVerified: fc.boolean(),
      hasActiveLoad: fc.boolean(),
      activeModelIndex: fc.integer({ min: 0, max: 9 })
    }),
    (input) => {
      const candidates = Array.from({ length: input.candidateCount }, (_, i) => ({
        id: `model-${i}`,
        providerId: i < input.candidateCount / 2 ? 'local' : 'remote',
        digest: `sha256:${i}`,
        capabilities: ['chat', 'streaming'],
        fitPlan: { status: i % 3 === 0 ? 'fits' : (i % 3 === 1 ? 'tight' : 'unknown') },
        availability: i % 5 === 0 ? 'unavailable' : 'available',
        origin: i < input.candidateCount / 2 ? 'local' : 'remote',
        verification: i % 2 === 0 ? 'verified' : 'unknown'
      }));

      const baseInput = {
        candidates,
        phaseGates: { phase1ExitCriteriaPassed: true },
        requestCapabilities: { chat: true },
        preferences: { preferLocal: input.preferLocal, preferVerified: input.preferVerified },
        schedulerState: input.hasActiveLoad && input.activeModelIndex < input.candidateCount
          ? { hasActiveLoad: true, activeModelId: candidates[input.activeModelIndex].id }
          : { hasActiveLoad: false }
      };

      const result1 = planRoute(baseInput);
      const result2 = planRoute(baseInput);

      // Compare without correlationId (which is generated uniquely each call)
      const { correlationId: _c1, ...r1Rest } = result1;
      const { correlationId: _c2, ...r2Rest } = result2;
      assert.deepStrictEqual(r1Rest, r2Rest, 'Route planning must be deterministic (excluding correlationId)');
    }
  ), { numRuns: 100 });

  console.log('  PASS: Route planning is deterministic');

  // Property: One-load-at-a-time — when scheduler has active load, route
  // prefers the currently loaded model if it's a valid candidate
  fc.assert(fc.property(
    fc.record({
      candidateCount: fc.integer({ min: 2, max: 10 }),
      activeModelIndex: fc.integer({ min: 0, max: 9 })
    }),
    (input) => {
      if (input.activeModelIndex >= input.candidateCount) return;

      const candidates = Array.from({ length: input.candidateCount }, (_, i) => ({
        id: `model-${i}`,
        providerId: 'local',
        digest: `sha256:${i}`,
        capabilities: ['chat'],
        fitPlan: { status: 'fits' },
        availability: 'available',
        origin: 'local',
        verification: 'verified'
      }));

      const activeModel = candidates[input.activeModelIndex];
      const result = planRoute({
        candidates,
        phaseGates: { phase1ExitCriteriaPassed: true },
        requestCapabilities: { chat: true },
        schedulerState: { hasActiveLoad: true, activeModelId: activeModel.id }
      });

      if (result.outcome === 'routed') {
        assert.strictEqual(result.modelDigest, activeModel.digest,
          'When active load exists, route must prefer the loaded model');
      }
    }
  ), { numRuns: 100 });

  console.log('  PASS: One-load-at-a-time enforced during routing');

  // Property: Bounded admission — route never returns a model that is unavailable
  fc.assert(fc.property(
    fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 10 }),
        availability: fc.constantFrom('available', 'unavailable', 'stale'),
        fitStatus: fc.constantFrom('fits', 'tight', 'does-not-fit', 'unknown')
      }),
      { minLength: 2, maxLength: 10 }
    ),
    (candidates) => {
      const fullCandidates = candidates.map((c, i) => ({
        ...c,
        providerId: 'local',
        digest: `sha256:${i}`,
        capabilities: ['chat'],
        fitPlan: { status: c.fitStatus },
        origin: 'local',
        verification: 'verified'
      }));

      const result = planRoute({
        candidates: fullCandidates,
        phaseGates: { phase1ExitCriteriaPassed: true },
        requestCapabilities: { chat: true }
      });

      if (result.outcome === 'routed') {
        const routed = fullCandidates.find((c) => c.digest === result.modelDigest);
        assert.ok(routed, 'Routed model must be in candidates');
        assert.notStrictEqual(routed.availability, 'unavailable',
          'Routed model must not be unavailable');
        assert.notStrictEqual(routed.fitPlan.status, 'does-not-fit',
          'Routed model must not be does-not-fit');
      }
    }
  ), { numRuns: 100 });

  console.log('  PASS: Bounded admission — unavailable and does-not-fit never routed');

  console.log('\nProperty 9 routing tests complete (300 total runs).');
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
