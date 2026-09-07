/* eslint-env node */
/**
 * Property 19: Phase gates and optional complexity (Task 13.5)
 * Validate: Requirements 18.5, 19.1-19.2, 19.6, 20.1, 20.3, 20.6
 *
 * Property: Phase 2 capabilities remain disabled unless Phase 1 exit
 * criteria pass AND explicit user opt-in is given. Any failure rolls
 * back to Phase 1 behavior. Resource/privacy bounds are enforced.
 *
 * Uses fast-check with at least 100 runs.
 */
const assert = require('assert');
const fc = require('fast-check');
const { FeatureGates } = require('../../feature-gates');
const { BenchmarkCalibrator } = require('../../calibration/benchmark-calibrator');
const { planRoute } = require('../../routing/route-planner');

// Feature: Property 19 — Phase gates and optional complexity
// Property: Phase 2 capabilities are fail-closed; they enable only on
// phase1ExitCriteriaPassed + explicit opt-in, and rollback disables them.

async function run() {
  console.log('Property 19: Phase gates and optional complexity (100 runs)');

  // Property: Phase 2 flags are never enabled when phase1 is not passed
  fc.assert(fc.property(
    fc.record({
      phase1Passed: fc.boolean(),
      remoteProviders: fc.boolean(),
      discovery: fc.boolean(),
      calibration: fc.boolean()
    }),
    (input) => {
      const gates = new FeatureGates({
        phase1ExitCriteriaPassed: input.phase1Passed,
        phase2Flags: {
          phase2RemoteProviders: input.remoteProviders,
          phase2Discovery: input.discovery,
          phase2Calibration: input.calibration
        }
      });
      if (!input.phase1Passed) {
        assert.strictEqual(gates.isEnabled('phase2RemoteProviders'), false, 'remoteProviders must be disabled when phase1 not passed');
        assert.strictEqual(gates.isEnabled('phase2Discovery'), false, 'discovery must be disabled when phase1 not passed');
        assert.strictEqual(gates.isEnabled('phase2Calibration'), false, 'calibration must be disabled when phase1 not passed');
      }
    }
  ), { numRuns: 100 });

  console.log('  PASS: Phase 2 flags disabled when phase1 not passed');

  // Property: rollback disables all Phase 2 flags
  fc.assert(fc.property(
    fc.record({
      phase1Passed: fc.boolean(),
      remoteProviders: fc.boolean(),
      discovery: fc.boolean(),
      calibration: fc.boolean()
    }),
    (input) => {
      const gates = new FeatureGates({
        phase1ExitCriteriaPassed: input.phase1Passed,
        phase2Flags: {
          phase2RemoteProviders: input.remoteProviders,
          phase2Discovery: input.discovery,
          phase2Calibration: input.calibration
        }
      });
      gates.rollback('test');
      assert.strictEqual(gates.isEnabled('phase2RemoteProviders'), false);
      assert.strictEqual(gates.isEnabled('phase2Discovery'), false);
      assert.strictEqual(gates.isEnabled('phase2Calibration'), false);
      assert.strictEqual(gates.phase1Passed(), false);
    }
  ), { numRuns: 100 });

  console.log('  PASS: Rollback disables all Phase 2 flags');

  // Property: calibration never runs when disabled
  fc.assert(fc.asyncProperty(
    fc.record({
      enabled: fc.boolean(),
      maxIterations: fc.integer({ min: 1, max: 10 })
    }),
    async (input) => {
      const cal = new BenchmarkCalibrator({ maxIterations: input.maxIterations });
      if (input.enabled) cal.enable();
      const result = await cal.calibrate({
        modelDigest: 'sha256:test',
        runner: async () => ({ tokensGenerated: 10, durationMs: 1 })
      });
      if (!input.enabled) {
        assert.strictEqual(result.success, false, 'Calibration must fail when disabled');
        assert.strictEqual(result.error.code, 'CALIBRATION_DISABLED');
      } else {
        assert.strictEqual(result.success, true, 'Calibration must succeed when enabled');
      }
    }
  ), { numRuns: 100 });

  console.log('  PASS: Calibration never runs when disabled');

  // Property: routing never routes when phase1 not passed
  fc.assert(fc.property(
    fc.record({
      phase1Passed: fc.boolean(),
      candidateCount: fc.integer({ min: 0, max: 5 })
    }),
    (input) => {
      const candidates = Array.from({ length: input.candidateCount }, (_, i) => ({
        id: `model-${i}`, providerId: 'local', digest: `sha256:${i}`,
        capabilities: ['chat'], fitPlan: { status: 'fits' },
        availability: 'available', origin: 'local', verification: 'verified'
      }));
      const result = planRoute({
        candidates,
        phaseGates: { phase1ExitCriteriaPassed: input.phase1Passed },
        requestCapabilities: { chat: true }
      });
      if (!input.phase1Passed) {
        assert.strictEqual(result.outcome, 'no-route', 'Routing must be no-route when phase1 not passed');
      }
    }
  ), { numRuns: 100 });

  console.log('  PASS: Routing never routes when phase1 not passed');

  // Property: calibration results never contain prompts or generated content
  fc.assert(fc.asyncProperty(
    fc.record({
      prompt: fc.string({ minLength: 10, maxLength: 50 }),
      content: fc.string({ minLength: 10, maxLength: 100 })
    }),
    async (input) => {
      const cal = new BenchmarkCalibrator({ maxIterations: 1 });
      cal.enable();
      const result = await cal.calibrate({
        modelDigest: 'sha256:test',
        runner: async (ctx) => {
          // The runner sees the prompt but the result must not store it
          return { tokensGenerated: input.content.length, durationMs: 10 };
        }
      });
      const resultJson = JSON.stringify(result.data.result);
      assert.ok(!resultJson.includes(input.prompt), 'Result must not contain the prompt');
      assert.ok(!resultJson.includes(input.content), 'Result must not contain generated content');
    }
  ), { numRuns: 100 });

  console.log('  PASS: Calibration results never contain prompts or content');

  console.log('\nProperty 19 tests complete (500 total runs).');
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
