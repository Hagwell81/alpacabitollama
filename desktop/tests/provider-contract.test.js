/* eslint-env node */
const assert = require('assert');
const providers = require('../providers');

function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.message}`); process.exitCode = 1; }
}

console.log('provider boundary contract tests');

test('normalizes descriptor, capabilities, status, and model listing', () => {
  const descriptor = providers.createProviderDescriptor({ id: 'local', capabilities: ['chat', 'chat', 'unknown'] });
  assert.deepStrictEqual(descriptor, { id: 'local', groupId: 'local', name: 'local', origin: 'loopback', authMode: 'none', capabilities: ['chat'] });
  assert.strictEqual(providers.requireCapability(descriptor, 'streaming', 'stream').error.code, 'PROVIDER_UNSUPPORTED_CAPABILITY');
  assert.deepStrictEqual(providers.normalizeListing({ models: [{ id: 'm1' }], nextCursor: 'next' }, 'corr-list'), {
    success: true, correlationId: 'corr-list', data: { models: [{ id: 'm1' }], nextCursor: 'next' }
  });
  assert.strictEqual(providers.createProviderStatus({ providerId: 'local', status: 'ready' }).status, 'ready');
});

test('normalizes readiness, health, chat, stream, cancellation, and capabilities results', () => {
  assert.deepStrictEqual(providers.normalizeReadiness({ providerId: 'local', modelId: 'm1', state: 'ready' }, 'r').data.model, { id: 'm1', providerId: 'local' });
  assert.strictEqual(providers.normalizeHealth({ status: 'healthy', providerId: 'local' }, 'h').data.status, 'healthy');
  assert.deepStrictEqual(providers.normalizeResponse({ content: 'hello' }, 'c'), { success: true, correlationId: 'c', data: { content: 'hello' } });
  assert.strictEqual(providers.normalizeStreamResult({ status: 'cancelled', events: [{ kind: 'cancelled' }] }, 's').data.status, 'cancelled');
  assert.deepStrictEqual(providers.normalizeCancellation({}, 'x').data, { cancelled: true });
  assert.deepStrictEqual(providers.normalizeCapabilities({ streaming: true }, 'caps').data, { streaming: true });
});

test('returns typed, redacted provider errors with operation context', () => {
  const result = providers.normalizeError(new Error('authorization: Bearer super-secret https://user:pass@example.test /Users/alice/model.gguf'), {
    providerId: 'remote', operation: 'chat', code: 'PROVIDER_AUTH', correlationId: 'corr-error'
  });
  assert.deepStrictEqual(result, {
    success: false, correlationId: 'corr-error',
    error: {
      code: 'PROVIDER_AUTH', message: 'authorization: [REDACTED] [REDACTED_URL] [REDACTED_PATH]', retryable: false,
      recoveryAction: 'Open diagnostics', correlationId: 'corr-error', details: { providerId: 'remote', operation: 'chat' }
    }
  });
});

test('preserves task 1.1 envelope and stream shapes', () => {
  assert.deepStrictEqual(providers.successEnvelope({ ok: true }, 'corr'), { success: true, correlationId: 'corr', data: { ok: true } });
  assert.deepStrictEqual(providers.createStreamEvent('content', 'hello'), { kind: 'content', text: 'hello' });
});

console.log('All provider contract tests completed.');
