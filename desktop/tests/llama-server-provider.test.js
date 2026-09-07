/* eslint-env node */
const assert = require('assert');
const { LlamaServerProvider } = require('../providers/llama-server-provider');

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
  console.log('llama-server provider adapter tests');
  await test('uses local defaults and preserves the OpenAI request body', async () => {
    const calls = [];
    const provider = new LlamaServerProvider({ fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ id: 'chatcmpl-1', choices: [{ message: { content: 'hello' } }] });
    } });
    const request = {
      model: 'local.gguf', messages: [{ role: 'user', content: 'hi', reasoning_content: 'prior' }], stream: false,
      return_progress: true, reasoning_format: 'auto', tools: [{ type: 'function' }], temperature: 0.2,
      max_tokens: -1, top_k: 40, repeat_penalty: 1.1, custom_parameter: 'kept'
    };
    const result = await provider.chat(request);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), request);
    assert.strictEqual(calls[0].url, 'http://127.0.0.1:13434/v1/chat/completions');
  });

  await test('normalizes health, models, and slots without leaving loopback', async () => {
    const urls = [];
    const provider = new LlamaServerProvider({ fetch: async (url) => {
      urls.push(url);
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' });
      if (url.includes('/models')) return jsonResponse({ data: [{ id: 'model.gguf' }] });
      return jsonResponse([{ id: 0, is_processing: false }]);
    } });
    assert.strictEqual((await provider.health()).data.status, 'healthy');
    assert.strictEqual((await provider.listModels()).data.models[0].id, 'model.gguf');
    assert.strictEqual(await provider.areAllSlotsIdle('model.gguf'), true);
    assert.deepStrictEqual(urls, [
      'http://127.0.0.1:13434/health',
      'http://127.0.0.1:13434/v1/models',
      'http://127.0.0.1:13434/slots?model=model.gguf'
    ]);
  });

  await test('emits content, reasoning, tools, model, timing, and one completion event', async () => {
    const events = [];
    const provider = new LlamaServerProvider({ fetch: async (_url, init) => {
      assert.strictEqual(JSON.parse(init.body).stream, true);
      return streamResponse([
        ': keep-alive\n\n',
        'data: ' + JSON.stringify({ model: 'model.gguf', choices: [{ delta: { reasoning_content: 'think ' } }] }) + '\n\n',
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hello', tool_calls: [{ index: 0, function: { name: 'fn' } }] } }], timings: { predicted_n: 1 } }) + '\n\n',
        'data: [DONE]\n\n'
      ]);
    } });
    const result = await provider.stream({ messages: [], model: 'model.gguf' }, (event) => events.push(event));
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(events.map((event) => event.kind), ['heartbeat', 'model', 'reasoning', 'timings', 'content', 'tool-progress', 'complete']);
    assert.strictEqual(result.data.content, 'hello');
    assert.strictEqual(result.data.reasoningContent, 'think ');
    assert.strictEqual(events.filter((event) => event.kind === 'complete').length, 1);
  });

  await test('returns a caller-cancelled result and does not classify it as a provider failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new LlamaServerProvider({ fetch: async () => { throw new Error('must not fetch'); } });
    const result = await provider.chat({ messages: [] }, controller.signal);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'CALLER_CANCELLED');
    assert.strictEqual(result.error.retryable, false);
  });
})();
