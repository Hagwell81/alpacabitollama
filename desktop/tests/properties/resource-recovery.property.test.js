/* eslint-env node */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const fc = require('fast-check');
const {
  ModelResourceManager,
  ModelResourceError
} = require('../../scheduling/model-resource-manager');
const {
  ControlledOomRecoveryError,
  executeWithControlledOomRecovery,
  isRecognizedOom
} = require('../../scheduling/controlled-oom-recovery');

const modelFor = (id) => ({
  id: `model-${id}`,
  providerId: 'local',
  source: 'local',
  reference: `model-${id}`
});

const modelId = fc.integer({ min: 0, max: 1000 });
const protectionArbitrary = fc.record({
  pinned: fc.boolean(),
  selected: fc.boolean(),
  recoveryProtected: fc.boolean(),
  reservation: fc.boolean(),
  ensureReady: fc.boolean(),
  stream: fc.boolean()
});

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 6: Resource references remain safe and recoveries are controlled
// **Validates: Requirements 6.8, 7.1, 7.2, 7.3**

test('keeps reference ownership nonnegative and release operations idempotent', () => {
  fc.assert(
    fc.property(modelId, fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 8 }), (id, reservationCount, ensureCount) => {
      const manager = new ModelResourceManager({ idleMs: 0 });
      const model = modelFor(id);
      manager.markLoaded(model);
      const reservations = Array.from({ length: reservationCount }, (_, index) => manager.reserve(model, { id: `reservation-${index}` }));
      const ensureTokens = Array.from({ length: ensureCount }, (_, index) => manager.acquireEnsureReady(model, { id: `ensure-${index}` }));
      const stream = manager.startStream(model, 'stream-0');
      const snapshotBeforeRelease = manager.getSnapshot().resources[0];

      assert.equal(snapshotBeforeRelease.referenceCount, reservationCount);
      assert.equal(snapshotBeforeRelease.reservationCount, reservationCount);
      assert.equal(snapshotBeforeRelease.ensureReady, ensureCount);
      assert.equal(snapshotBeforeRelease.activeStreams, 1);

      reservations.forEach((token) => {
        assert.equal(manager.release(token).released, true);
        assert.equal(manager.release(token).released, false);
      });
      ensureTokens.forEach((token) => {
        assert.equal(manager.release(token).released, true);
        assert.equal(manager.release(token).released, false);
      });
      assert.equal(stream.release(), true);
      assert.equal(stream.release(), false);

      const finalEntry = manager.getSnapshot().resources[0];
      assert.ok(finalEntry.referenceCount >= 0);
      assert.ok(finalEntry.reservationCount >= 0);
      assert.ok(finalEntry.ensureReady >= 0);
      assert.equal(finalEntry.referenceCount, 0);
      assert.equal(finalEntry.reservationCount, 0);
      assert.equal(finalEntry.ensureReady, 0);
      assert.equal(finalEntry.activeStreams, 0);
    }),
    { numRuns: 100 }
  );
});

test('never evicts a resource protected by any ownership or selection state', () => {
  fc.assert(
    fc.property(modelId, protectionArbitrary, (id, protection) => {
      const manager = new ModelResourceManager({ idleMs: 0 });
      const model = modelFor(id);
      manager.markLoaded(model, { bytes: 1 }, protection);
      const reservation = protection.reservation ? manager.reserve(model, { id: 'protected-reservation' }) : null;
      const ensure = protection.ensureReady ? manager.acquireEnsureReady(model, { id: 'protected-ensure' }) : null;
      const stream = protection.stream ? manager.startStream(model, 'protected-stream') : null;

      const entry = manager.getSnapshot().resources[0];
      const shouldBeProtected = protection.pinned || protection.selected || protection.recoveryProtected
        || protection.reservation || protection.ensureReady || protection.stream;
      assert.equal(entry.idleUnloadEligible, !shouldBeProtected);

      const result = manager.unloadIdle({ reason: 'property-test' });
      assert.equal(result.evicted.length, shouldBeProtected ? 0 : 1);
      assert.equal(manager.getSnapshot().loaded, shouldBeProtected ? 1 : 0);

      if (reservation) manager.release(reservation);
      if (ensure) manager.release(ensure);
      if (stream) stream.release();
    }),
    { numRuns: 100 }
  );
});

test('evicts eligible resources deterministically by idle time and identity', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.record({ at: fc.integer({ min: 0, max: 20 }), bytes: fc.integer({ min: 1, max: 20 }) }), {
        minLength: 1,
        maxLength: 8,
        selector: (value) => `${value.at}:${value.bytes}`
      }),
      (records) => {
        const createManager = () => {
          const manager = new ModelResourceManager({ idleMs: 0 });
          records.forEach((record, index) => {
            manager.markLoaded(modelFor(index), { bytes: record.bytes }, { lastUsedAt: record.at });
          });
          return manager;
        };
        const expected = records.map((record, index) => ({ record, index }))
          .sort((left, right) => left.record.at - right.record.at || `source:local:local:model-${left.index}:model-${left.index}`.localeCompare(`source:local:local:model-${right.index}:model-${right.index}`));
        const first = createManager().unloadIdle({ limit: records.length }).evicted.map((entry) => entry.identity);
        const second = createManager().unloadIdle({ limit: records.length }).evicted.map((entry) => entry.identity);
        const expectedIdentities = expected.map(({ index }) => `source:local:local:model-${index}:model-${index}`);

        assert.deepEqual(first, expectedIdentities);
        assert.deepEqual(second, expectedIdentities);
      }
    ),
    { numRuns: 100 }
  );
});

