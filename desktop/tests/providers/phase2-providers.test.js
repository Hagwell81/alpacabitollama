/* eslint-env node */
/**
 * Phase 2 provider adapter contract tests. Validates that OpenAICompatibleProvider,
 * OllamaProvider, and LMStudioProvider satisfy the same behavioral properties as
 * the Phase 1 LlamaServerProvider for request normalization, cancellation,
 * redaction, health reporting, and stream aggregation.
 *
 * Feature: Phase 2 Provider Adapters (Task 12.1)
 * Requirements: 18.1, 18.3-18.6
 */
const assert = require('assert');
const { OpenAICompatibleProvider } = require('../../providers/openai-compatible-provider');
const { OllamaProvider } = require('../../providers/ollama-provider');
const { LMStudioProvider } = require('../../providers/lmstudio-provider');
const { FeatureGates } = require('../../feature-gates');
const { ProviderRegistry } = require('../../providers/provider-registry');

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Bad Request', text: async () => JSON.stringify(value) };
}

function streamResponse(chunks, status = 200) {
  let index = 0;
  const encoder = new TextEncoder();
  const reader = {
    async read() {
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: encoder.encode(chunks[index++]) };
    },
    releaseLock() {}
  };
  return { ok: status >= 200 && status < 300, status, body: { getReader: () => reader } };
}

