const assert = require('node:assert/strict');
const { RuntimeCoordinator } = require('../../runtime/runtime-coordinator');

test('runtime integration preserves local provider and coordinates readiness', async () => {
  const calls = [];
  const coordinator = new RuntimeCoordinator({
    lifecycle: { start: async () => { calls.push('start'); return true; }, stop: async () => true },
    registerLocalProvider: false,
    localProvider: {
      descriptor: { id: 'local-llama-server', origin: 'loopback', capabilities: ['readiness'] },
      ensureReady: async ({ id }) => ({ success: true, providerId: 'local-llama-server', modelId: id, state: 'ready' })
    }
  });
  const result = await coordinator.ensureReady({ providerId: 'local-llama-server', modelIdentity: 'test-model' });
  assert.equal(result.success, true);
  assert.equal(calls[0], 'start');
  const snapshot = coordinator.snapshot();
  assert.equal(snapshot.runtime.state, 'ready');
  assert.equal(snapshot.compatibility.activeModel, 'test-model');
  assert.equal(snapshot.providers.some((provider) => provider.providerId === 'local-llama-server'), true);
  assert.equal(snapshot.readiness.pending, 0);
});

test('failed Phase 1 evaluation rolls back optional work without removing local providers', async () => {
  const coordinator = new RuntimeCoordinator({ lifecycle: { start: async () => true, stop: async () => true } });
  const before = coordinator.providerStatuses();
  const rollback = coordinator.rollbackOptionalRuntime('integration-test');
  assert.equal(rollback.reason, 'integration-test');
  assert.deepEqual(coordinator.providerStatuses(), before);
  assert.equal(coordinator.snapshot().rollback.reason, 'integration-test');
});
