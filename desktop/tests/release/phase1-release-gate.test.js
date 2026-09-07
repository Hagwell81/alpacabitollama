const assert = require('node:assert/strict');
const { FeatureGates } = require('../../feature-gates');
const { RuntimeCoordinator } = require('../../runtime/runtime-coordinator');
const { Phase1ExitEvaluator } = require('../../runtime/phase1-exit-evaluator');
const { createPhase1CheckMap } = require('../../runtime/phase1-checks');

function evaluator() {
  const coordinator = new RuntimeCoordinator({ lifecycle: { start: async () => true, stop: async () => true } });
  const gates = new FeatureGates();
  return new Phase1ExitEvaluator({ featureGates: gates, checkMap: createPhase1CheckMap({ coordinator, diagnosticsService: { getHealthProjection: () => ({ status: 'healthy' }) }, applicationRoot: require('node:path').resolve(__dirname, '../..') }) });
}

test('release gate requires every trusted Phase 1 result', async () => {
  const report = await evaluator().evaluate({ releaseResults: { artifactTrust: true, migrationRecovery: true, cancellationPrivacy: true, resourceLimits: true, regressionSuite: true } });
  assert.equal(report.passed, true);
  assert.equal(report.failedChecks.length, 0);
});

test('release gate remains closed when any release result is false', async () => {
  const report = await evaluator().evaluate({ releaseResults: { artifactTrust: true, migrationRecovery: false, cancellationPrivacy: true, resourceLimits: true, regressionSuite: true } });
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((check) => check.name === 'migrationRecovery').passed, false);
});
