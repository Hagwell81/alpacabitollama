/* eslint-env node */
const assert = require('assert');
const test = globalThis.test;
const fc = require('fast-check');
const { CircuitBreaker, CircuitOpenError, STATES } = require('../../scheduling/circuit-breaker');

const providerId = fc.string({ minLength: 1, maxLength: 12 }).filter((value) => value.trim().length > 0);
const operationCategory = fc.constantFrom('health', 'model-load', 'chat', 'stream', 'discovery');
const threshold = fc.integer({ min: 1, max: 8 });
const resetMs = fc.integer({ min: 1, max: 500 });
const cancellation = fc.constantFrom(
  { code: 'CALLER_CANCELLED' },
  { code: 'CANCELLED' },
  { code: 'CANCELED' },
  { name: 'AbortError' },
  { cancelled: true },
  { canceled: true }
);

function openCircuit(breaker, provider, category, count) {
  for (let index = 0; index < count; index += 1) {
    breaker.recordFailure(provider, category, new Error(`failure-${index}`));
  }
}

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 10: Circuit breaker state transitions and isolation
// **Validates: Requirements 7.1, 7.2, 7.3**

test('isolates failure counts and admission state by provider and operation category', () => {
  fc.assert(
    fc.property(providerId, operationCategory, providerId, operationCategory, threshold, (providerA, categoryA, providerB, categoryB, limit) => {
      fc.pre(providerA !== providerB || categoryA !== categoryB);
      const breaker = new CircuitBreaker({ threshold: limit, resetMs: 100, now: () => 0 });

      openCircuit(breaker, providerA, categoryA, limit);
      const stateA = breaker.getState(providerA, categoryA);
      const stateB = breaker.getState(providerB, categoryB);

      assert.strictEqual(stateA.state, STATES.OPEN);
      assert.strictEqual(stateA.failureCount, limit);
      assert.strictEqual(stateB.state, STATES.CLOSED);
      assert.strictEqual(stateB.failureCount, 0);
      assert.strictEqual(breaker.tryAcquire(providerB, categoryB).allowed, true);
      assert.throws(() => breaker.acquire(providerA, categoryA), (error) => {
        assert(error instanceof CircuitOpenError);
        assert.strictEqual(error.code, 'CIRCUIT_OPEN');
        assert.strictEqual(error.retryable, true);
        return true;
      });
    }),
    { numRuns: 100 }
  );
});

test('opens at threshold, blocks until reset, and closes after a successful half-open probe', () => {
  fc.assert(
    fc.property(providerId, operationCategory, threshold, resetMs, (provider, category, limit, duration) => {
      let now = 100;
      const breaker = new CircuitBreaker({ threshold: limit, resetMs: duration, now: () => now });
      openCircuit(breaker, provider, category, limit - 1);
      assert.strictEqual(breaker.getState(provider, category).state, STATES.CLOSED);

      breaker.recordFailure(provider, category, new Error('threshold failure'));
      const opened = breaker.getState(provider, category);
      assert.strictEqual(opened.state, STATES.OPEN);
      assert.strictEqual(opened.failureCount, limit);
      assert.strictEqual(opened.resetAt, 100 + duration);
      assert.strictEqual(breaker.tryAcquire(provider, category).allowed, false);

      now = opened.resetAt;
      const probe = breaker.acquire(provider, category, 'property-probe');
      assert.strictEqual(probe.probe, true);
      assert.strictEqual(breaker.getState(provider, category).state, STATES.HALF_OPEN);
      breaker.recordSuccess(provider, category, probe);
      const closed = breaker.getState(provider, category);
      assert.strictEqual(closed.state, STATES.CLOSED);
      assert.strictEqual(closed.failureCount, 0);
      assert.strictEqual(closed.resetAt, null);
      assert.strictEqual(breaker.acquire(provider, category).probe, false);
    }),
    { numRuns: 100 }
  );
});

test('reserves at most one half-open probe and failed probes restart the reset interval', () => {
  fc.assert(
    fc.property(providerId, operationCategory, threshold, resetMs, (provider, category, limit, duration) => {
      let now = 0;
      const breaker = new CircuitBreaker({ threshold: limit, resetMs: duration, now: () => now });
      openCircuit(breaker, provider, category, limit);
      now = duration;

      assert.strictEqual(breaker.canAttempt(provider, category), true);
      const probe = breaker.acquire(provider, category);
      assert.strictEqual(probe.probe, true);
      assert.strictEqual(breaker.canAttempt(provider, category), false);
      assert.throws(() => breaker.acquire(provider, category), (error) => error.code === 'CIRCUIT_OPEN');

      now += 1;
      breaker.recordFailure(provider, category, new Error('probe failure'), probe);
      const reopened = breaker.getState(provider, category);
      assert.strictEqual(reopened.state, STATES.OPEN);
      assert.strictEqual(reopened.failureCount, limit + 1);
      assert.strictEqual(reopened.resetAt, now + duration);
      assert.strictEqual(breaker.canAttempt(provider, category), false);
    }),
    { numRuns: 100 }
  );
});

test('excludes cancellation from failure accounting, including cancellation of a half-open probe', () => {
  fc.assert(
    fc.property(providerId, operationCategory, cancellation, (provider, category, cancelled) => {
      let now = 0;
      const breaker = new CircuitBreaker({ threshold: 1, resetMs: 10, now: () => now });
      breaker.recordFailure(provider, category, new Error('backend failure'));
      const opened = breaker.getState(provider, category);
      now = opened.resetAt;
      const probe = breaker.acquire(provider, category);

      breaker.recordFailure(provider, category, cancelled, probe);
      const halfOpen = breaker.getState(provider, category);
      assert.strictEqual(halfOpen.state, STATES.HALF_OPEN);
      assert.strictEqual(halfOpen.failureCount, 1);
      assert.strictEqual(halfOpen.probeInFlight, false);
      assert.strictEqual(breaker.acquire(provider, category).probe, true);

      const outcome = breaker.recordOutcome(`${provider}-outcome`, category, { success: false, error: cancelled });
      assert.strictEqual(outcome.state, STATES.CLOSED);
      assert.strictEqual(outcome.failureCount, 0);
    }),
    { numRuns: 100 }
  );
});
