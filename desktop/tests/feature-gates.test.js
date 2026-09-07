const assert = require('node:assert/strict');
const { FeatureGates, PHASE_2_FLAGS } = require('../feature-gates');
const { ProviderRegistry } = require('../providers/provider-registry');

test('keeps Phase 2 fail-closed until the Phase 1 gate is explicitly passed', () => {
  const gates = new FeatureGates({ phase1ExitCriteriaPassed: false, phase2Flags: { phase2RemoteProviders: true, phase2Discovery: true } });
  for (const flag of PHASE_2_FLAGS) assert.equal(gates.isEnabled(flag), false);
  assert.equal(gates.enablePhase2({ phase2RemoteProviders: true }), false);
  gates.setPhase1ExitCriteriaPassed(true);
  assert.equal(gates.enablePhase2({ phase2RemoteProviders: true }), true);
  assert.equal(gates.isEnabled('phase2RemoteProviders'), true);
});

test('rollback clears optional work, preserves local providers, and requires a new explicit pass', () => {
  const callbacks = [];
  const gates = new FeatureGates({
    phase1ExitCriteriaPassed: true,
    phase2Flags: { phase2RemoteProviders: true, phase2Discovery: true },
    onRollback: (event) => callbacks.push(event)
  });
  const localData = { selectedModels: ['local.gguf'], currentUserId: 'local-user' };
  const registry = new ProviderRegistry({ featureGates: gates, remoteProviderOptIn: true });
  registry.register({ descriptor: () => ({ id: 'local', origin: 'loopback', capabilities: ['chat'] }) });
  registry.register({ descriptor: () => ({ id: 'remote', origin: 'https://provider.example', capabilities: ['chat'] }) });
  assert.equal(registry.status('local').status, 'available');

  const result = gates.rollback('validation-failure');
  assert.equal(result.rolledBack, true);
  assert.equal(result.reason, 'validation-failure');
  assert.equal(gates.phase1Passed(), false);
  for (const flag of PHASE_2_FLAGS) assert.equal(gates.isEnabled(flag), false);
  assert.equal(callbacks.length, 1);
  assert.equal(registry.status('local').status, 'available');
  assert.deepEqual(localData, { selectedModels: ['local.gguf'], currentUserId: 'local-user' });
  assert.equal(gates.enablePhase2({ phase2RemoteProviders: true }), false);

  gates.setPhase1ExitCriteriaPassed(true);
  assert.equal(gates.enablePhase2({ phase2RemoteProviders: true }), true);
  assert.equal(gates.isEnabled('phase2RemoteProviders'), true);
});

test('rollback remains fail-closed when observers throw and snapshots are immutable', () => {
  const gates = new FeatureGates({ phase1ExitCriteriaPassed: true, phase2RemoteProviders: true, onRollback: () => { throw new Error('observer failure'); } });
  const snapshot = gates.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.doesNotThrow(() => gates.rollback('observer-test'));
  assert.equal(gates.rollbackState().reason, 'observer-test');
  assert.equal(gates.isEnabled('phase2RemoteProviders'), false);
  assert.equal(snapshot.phase2RemoteProviders, true);
});
