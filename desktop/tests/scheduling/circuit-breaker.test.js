'use strict';

const assert = require('assert');
const { CircuitBreaker, CircuitOpenError, STATES } = require('../../scheduling/circuit-breaker');

describe('scheduling circuit breaker', () => {
  test('isolates failures by provider and operation category', () => {
    const breaker = new CircuitBreaker({ threshold: 2, resetMs: 1000, now: () => 10 });
    breaker.recordFailure('local', 'chat', new Error('one'));
    breaker.recordFailure('local', 'chat', new Error('two'));

    assert.strictEqual(breaker.getState('local', 'chat').state, STATES.OPEN);
    assert.strictEqual(breaker.getState('local', 'chat').failureCount, 2);
    assert.strictEqual(breaker.getState('local', 'stream').state, STATES.CLOSED);
    assert.strictEqual(breaker.getState('remote', 'chat').state, STATES.CLOSED);
    assert.throws(() => breaker.acquire('local', 'chat'), (error) => {
      assert(error instanceof CircuitOpenError);
      assert.strictEqual(error.code, 'CIRCUIT_OPEN');
      assert.strictEqual(error.retryable, true);
      return true;
    });
  });

  test('uses the injected clock and enters half-open at the reset deadline', () => {
    let now = 100;
    const breaker = new CircuitBreaker({ threshold: 1, resetMs: 50, now: () => now });
    breaker.recordFailure('local', 'health', new Error('backend down'));
    assert.deepStrictEqual(breaker.getState('local', 'health'), {
      providerId: 'local', operationCategory: 'health', state: STATES.OPEN, failureCount: 1,
      threshold: 1, resetMs: 50, resetAt: 150, resetIn: 50, probeInFlight: false, lastCorrelationId: null
    });

    now = 149;
    assert.strictEqual(breaker.canAttempt('local', 'health'), false);
    now = 150;
    const probe = breaker.acquire('local', 'health', 'probe-1');
    assert.strictEqual(probe.probe, true);
    assert.strictEqual(breaker.getState('local', 'health').state, STATES.HALF_OPEN);
    assert.strictEqual(breaker.getState('local', 'health').resetIn, 0);
  });

  test('admits only one half-open probe and closes after probe success', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ threshold: 1, resetMs: 10, now: () => now });
    breaker.recordFailure('p', 'chat', new Error('failure'));
    now = 10;
    const probe = breaker.acquire('p', 'chat');
    assert.throws(() => breaker.acquire('p', 'chat'), (error) => error.code === 'CIRCUIT_OPEN');

    breaker.recordSuccess('p', 'chat', probe);
    assert.deepStrictEqual(breaker.getState('p', 'chat'), {
      providerId: 'p', operationCategory: 'chat', state: STATES.CLOSED, failureCount: 0,
      threshold: 1, resetMs: 10, resetAt: null, resetIn: 0, probeInFlight: false, lastCorrelationId: null
    });
    assert.strictEqual(breaker.acquire('p', 'chat').probe, false);
  });

  test('reopens after a failed probe and starts a new reset interval', () => {
    let now = 20;
    const breaker = new CircuitBreaker({ threshold: 2, resetMs: 25, now: () => now });
    breaker.recordFailure('p', 'model-load', new Error('first'));
    breaker.recordFailure('p', 'model-load', new Error('second'));
    now = 45;
    const probe = breaker.acquire('p', 'model-load');
    now = 46;
    breaker.recordFailure('p', 'model-load', new Error('probe failed'), probe);
    assert.strictEqual(breaker.getState('p', 'model-load').state, STATES.OPEN);
    assert.strictEqual(breaker.getState('p', 'model-load').resetAt, 71);
  });

  test('excludes caller cancellation from failure accounting, including a probe', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ threshold: 1, resetMs: 10, now: () => now });
    breaker.recordFailure('p', 'stream', new Error('backend failure'));
    now = 10;
    const probe = breaker.acquire('p', 'stream');
    breaker.recordFailure('p', 'stream', { code: 'CALLER_CANCELLED', retryable: false }, probe);
    assert.strictEqual(breaker.getState('p', 'stream').state, STATES.HALF_OPEN);
    assert.strictEqual(breaker.getState('p', 'stream').failureCount, 1);
    assert.strictEqual(breaker.acquire('p', 'stream').probe, true);

    const result = breaker.recordOutcome('p', 'discovery', {
      success: false, error: { code: 'CALLER_CANCELLED' }
    });
    assert.strictEqual(result.state, STATES.CLOSED);
    assert.strictEqual(result.failureCount, 0);
  });

  test('execute records backend outcomes but leaves cancellation outside the breaker', async () => {
    const breaker = new CircuitBreaker({ threshold: 1, resetMs: 10, now: () => 0 });
    const cancelled = await breaker.execute('p', 'chat', async () => ({
      success: false, error: { code: 'CALLER_CANCELLED' }
    }));
    assert.strictEqual(cancelled.success, false);
    assert.strictEqual(breaker.getState('p', 'chat').failureCount, 0);

    await assert.rejects(() => breaker.execute('p', 'chat', async () => { throw new Error('down'); }));
    assert.strictEqual(breaker.getState('p', 'chat').state, STATES.OPEN);
  });
});

test('canAttempt does not consume the half-open probe reservation', () => {
  let now = 0;
  const breaker = new CircuitBreaker({ threshold: 1, resetMs: 10, now: () => now });
  breaker.recordFailure('p', 'chat', new Error('failure'));
  now = 10;
  assert.strictEqual(breaker.canAttempt('p', 'chat'), true);
  const probe = breaker.acquire('p', 'chat');
  assert.strictEqual(probe.probe, true);
  assert.strictEqual(breaker.canAttempt('p', 'chat'), false);
  probe.release();
  assert.strictEqual(breaker.canAttempt('p', 'chat'), true);
});

test('records correlation IDs and resets a bucket after success', () => {
  const breaker = new CircuitBreaker({ threshold: 3, now: () => 0 });
  breaker.recordFailure('p', 'chat', { code: 'PROVIDER_TIMEOUT', correlationId: 'corr-1' });
  assert.equal(breaker.getState('p', 'chat').lastCorrelationId, 'corr-1');
  const permit = breaker.acquire('p', 'chat', 'corr-2');
  const state = breaker.recordOutcome('p', 'chat', { success: true, value: 'ok' }, permit);
  assert.equal(state.state, STATES.CLOSED);
  assert.equal(state.failureCount, 0);
  assert.equal(state.lastCorrelationId, 'corr-2');
});

test('ignores all supported cancellation forms without incrementing failures', () => {
  const breaker = new CircuitBreaker({ threshold: 1 });
  for (const cancellation of [
    { code: 'CALLER_CANCELLED' },
    { code: 'CANCELED' },
    { name: 'AbortError' },
    { cancelled: true },
    { canceled: true }
  ]) {
    breaker.recordFailure('p', 'stream', cancellation);
  }
  assert.equal(breaker.getState('p', 'stream').state, STATES.CLOSED);
  assert.equal(breaker.getState('p', 'stream').failureCount, 0);
});

test('resets one circuit independently from other provider buckets', () => {
  const breaker = new CircuitBreaker({ threshold: 1 });
  breaker.recordFailure('local', 'chat', new Error('down'));
  breaker.recordFailure('remote', 'chat', new Error('down'));
  breaker.reset('local', 'chat');
  assert.equal(breaker.getState('local', 'chat').state, STATES.CLOSED);
  assert.equal(breaker.getState('remote', 'chat').state, STATES.OPEN);
  breaker.reset();
  assert.deepEqual(breaker.getStatus(), []);
});
