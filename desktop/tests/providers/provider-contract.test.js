/* eslint-env node */
const assert = require('assert');
const { LlamaServerProvider } = require('../../providers/llama-server-provider');
const { normalizeError, normalizeResponse } = require('../../providers/normalize');
const { requireCapability } = require('../../providers/provider-contract');

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    text: async () => JSON.stringify(value)
  };
}

function malformedJsonResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: async () => '{not-json'
  };
}

async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.stack || error.message}`); process.exitCode = 1; }
}

(async () => {
  console.log('provider contract tests with mocked providers');

  await test('refuses unsupported capabilities before invoking a provider operation', async () => {
    let invoked = false;
    const mockProvider = {
      descriptor: () => ({ id: 'mock', capabilities: ['chat'] }),
      stream: async () => { invoked = true; return { success: true }; }
    };
    const refusal = requireCapability(mockProvider.descriptor(), 'streaming', 'stream', 'corr-capability');
    assert.strictEqual(refusal.error.code, 'PROVIDER_UNSUPPORTED_CAPABILITY');
    assert.strictEqual(refusal.error.retryable, false);
    assert.deepStrictEqual(refusal.error.details, { providerId: 'mock', capability: 'streaming', operation: 'stream' });
    assert.strictEqual(invoked, false);
  });

  await test('normalizes equivalent raw and enveloped provider responses identically', async () => {
    const payload = { content: 'hello', model: 'model.gguf' };
    assert.deepStrictEqual(normalizeResponse(payload, 'corr-response'), {
      success: true, correlationId: 'corr-response', data: payload
    });
    assert.deepStrictEqual(normalizeResponse({ success: true, correlationId: 'wire-correlation', data: payload }, 'corr-response'), {
      success: true, correlationId: 'wire-correlation', data: payload
    });
  });

  await test('propagates caller cancellation without invoking the mocked transport', async () => {
    const controller = new AbortController();
    controller.abort();
    let invoked = false;
    const provider = new LlamaServerProvider({ fetch: async () => {
      invoked = true;
      throw new Error('transport must not be invoked');
    } });
    const result = await provider.chat({ messages: [] }, controller.signal);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'CALLER_CANCELLED');
    assert.strictEqual(result.error.retryable, false);
    assert.strictEqual(invoked, false);
  });

  await test('normalizes mocked health responses and preserves provider identity', async () => {
    const provider = new LlamaServerProvider({ providerId: 'mock-health', fetch: async (url) => {
      assert.strictEqual(url, 'http://127.0.0.1:13434/health');
      return jsonResponse({ status: 'ok' });
    } });
    const result = await provider.health();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.status, 'healthy');
    assert.strictEqual(result.data.providerId, 'mock-health');
  });

  await test('returns a typed protocol error for malformed mocked payloads', async () => {
    const provider = new LlamaServerProvider({ fetch: async () => malformedJsonResponse() });
    const result = await provider.chat({ messages: [] });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'PROVIDER_PROTOCOL');
    assert.strictEqual(result.error.message, 'Provider returned malformed JSON.');
    assert.strictEqual(result.error.retryable, false);
  });

  await test('normalizes authentication failures and redacts credentials from mocked responses', async () => {
    const provider = new LlamaServerProvider({ fetch: async () => jsonResponse({
      error: { message: 'authorization: Bearer super-secret at /Users/alice/model.gguf' }
    }, 401) });
    const result = await provider.chat({ messages: [] });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'PROVIDER_AUTH');
    assert.strictEqual(result.error.retryable, false);
    assert.strictEqual(result.error.message, 'authorization: [REDACTED] at [REDACTED_PATH]');
    assert.ok(!result.error.message.includes('super-secret'));
    assert.ok(!result.error.message.includes('/Users/alice'));
  });

  await test('retains safe provider context while redacting secrets in normalized errors', async () => {
    const result = normalizeError(new Error('api-key: abc123 https://user:pass@example.test /home/alice/model.gguf'), {
      providerId: 'mock-remote', operation: 'chat', code: 'PROVIDER_AUTH', correlationId: 'corr-redaction'
    });
    assert.deepStrictEqual(result, {
      success: false,
      correlationId: 'corr-redaction',
      error: {
        code: 'PROVIDER_AUTH',
        message: 'api-key: [REDACTED] [REDACTED_URL] [REDACTED_PATH]',
        retryable: false,
        recoveryAction: 'Open diagnostics',
        correlationId: 'corr-redaction',
        details: { providerId: 'mock-remote', operation: 'chat' }
      }
    });
  });

  console.log('All provider contract tests completed.');
})();
