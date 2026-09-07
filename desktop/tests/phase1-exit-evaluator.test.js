/* eslint-env node */
const assert = require('node:assert/strict');
const { FeatureGates } = require('../feature-gates');
const { Phase1ExitEvaluator } = require('../runtime/phase1-exit-evaluator');

test('Phase1ExitEvaluator passes only when every named check passes', async () => {
  const gates = new FeatureGates();
  const order = [];
  const evaluator = new Phase1ExitEvaluator({
    featureGates: gates,
    checkMap: {
      first: () => { order.push('first'); return true; },
      second: () => { order.push('second'); return { passed: true, details: { stable: true } }; }
    }
  });
  const report = await evaluator.evaluate();
  assert.equal(report.passed, true);
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(gates.phase1Passed(), true);
  assert.equal(report.failedChecks.length, 0);
});

test('Phase1ExitEvaluator normalizes failures and rolls back optional flags', async () => {
  const gates = new FeatureGates({ phase1ExitCriteriaPassed: true, phase2RemoteProviders: true });
  const evaluator = new Phase1ExitEvaluator({
    featureGates: gates,
    checkMap: {
      healthy: () => true,
      broken: () => { throw new Error('secret/path should be bounded'); },
      rejected: () => ({ passed: false, reason: 'not ready', details: { retryable: true } })
    }
  });
  const report = await evaluator.evaluate();
  assert.equal(report.passed, false);
  assert.deepEqual(report.failedChecks.map((item) => item.name), ['broken', 'rejected']);
  assert.equal(gates.phase1Passed(), false);
  assert.equal(gates.isEnabled('phase2RemoteProviders'), false);
  assert.equal(report.failedChecks[0].reason, 'secret/path should be bounded');
  assert.equal(Object.isFrozen(report), true);
});

test('Phase1ExitEvaluator rejects duplicate or invalid checks', () => {
  const gates = new FeatureGates();
  const evaluator = new Phase1ExitEvaluator({ featureGates: gates });
  assert.throws(() => evaluator.register('', () => true));
  evaluator.register('one', () => true);
  assert.throws(() => evaluator.register('one', () => true));
});