test('reports capacity failure without evicting protected resources', () => {
  fc.assert(
    fc.property(modelId, fc.integer({ min: 1, max: 20 }), (id, bytes) => {
      const manager = new ModelResourceManager({ maxResources: 1, maxBytes: bytes, idleMs: 0 });
      manager.markLoaded(modelFor(id), { bytes }, { selected: true });
      assert.throws(() => manager.evictForCapacity({ bytes: 1 }), (error) => {
        assert.ok(error instanceof ModelResourceError);
        assert.equal(error.code, 'RESOURCE_CAPACITY');
        assert.equal(error.retryable, true);
        return true;
      });
      assert.equal(manager.getSnapshot().loaded, 1);
      assert.equal(manager.getSnapshot().resources[0].selected, true);
    }),
    { numRuns: 100 }
  );
});

const errorArbitrary = fc.constantFrom(
  { code: 'OOM', message: 'provider failed' },
  { code: 'CUDA_OUT_OF_MEMORY', message: 'allocation failed' },
  { code: 'ERR_OUT_OF_MEMORY', message: 'out of memory' },
  { message: 'memory allocation failed' }
);

test('performs exactly one controlled retry for every recognized OOM outcome', async () => {
  await fc.assert(
    fc.asyncProperty(errorArbitrary, fc.string({ minLength: 0, maxLength: 20 }), async (failureShape, value) => {
      const controller = new AbortController();
      const seen = [];
      let recoveryCalls = 0;
      const failure = Object.assign(new Error(failureShape.message), failureShape);
      const result = await executeWithControlledOomRecovery((context) => {
        seen.push(context);
        if (context.attempt === 0) throw failure;
        return value;
      }, {
        id: `request-${value}`,
        signal: controller.signal,
        recover: ({ error, attempt, signal }) => {
          recoveryCalls += 1;
          assert.equal(error, failure);
          assert.equal(attempt, 0);
          assert.equal(signal, controller.signal);
        }
      });

      assert.equal(isRecognizedOom(failure), true);
      assert.equal(recoveryCalls, 1);
      assert.equal(seen.length, 2);
      assert.equal(seen[0].attempt, 0);
      assert.equal(seen[0].recovery, false);
      assert.equal(seen[1].attempt, 1);
      assert.equal(seen[1].recovery, true);
      assert.equal(seen[0].id, seen[1].id);
      assert.equal(seen[0].signal, controller.signal);
      assert.equal(seen[1].signal, controller.signal);
      assert.equal(result.value, value);
      assert.equal(result.original.success, false);
      assert.equal(result.recovery.success, true);
      assert.equal(result.recovery.value, value);
    }),
    { numRuns: 100 }
  );
});

test('does not retry ordinary failures and wraps exactly one failed OOM retry', async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 20 }), fc.boolean(), async (message, ordinaryFailure) => {
      const failure = ordinaryFailure
        ? new Error(message)
        : Object.assign(new Error('out of memory'), { code: 'OOM' });
      const retryFailure = new Error(`retry-${message}`);
      let attempts = 0;
      let recoveryCalls = 0;

      if (ordinaryFailure) {
        await assert.rejects(
          executeWithControlledOomRecovery(() => {
            attempts += 1;
            throw failure;
          }, { recover: () => { recoveryCalls += 1; } }),
          (error) => error === failure
        );
        assert.equal(attempts, 1);
        assert.equal(recoveryCalls, 0);
      } else {
        await assert.rejects(
          executeWithControlledOomRecovery(({ attempt }) => {
            attempts += 1;
            if (attempt === 0) throw failure;
            throw retryFailure;
          }, { recover: () => { recoveryCalls += 1; } }),
          (error) => {
            assert.ok(error instanceof ControlledOomRecoveryError);
            assert.equal(error.code, 'OOM_RECOVERY_FAILED');
            assert.equal(error.original.code, 'OOM');
            assert.equal(error.recovery.message, retryFailure.message);
            return true;
          }
        );
        assert.equal(attempts, 2);
        assert.equal(recoveryCalls, 1);
      }
    }),
    { numRuns: 100 }
  );
});

test('cancellation during a recognized OOM flow prevents retry and preserves classification precedence', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom('abort', 'cancelled-code', 'cancelled-flag'), async (kind) => {
      const controller = new AbortController();
      let attempts = 0;
      const cancellation = kind === 'abort'
        ? Object.assign(new Error('out of memory'), { name: 'AbortError' })
        : kind === 'cancelled-code'
          ? Object.assign(new Error('out of memory'), { code: 'CALLER_CANCELLED' })
          : Object.assign(new Error('out of memory'), { cancelled: true });
      const oom = Object.assign(new Error('out of memory'), { code: 'OOM' });

      await assert.rejects(
        executeWithControlledOomRecovery(() => {
          attempts += 1;
          controller.abort();
          throw oom;
        }, { signal: controller.signal, recover: () => assert.fail('recovery must not run') }),
        (error) => error.code === 'CALLER_CANCELLED'
      );
      assert.equal(attempts, 1);
      assert.equal(isRecognizedOom(cancellation), false);
    }),
    { numRuns: 100 }
  );
});
