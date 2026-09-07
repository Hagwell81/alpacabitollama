/* eslint-env node */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const { EnsureReadyRegistry } = require('../runtime/ensure-ready-registry');

const request = (modelId, extra = {}) => ({ providerId: 'llama-server', modelId, ...extra });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

 describe('EnsureReadyRegistry', () => {
  it('coalesces identical provider/model requests into one executor operation', async () => {
    let calls = 0;
    let release;
    const registry = new EnsureReadyRegistry({
      executor: async (_request, context) => {
        calls += 1;
        await new Promise((resolve) => { release = resolve; });
        return { ready: true, operationId: context.operationId };
      }
    });
    const first = registry.ensureReady(request('model-a'));
    await tick();
    const second = registry.ensureReady(request('model-a'));
    release();
    const [one, two] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(one, two);
    assert.equal(registry.size, 0);
  });

  it('detaches one cancelled caller without cancelling shared work', async () => {
    let signal;
    let release;
    const registry = new EnsureReadyRegistry({
      executor: async (_request, context) => {
        signal = context.signal;
        await new Promise((resolve) => { release = resolve; });
        return 'ready';
      }
    });
    const controller = new AbortController();
    const cancelled = registry.ensureReady(request('model-a', { signal: controller.signal }));
    const survivor = registry.ensureReady(request('model-a'));
    await tick();
    controller.abort();
    await assert.rejects(cancelled, (error) => error.code === 'CALLER_CANCELLED');
    assert.equal(signal.aborted, false);
    release();
    assert.equal(await survivor, 'ready');
  });

  it('cancels shared work only after the last caller detaches when safe', async () => {
    let signal;
    const registry = new EnsureReadyRegistry({
      executor: async (_request, context) => {
        signal = context.signal;
        await new Promise((resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = registry.ensureReady(request('model-a', { signal: firstController.signal }));
    const second = registry.ensureReady(request('model-a', { signal: secondController.signal }));
    await tick();
    firstController.abort();
    secondController.abort();
    await assert.rejects(first, (error) => error.code === 'CALLER_CANCELLED');
    await assert.rejects(second, (error) => error.code === 'CALLER_CANCELLED');
    assert.equal(signal.aborted, true);
  });

  it('serializes different model mutations in FIFO order and shares one local-server mutex', async () => {
    const started = [];
    const releases = [];
    const registry = new EnsureReadyRegistry({
      executor: async (input) => {
        started.push(input.modelId);
        await new Promise((resolve) => releases.push(resolve));
        return input.modelId;
      }
    });
    const first = registry.ensureReady(request('model-a'));
    const second = registry.ensureReady(request('model-b'));
    const third = registry.ensureReady(request('model-c'));
    await tick();
    assert.deepEqual(started, ['model-a']);
    releases.shift()();
    await tick();
    assert.deepEqual(started, ['model-a', 'model-b']);
    releases.shift()();
    await tick();
    assert.deepEqual(started, ['model-a', 'model-b', 'model-c']);
    releases.shift()();
    assert.deepEqual(await Promise.all([first, second, third]), ['model-a', 'model-b', 'model-c']);
  });

  it('does not cancel a mutation marked non-cancellable after its last caller detaches', async () => {
    let release;
    let signal;
    const registry = new EnsureReadyRegistry({
      executor: async (_request, context) => {
        signal = context.signal;
        await new Promise((resolve) => { release = resolve; });
        return 'finished';
      }
    });
    const controller = new AbortController();
    const pending = registry.ensureReady(request('model-a', { signal: controller.signal, cancellable: false }));
    await tick();
    controller.abort();
    await assert.rejects(pending, (error) => error.code === 'CALLER_CANCELLED');
    assert.equal(signal.aborted, false);
    release();
  });
});
