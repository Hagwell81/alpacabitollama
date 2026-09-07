/* eslint-env node */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const fc = require('fast-check');
const { RuntimeStateMachine, RUNTIME_STATE_ADJACENCY } = require('../../runtime/runtime-state-machine');
const { RuntimeCoordinator } = require('../../runtime/runtime-coordinator');

const runtimeStates = Object.keys(RUNTIME_STATE_ADJACENCY);
const transitionTargets = fc.array(fc.constantFrom(...runtimeStates), { minLength: 1, maxLength: 40 });
const operationCommands = fc.record({
  targets: transitionTargets,
  staleCompletion: fc.boolean()
});

function createCoordinator(startRelease) {
  return new RuntimeCoordinator({
    lifecycle: {
      start: () => new Promise((resolve) => { startRelease.resolve = resolve; }),
      stop: async () => true
    },
    registerLocalProvider: false
  });
}

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 1: Lifecycle transition and operation safety
// **Validates: Requirements 1.1, 1.3, 1.5, 2.5, 6.7**

test('preserves lifecycle adjacency and rejects invalid or stale operations without mutation', () => {
  fc.assert(
    fc.property(operationCommands, ({ targets, staleCompletion }) => {
      const diagnostics = [];
      const machine = new RuntimeStateMachine({ historyLimit: targets.length + 1, onDiagnostic: (event) => diagnostics.push(event) });

      targets.forEach((target, index) => {
        const before = machine.snapshot();
        const beforeHistory = machine.getHistory();
        const beforeReason = machine.reason;
        const beforeDiagnostics = diagnostics.length;
        const reasonCode = `property-transition-${index}`;

        if (staleCompletion && index === targets.length - 1) {
          const staleEpoch = machine.beginOperation();
          machine.beginOperation();
          const result = machine.transition(target, { epoch: staleEpoch, reasonCode });

          assert.strictEqual(result.accepted, false);
          assert.strictEqual(machine.state, before.state);
          assert.deepStrictEqual(machine.reason, beforeReason);
          assert.strictEqual(machine.operationEpoch, before.operationEpoch + 2);
          assert.deepStrictEqual(machine.getHistory(), beforeHistory);
          assert.strictEqual(diagnostics.length, beforeDiagnostics + 1);
          assert.strictEqual(result.error.code, 'INVALID_TRANSITION');
          assert.strictEqual(result.diagnostic.reasonCode, 'stale-operation-epoch');
          return;
        }

        const expectedValid = RUNTIME_STATE_ADJACENCY[before.state].includes(target);
        const epoch = machine.beginOperation();
        const result = machine.transition(target, { epoch, reasonCode, at: index });

        assert.strictEqual(result.accepted, expectedValid);
        if (expectedValid) {
          assert.strictEqual(result.state, target);
          assert.strictEqual(machine.getHistory().length, beforeHistory.length + 1);
          assert.deepStrictEqual(machine.getHistory().at(-1), result.reason);
          assert.deepStrictEqual(result.reason, {
            from: before.state,
            to: target,
            reasonCode,
            correlationId: result.reason.correlationId,
            at: index,
            cancellable: false
          });
        } else {
          assert.deepStrictEqual(machine.snapshot(), { ...before, operationEpoch: epoch });
          assert.deepStrictEqual(machine.getHistory(), beforeHistory);
          assert.strictEqual(diagnostics.length, beforeDiagnostics + 1);
          assert.strictEqual(result.error.code, 'INVALID_TRANSITION');
          assert.deepStrictEqual(result.diagnostic.attemptedTransition, { from: before.state, to: target });
        }
      });

      const history = machine.getHistory();
      history.forEach((reason) => {
        assert.ok(RUNTIME_STATE_ADJACENCY[reason.from].includes(reason.to));
      });
    }),
    { numRuns: 100 }
  );
});

test('prevents a superseded start completion from overwriting stop state', async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (started) => {
      const startRelease = {};
      const coordinator = createCoordinator(startRelease);
      const starting = coordinator.start();
      await new Promise((resolve) => setImmediate(resolve));

      const stopping = coordinator.stop();
      startRelease.resolve(started);

      assert.strictEqual(await starting, false);
      assert.strictEqual(await stopping, true);
      assert.strictEqual(coordinator.snapshot().runtime.state, 'idle');
      assert.strictEqual(coordinator.snapshot().compatibility.serverRunning, false);
    }),
    { numRuns: 100 }
  );
});