async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.stack || error.message}`); process.exitCode = 1; }
}

(async () => {
  console.log('Phase 2 provider adapter tests');

  // --- OpenAICompatibleProvider ---
  await test('OpenAI-compatible: descriptor declares remote origin and api-key auth', async () => {
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', apiKey: 'sk-test' });
    const d = provider.descriptor();
    assert.strictEqual(d.origin, 'remote');
    assert.strictEqual(d.authMode, 'api-key');
    assert.strictEqual(d.id, 'openai-compatible');
  });

  await test('OpenAI-compatible: listModels normalizes OpenAI data array', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com', apiKey: 'sk-test',
      fetch: async () => jsonResponse({ data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }] })
    });
    const result = await provider.listModels();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.models.length, 2);
    assert.strictEqual(result.data.models[0].id, 'gpt-4');
    assert.strictEqual(result.data.models[0].providerId, 'openai-compatible');
  });

  await test('OpenAI-compatible: chat sends Bearer auth and preserves request body', async () => {
    const calls = [];
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com', apiKey: 'sk-secret',
      fetch: async (url, init) => { calls.push({ url, init }); return jsonResponse({ choices: [{ message: { content: 'hi' } }] }); }
    });
    const req = { model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] };
    const result = await provider.chat(req);
    assert.strictEqual(result.success, true);
    assert.strictEqual(calls[0].init.headers.authorization, 'Bearer sk-secret');
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { ...req, stream: false });
  });

  await test('OpenAI-compatible: stream parses OpenAI SSE dialect', async () => {
    const events = [];
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com', apiKey: 'sk-test',
      fetch: async () => streamResponse([
        'data: ' + JSON.stringify({ model: 'gpt-4', choices: [{ delta: { content: 'hello' } }] }) + '\n\n',
        'data: [DONE]\n\n'
      ])
    });
    const result = await provider.stream({ model: 'gpt-4', messages: [] }, (e) => events.push(e));
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.content, 'hello');
    assert.ok(events.some((e) => e.kind === 'complete'));
  });

  await test('OpenAI-compatible: 401 returns PROVIDER_AUTH error', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com', apiKey: 'bad',
      fetch: async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }) })
    });
    const result = await provider.chat({ model: 'gpt-4', messages: [] });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'PROVIDER_AUTH');
  });

  await test('OpenAI-compatible: cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com', apiKey: 'sk-test',
      fetch: async () => { throw new Error('should not reach'); }
    });
    const result = await provider.chat({ model: 'gpt-4', messages: [] }, controller.signal);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'CALLER_CANCELLED');
  });

  // --- OllamaProvider ---
  await test('Ollama: descriptor declares local origin for localhost', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });
    const d = provider.descriptor();
    assert.strictEqual(d.origin, 'local');
    assert.strictEqual(d.authMode, 'none');
  });

  await test('Ollama: listModels normalizes /api/tags response', async () => {
    const provider = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      fetch: async () => jsonResponse({ models: [{ name: 'llama3:8b' }, { name: 'mistral:7b' }] })
    });
    const result = await provider.listModels();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.models.length, 2);
    assert.strictEqual(result.data.models[0].id, 'llama3:8b');
  });

  await test('Ollama: chat sends /api/chat with model and messages', async () => {
    const calls = [];
    const provider = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      fetch: async (url, init) => { calls.push({ url, init }); return jsonResponse({ message: { content: 'hi' }, done: true }); }
    });
    const result = await provider.chat({ model: 'llama3:8b', messages: [{ role: 'user', content: 'hello' }] });
    assert.strictEqual(result.success, true);
    assert.ok(calls[0].url.endsWith('/api/chat'));
    const body = JSON.parse(calls[0].init.body);
    assert.strictEqual(body.model, 'llama3:8b');
    assert.strictEqual(body.stream, false);
  });

  await test('Ollama: stream parses JSON-line dialect (not SSE)', async () => {
    const events = [];
    const provider = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      fetch: async () => streamResponse([
        JSON.stringify({ model: 'llama3:8b', message: { content: 'hel' }, done: false }) + '\n',
        JSON.stringify({ model: 'llama3:8b', message: { content: 'lo' }, done: false }) + '\n',
        JSON.stringify({ model: 'llama3:8b', message: { content: '' }, done: true, done_reason: 'stop' }) + '\n'
      ])
    });
    const result = await provider.stream({ model: 'llama3:8b', messages: [] }, (e) => events.push(e));
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.content, 'hello');
    assert.ok(events.some((e) => e.kind === 'complete'));
  });

  await test('Ollama: cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      fetch: async () => { throw new Error('should not reach'); }
    });
    const result = await provider.chat({ model: 'llama3:8b', messages: [] }, controller.signal);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'CALLER_CANCELLED');
  });

  // --- LMStudioProvider ---
  await test('LMStudio: descriptor declares local origin for localhost', async () => {
    const provider = new LMStudioProvider({ baseUrl: 'http://127.0.0.1:1234' });
    const d = provider.descriptor();
    assert.strictEqual(d.origin, 'local');
    assert.strictEqual(d.authMode, 'none');
  });

  await test('LMStudio: listModels normalizes /v1/models response', async () => {
    const provider = new LMStudioProvider({
      baseUrl: 'http://127.0.0.1:1234',
      fetch: async () => jsonResponse({ data: [{ id: 'local-model.gguf' }] })
    });
    const result = await provider.listModels();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.models[0].id, 'local-model.gguf');
  });

  await test('LMStudio: stream uses OpenAI SSE dialect', async () => {
    const events = [];
    const provider = new LMStudioProvider({
      baseUrl: 'http://127.0.0.1:1234',
      fetch: async () => streamResponse([
        'data: ' + JSON.stringify({ model: 'local.gguf', choices: [{ delta: { content: 'hi' } }] }) + '\n\n',
        'data: [DONE]\n\n'
      ])
    });
    const result = await provider.stream({ model: 'local.gguf', messages: [] }, (e) => events.push(e));
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.content, 'hi');
  });

  // --- Registry gating ---
  await test('Registry: Phase 2 providers disabled when phase1 not passed', async () => {
    const gates = new FeatureGates({ phase1ExitCriteriaPassed: false });
    const registry = new ProviderRegistry({ featureGates: gates });
    const remote = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', apiKey: 'k' });
    registry.register(remote, { remote: true });
    const status = registry.status('openai-compatible');
    assert.strictEqual(status.status, 'disabled');
  });

  await test('Registry: Phase 2 providers available when phase1 passed and opt-in enabled', async () => {
    const gates = new FeatureGates({ phase1ExitCriteriaPassed: true, phase2RemoteProviders: true });
    const registry = new ProviderRegistry({ featureGates: gates, remoteProviderOptIn: true });
    const remote = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', apiKey: 'k' });
    registry.register(remote, { remote: true });
    const status = registry.status('openai-compatible');
    assert.strictEqual(status.status, 'available');
  });

  await test('Registry: local Ollama/LMStudio not blocked by remote opt-in', async () => {
    const gates = new FeatureGates({ phase1ExitCriteriaPassed: true, phase2RemoteProviders: true });
    const registry = new ProviderRegistry({ featureGates: gates, remoteProviderOptIn: true });
    const ollama = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });
    registry.register(ollama);
    const status = registry.status('ollama');
    assert.strictEqual(status.status, 'available');
  });

  // --- Error redaction ---
  await test('Error redaction: provider errors do not leak credentials', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com', apiKey: 'sk-super-secret-key',
      fetch: async () => ({ ok: false, status: 500, statusText: 'Internal Server Error', text: async () => JSON.stringify({ error: { message: 'api_key=sk-super-secret-key failed at /home/user/models.gguf' } }) })
    });
    const result = await provider.chat({ model: 'gpt-4', messages: [] });
    assert.strictEqual(result.success, false);
    assert.ok(!result.error.message.includes('sk-super-secret-key'));
    assert.ok(!result.error.message.includes('/home/user/models.gguf'));
  });

  console.log('\nPhase 2 provider tests complete.');
})();
