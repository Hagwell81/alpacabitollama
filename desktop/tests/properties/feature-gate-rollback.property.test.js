/* eslint-env node */
const assert = require('node:assert/strict');
const test = globalThis.test;
const fc = require('fast-check');
const { FeatureGates, PHASE_2_FLAGS } = require('../../feature-gates');

// Feature: alpacabitollama-runtime-and-ui-enhancements, rollback safety property
// **Validates: Requirements 16.5, 18.5, 20.6**

test('generated optional flag combinations always roll back to a fail-closed local-safe state', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { minLength: PHASE_2_FLAGS.length, maxLength: PHASE_2_FLAGS.length }), (values) => {
      const options = { phase1ExitCriteriaPassed: true };
      PHASE_2_FLAGS.forEach((flag, index) => { options[flag] = values[index]; });
      const gates = new FeatureGates(options);
      const rollback = gates.rollback('generated-failure');
      assert.equal(rollback.rolledBack, true);
      assert.equal(gates.phase1Passed(), false);
      PHASE_2_FLAGS.forEach((flag) => assert.equal(gates.isEnabled(flag), false));
      assert.equal(gates.enablePhase2(Object.fromEntries(PHASE_2_FLAGS.map((flag) => [flag, true]))), false);
    }),
    { numRuns: 120 }
  );
});
