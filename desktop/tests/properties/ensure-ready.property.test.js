/* eslint-env node */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const fc = require('fast-check');
const { EnsureReadyRegistry } = require('../../runtime/ensure-ready-registry');

const providerIdArbitrary = fc.constantFrom('llama-server', 'llama_server', 'local');
const modelIdArbitrary = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 20 });
const requestArbitrary = fc.record({
  providerId: providerIdArbitrary,
  modelId: modelIdArbitrary
});
const distinctRequestsArbitrary = fc.uniqueArray(fc.integer({ min: 0, max: 100000 }), {
  minLength: 2,
  maxLength: 5
}).map((modelIds) => modelIds.map((modelId) => ({ providerId: 'llama-server', modelId: `model-${modelId}` })));

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('Timed out waiting for the readiness operation');
}

function requestFor(identity, extra = {}) {
  return { ...identity, ...extra };
}

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 2: EnsureReady coalescing and cancellation isolation
// **Validates: Requirements 2.1, 2.2, 2.3**

test('coalesces every identical-key batch into one operation and settles each caller independently', async () => {
  await fc.assert(
    fc.asyncProperty(
      requestArbitrary,
      fc.integer({ min: 2, max: 5 }),
      async (identity, callerCount) => {
        let executions = 0;
        let release;
        const registry = new EnsureReadyRegistry({
          executor: async (_request, context) => {
            executions += 1;
            await new Promise((resolve) => { release = resolve; });
            return { modelId: context.modelIdentity, operationId: context.operationId };
          }
        });
        const callers = Array.from({ length: callerCount }, () => registry.ensureReady(requestFor(identity)));
        await waitFor(() => typeof release === 'function');
        release();
        const results = await Promise.all(callers);

        assert.equal(executions, 1);
        assert.equal(new Set(results.map((result) => result.operationId)).size, 1);
        assert.deepEqual(results.map((result) => result.modelId), Array(callerCount).fill(identity.modelId));
      }
    ),
    { numRuns: 100 }
  );
});

test('isolates one cancelled caller while the surviving callers settle normally', async () => {
  await fc.assert(
    fc.asyncProperty(requestArbitrary, async (identity) => {
      let release;
      let signal;
      const registry = new EnsureReadyRegistry({
        executor: async (_request, context) => {
          signal = context.signal;
          await new Promise((resolve) => { release = resolve; });
          return 'ready';
        }
      });
      const cancelledController = new AbortController();
      const cancelled = registry.ensureReady(requestFor(identity, { signal: cancelledController.signal }));
      const survivor = registry.ensureReady(requestFor(identity));
      await waitFor(() => typeof release === 'function');
      cancelledController.abort();

      await assert.rejects(cancelled, (error) => error.code === 'CALLER_CANCELLED');
      assert.equal(signal.aborted, false);
      release();
      assert.equal(await survivor, 'ready');
    }),
    { numRuns: 100 }
  );
});

test('cancels shared work when the final caller detaches', async () => {
  await fc.assert(
    fc.asyncProperty(requestArbitrary, async (identity) => {
      let signal;
      const registry = new EnsureReadyRegistry({
        executor: async (_request, context) => {
          signal = context.signal;
          await new Promise((resolve, reject) => {
            context.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
          });
        }
      });
      const controller = new AbortController();
      const pending = registry.ensureReady(requestFor(identity, { signal: controller.signal }));
      await waitFor(() => Boolean(signal));
      controller.abort();

      await assert.rejects(pending, (error) => error.code === 'CALLER_CANCELLED');
      assert.equal(signal.aborted, true);
      await waitFor(() => registry.size === 0);
    }),
    { numRuns: 100 }
  );
});

test('serializes every different-key mutation in FIFO order', async () => {
  await fc.assert(
    fc.asyncProperty(distinctRequestsArbitrary, async (identities) => {
      const started = [];
      const releases = [];
      const registry = new EnsureReadyRegistry({
        executor: async (request) => {
          started.push(request.modelId);
          await new Promise((resolve) => releases.push(resolve));
          return request.modelId;
        }
      });
      const pending = identities.map((identity) => registry.ensureReady(requestFor(identity)));

      for (let index = 0; index < identities.length; index += 1) {
        await waitFor(() => started.length >= index + 1);
        assert.deepEqual(started, identities.slice(0, started.length).map(({ modelId }) => modelId));
        releases.shift()();
      }

        assert.deepEqual(await Promise.all(pending), identities.map(({ modelId }) => modelId));
      }),
      { numRuns: 100 }
    );
  }, 30000);
