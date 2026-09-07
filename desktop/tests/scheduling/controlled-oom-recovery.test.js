const assert = require('node:assert/strict');
const {
  ControlledOomRecoveryError,
  executeWithControlledOomRecovery,
  isRecognizedOom
} = require('../../scheduling/controlled-oom-recovery');
const { AdmissionScheduler } = require('../../scheduling/admission-scheduler');

const oom = () => Object.assign(new Error('CUDA out of memory'), { code: 'CUDA_OUT_OF_MEMORY' });

test('recognizes supported OOM forms but excludes cancellation and ordinary failures', () => {
  assert.equal(isRecognizedOom(oom()), true);
  assert.equal(isRecognizedOom(new Error('connection timeout')), false);
  assert.equal(isRecognizedOom(Object.assign(new Error('out of memory'), { code: 'CALLER_CANCELLED' })), false);
  assert.equal(isRecognizedOom(Object.assign(new Error('cancelled'), { name: 'AbortError' })), false);
});

test('does not retry non-OOM failures', async () => {
  let attempts = 0;
  const failure = new Error('provider protocol failure');
  await assert.rejects(
    executeWithControlledOomRecovery(() => { attempts++; throw failure; }, { recover: () => { throw new Error('must not run'); } }),
    (error) => error === failure
  );
  assert.equal(attempts, 1);
});

test('performs exactly one recovery retry and returns both outcomes', async () => {
  let attempts = 0;
  let recoveryCalls = 0;
  const result = await executeWithControlledOomRecovery(({ attempt, recovery }) => {
    attempts++;
    if (attempt === 0) throw oom();
    assert.equal(recovery, true);
    return 'recovered';
  }, {
    id: 'request-1',
    recover: ({ error, attempt }) => {
      recoveryCalls++;
      assert.equal(error.code, 'CUDA_OUT_OF_MEMORY');
      assert.equal(attempt, 0);
    }
  });
  assert.equal(attempts, 2);
  assert.equal(recoveryCalls, 1);
  assert.equal(result.value, 'recovered');
  assert.equal(result.original.success, false);
  assert.equal(result.original.error.code, 'CUDA_OUT_OF_MEMORY');
  assert.deepEqual(result.recovery, { success: true, value: 'recovered' });
});

test('returns original and recovery errors when the single retry fails', async () => {
  const retryFailure = new Error('provider unavailable');
  await assert.rejects(
    executeWithControlledOomRecovery(({ attempt }) => {
      if (attempt === 0) throw oom();
      throw retryFailure;
    }),
    (error) => {
      assert.equal(error instanceof ControlledOomRecoveryError, true);
      assert.equal(error.code, 'OOM_RECOVERY_FAILED');
      assert.equal(error.original.code, 'CUDA_OUT_OF_MEMORY');
      assert.equal(error.recovery.message, retryFailure.message);
      return true;
    }
  );
});

test('scheduler keeps recovery inside one admission and preserves cancellation', async () => {
  const scheduler = new AdmissionScheduler({ maxActive: 1 });
  let attempts = 0;
  const result = scheduler.enqueueWithControlledOomRecovery(({ attempt }) => {
    attempts++;
    if (attempt === 0) throw oom();
    return 'ok';
  });
  assert.equal((await result).value, 'ok');
  assert.equal(attempts, 2);
  assert.deepEqual(scheduler.getCounters(), {
    active: 0, queued: 0, rejected: 0, cancelled: 0, completed: 1, failed: 0, capacity: 1
  });

  const controller = new AbortController();
  const cancelled = scheduler.enqueueWithControlledOomRecovery(async ({ attempt }) => {
    if (attempt === 0) {
      controller.abort();
      throw oom();
    }
    return 'must-not-run';
  }, {}, { signal: controller.signal });
  await assert.rejects(cancelled, (error) => error.code === 'CALLER_CANCELLED');
  assert.equal(scheduler.getCounters().cancelled, 1);
});

test('does not retry when recovery itself is cancelled', async () => {
  const controller = new AbortController();
  let attempts = 0;
  let recoveryCalls = 0;
  await assert.rejects(
    executeWithControlledOomRecovery(({ attempt }) => {
      attempts++;
      assert.equal(attempt, 0);
      throw oom();
    }, {
      signal: controller.signal,
      recover: () => {
        recoveryCalls++;
        controller.abort();
      }
    }),
    (error) => error.code === 'CALLER_CANCELLED'
  );
  assert.equal(attempts, 1);
  assert.equal(recoveryCalls, 1);
});

test('wraps an OOM retry failure and never performs a second retry', async () => {
  let attempts = 0;
  await assert.rejects(
    executeWithControlledOomRecovery(({ attempt }) => {
      attempts++;
      if (attempt === 0) throw oom();
      throw oom();
    }),
    (error) => error instanceof ControlledOomRecoveryError && error.code === 'OOM_RECOVERY_FAILED'
  );
  assert.equal(attempts, 2);
});

test('passes the same admission identity and signal through the one retry', async () => {
  const scheduler = new AdmissionScheduler({ maxActive: 1 });
  const controller = new AbortController();
  const seen = [];
  const result = scheduler.enqueueWithControlledOomRecovery(({ id, signal, attempt }) => {
    seen.push({ id, signal, attempt });
    if (attempt === 0) throw oom();
    return 'ok';
  }, { recover: () => {} }, { id: 'stable-id', signal: controller.signal });
  assert.equal((await result).value, 'ok');
  assert.deepEqual(seen.map(({ id, signal, attempt }) => ({ id, signal, attempt })), [
    { id: 'stable-id', signal: controller.signal, attempt: 0 },
    { id: 'stable-id', signal: controller.signal, attempt: 1 }
  ]);
});
