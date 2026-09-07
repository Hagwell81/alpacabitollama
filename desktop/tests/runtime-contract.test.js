/* eslint-env node */
const assert = require('assert');
const runtime = require('../runtime');
const providers = require('../providers');

function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.message}`); process.exitCode = 1; }
}

console.log('runtime/provider contract tests');

test('envelopes contain correlation identity and safe error fields', () => {
  const ok = runtime.successEnvelope({ value: 1 }, 'corr-success');
  assert.deepStrictEqual(ok, { success: true, correlationId: 'corr-success', data: { value: 1 } });
  const failed = runtime.errorEnvelope({ code: 'X', message: 'safe', retryable: true, recoveryAction: 'Retry', correlationId: 'corr-error', details: { stage: 'health', secret: { hidden: true } } });
  assert.strictEqual(failed.success, false);
  assert.deepStrictEqual(failed.error.details, { stage: 'health' });
  assert.strictEqual(failed.correlationId, 'corr-error');
});

test('runtime contract exposes exactly eight public states', () => {
  assert.deepStrictEqual(runtime.RUNTIME_STATES, ['idle', 'acquiring', 'starting', 'ready', 'busy', 'stopping', 'failed', 'cancelling']);
  assert.strictEqual(runtime.isRuntimeState('healthChecking'), false);
});

test('provider/model references and stream events are normalized', () => {
  assert.deepStrictEqual(providers.createProviderRef({ id: 'local' }), { id: 'local', groupId: 'local' });
  assert.deepStrictEqual(runtime.createModelRef({ id: 'model', providerId: 'local' }), { id: 'model', providerId: 'local' });
  assert.deepStrictEqual(providers.createStreamEvent('content', 'hello'), { kind: 'content', text: 'hello' });
  assert.deepStrictEqual(providers.createStreamEvent('cancelled'), { kind: 'cancelled' });
});

console.log('All contract tests completed.');
