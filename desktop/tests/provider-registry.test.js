/* eslint-env node */
const assert = require('assert');
const { ProviderRegistry } = require('../providers/provider-registry');
const { FeatureGates } = require('../feature-gates');

function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.message}`); process.exitCode = 1; }
}

console.log('provider registry tests');

test('registers local providers without probing or requiring remote opt-in', () => {
  let calls = 0;
  const local = {
    descriptor: () => ({ id: 'local', name: 'Local llama-server', origin: 'loopback', capabilities: ['chat', 'streaming'] }),
    health: async () => { calls += 1; return { status: 'healthy' }; }
  };
  const registry = new ProviderRegistry();
  registry.register(local);
  assert.strictEqual(calls, 0);
  assert.strictEqual(registry.status('local').status, 'available');
  assert.strictEqual(registry.canUse('local', 'chat'), true);
  assert.strictEqual(registry.canUse('local', 'model-listing'), false);
});

test('keeps an unconfigured remote provider visible but disabled', () => {
  const remote = { descriptor: () => ({ id: 'remote', origin: 'https://provider.example', capabilities: ['chat'] }) };
  const registry = new ProviderRegistry({ phase1ExitCriteriaPassed: true, phase2Flags: { phase2RemoteProviders: true } });
  registry.register(remote);
  assert.strictEqual(registry.status('remote').status, 'disabled');
  assert.strictEqual(registry.status('remote').message, 'Remote providers require explicit opt-in.');
  assert.strictEqual(registry.capabilityError('remote', 'chat').error.code, 'PROVIDER_DISABLED');
});

test('does not enable Phase 2 or remote providers before the Phase 1 gate', () => {
  const remote = { descriptor: () => ({ id: 'remote', origin: 'https://provider.example', capabilities: ['chat'] }) };
  const registry = new ProviderRegistry({ remoteProviderOptIn: true, phase1ExitCriteriaPassed: false, phase2Flags: { phase2RemoteProviders: true } });
  registry.register(remote);
  assert.strictEqual(registry.flags().phase1Exit, 'pending');
  assert.strictEqual(registry.status('remote').status, 'disabled');
  assert.strictEqual(registry.capabilityError('remote', 'chat').error.code, 'PROVIDER_DISABLED');
});

test('allows an explicitly opted-in remote provider only after Phase 1 passes', () => {
  const gates = new FeatureGates({ phase1ExitCriteriaPassed: true, phase2RemoteProviders: true });
  const registry = new ProviderRegistry({ featureGates: gates, remoteProviderOptIn: true });
  registry.register({ descriptor: () => ({ id: 'remote', origin: 'https://provider.example', capabilities: ['chat'] }) });
  assert.strictEqual(registry.status('remote').status, 'available');
  assert.strictEqual(registry.canUse('remote', 'chat'), true);
});

test('projects safe provider status and phase flags without invoking providers', () => {
  const registry = new ProviderRegistry();
  registry.register({ descriptor: () => ({ id: 'local', capabilities: ['chat'] }) });
  registry.setStatus('local', { status: 'ready', message: 'ready' });
  assert.deepStrictEqual(registry.projectStatus(), [{ providerId: 'local', status: 'ready', message: 'ready' }]);
  assert.strictEqual(registry.flags().phase2RemoteProviders, false);
});

console.log('All provider registry tests completed.');
