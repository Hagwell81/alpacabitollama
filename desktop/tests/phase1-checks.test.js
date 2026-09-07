const assert = require('node:assert/strict');
const { FeatureGates } = require('../feature-gates');
const { RuntimeCoordinator } = require('../runtime/runtime-coordinator');
const { createPhase1CheckMap } = require('../runtime/phase1-checks');
const { Phase1ExitEvaluator } = require('../runtime/phase1-exit-evaluator');

function setup() {
  const coordinator = new RuntimeCoordinator({ lifecycle: { start: async () => true, stop: async () => true } });
  const diagnosticsService = { getHealthProjection: () => ({ status: 'healthy' }) };
  const gates = new FeatureGates();
  return { coordinator, diagnosticsService, gates };
}

test('production Phase 1 checks do not hard-code compatibility or trust', async () => {
  const { coordinator, diagnosticsService, gates } = setup();
  const evaluator = new Phase1ExitEvaluator({ featureGates: gates, checkMap: createPhase1CheckMap({ coordinator, diagnosticsService, applicationRoot: __dirname + '/..' }) });
  const report = await evaluator.evaluate({ releaseResults: {
    artifactTrust: true, migrationRecovery: true, cancellationPrivacy: true, resourceLimits: true, regressionSuite: true
  } });
  assert.equal(report.checks.find((check) => check.name === 'artifactTrust').passed, true);
  assert.equal(report.checks.find((check) => check.name === 'compatibilityAliases').passed, true);
  assert.equal(report.passed, true);
  assert.equal(gates.phase1Passed(), true);
});

test('production Phase 1 checks fail closed when trusted release evidence is absent', async () => {
  const { coordinator, diagnosticsService, gates } = setup();
  const evaluator = new Phase1ExitEvaluator({ featureGates: gates, checkMap: createPhase1CheckMap({ coordinator, diagnosticsService, applicationRoot: __dirname + '/..' }) });
  const report = await evaluator.evaluate();
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((check) => check.name === 'artifactTrust').passed, false);
  assert.equal(gates.phase1Passed(), false);
});
