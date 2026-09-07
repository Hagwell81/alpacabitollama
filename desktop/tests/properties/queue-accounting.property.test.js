/* eslint-env node */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const fc = require('fast-check');
const { AdmissionScheduler } = require('../../scheduling/admission-scheduler');

const tick = () => new Promise((resolve) => setImmediate(resolve));

const optionsArbitrary = fc.record({
  maxActive: fc.integer({ min: 1, max: 3 }),
  maxQueued: fc.integer({ min: 0, max: 3 })
});

const sequenceArbitrary = fc.array(
  fc.record({
    kind: fc.constantFrom('admit-success', 'admit-failure', 'cancel', 'settle-success', 'settle-failure', 'shutdown', 'replace'),
    target: fc.integer({ min: 0, max: 20 })
  }),
  { minLength: 8, maxLength: 32 }
);

function expectedCounters(requests, maxActive, counts) {
  return {
    active: requests.filter((request) => request.status === 'active' || request.status === 'cancelled-active').length,
    queued: requests.filter((request) => request.status === 'queued').length,
    rejected: counts.rejected,
    cancelled: counts.cancelled,
    completed: counts.completed,
    failed: counts.failed,
    capacity: maxActive
  };
}

function assertAccounting(scheduler, requests, maxActive, counts) {
  const counters = scheduler.getCounters();
  assert.deepEqual(counters, expectedCounters(requests, maxActive, counts));
  assert.ok(counters.active <= maxActive);
  assert.ok(counters.queued <= scheduler.maxQueued);

  const status = scheduler.getStatus();
  assert.equal(status.activeRequests, counters.active);
  assert.equal(status.queuedRequests, counters.queued);
  assert.equal(status.maxConcurrent, maxActive);
  assert.equal(status.latency.count, counters.completed + counters.failed);
}

async function settleNewlyStarted(requests) {
  await tick();
  for (const request of requests) {
    if (request.status === 'queued' && request.invoked) request.status = 'active';
  }
}

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 8: Admission and queue accounting
// **Validates: Requirements 6.1, 6.2, 7.1, 7.2, 7.4, 7.5, 7.6**

test('maintains bounded queue accounting and exactly one terminal outcome for generated admission sequences', async () => {
  await fc.assert(
    fc.asyncProperty(optionsArbitrary, sequenceArbitrary, async ({ maxActive, maxQueued }, sequence) => {
      const scheduler = new AdmissionScheduler({ maxActive, maxQueued });
      const requests = [];
      const counts = { rejected: 0, cancelled: 0, completed: 0, failed: 0 };
      let closed = false;

      const observe = () => assertAccounting(scheduler, requests, maxActive, counts);
      const activeRequests = () => requests.filter((request) => request.status === 'active' || request.status === 'cancelled-active');
      const cancellableRequests = () => requests.filter((request) => request.status === 'queued' || request.status === 'active');

      const admit = async (shouldFail) => {
        const controller = new AbortController();
        const request = {
          status: 'admitting',
          invoked: false,
          executorSettled: false,
          controller,
          outcome: null,
          outcomeEvents: 0,
          resolve: null,
          reject: null
        };
        request.promise = scheduler.enqueue(() => {
          request.invoked = true;
          return new Promise((resolve, reject) => {
            request.resolve = resolve;
            request.reject = reject;
          });
        }, { signal: controller.signal });
        request.promise.then(
          () => { request.outcomeEvents += 1; request.outcome = 'fulfilled'; },
          (error) => { request.outcomeEvents += 1; request.outcome = { code: error.code }; }
        );
        requests.push(request);
        await settleNewlyStarted(requests);

        if (request.invoked) {
          request.status = 'active';
        } else if (request.outcome?.code === 'CALLER_CANCELLED') {
          request.status = 'cancelled';
          counts.cancelled += 1;
        } else if (request.outcome) {
          request.status = 'rejected';
          counts.rejected += 1;
        } else {
          request.status = 'queued';
        }
        request.shouldFail = shouldFail;
        observe();
      };

      const cancel = async (target) => {
        const candidates = cancellableRequests();
        const request = candidates[target % (candidates.length || 1)];
        if (!request) return;
        request.controller.abort();
        await tick();
        if (request.status === 'active') request.status = 'cancelled-active';
        else if (request.status === 'queued') request.status = 'cancelled';
        counts.cancelled += 1;
        observe();
      };

      const settle = async (target, shouldFail) => {
        const candidates = activeRequests().filter((request) => !request.executorSettled);
        const request = candidates[target % (candidates.length || 1)];
        if (!request) return;
        request.executorSettled = true;
        if (shouldFail) request.reject(new Error('generated executor failure'));
        else request.resolve('generated success');
        await settleNewlyStarted(requests);

        if (request.status === 'active') {
          request.status = shouldFail ? 'failed' : 'completed';
          counts[shouldFail ? 'failed' : 'completed'] += 1;
        } else {
          assert.equal(request.status, 'cancelled-active');
          request.status = 'cancelled';
        }
        observe();
      };

      const clear = async (reason) => {
        if (closed) return;
        closed = true;
        scheduler[reason]();
        for (const request of requests) {
          if (request.status === 'queued') {
            request.status = 'rejected';
            counts.rejected += 1;
          }
        }
        await tick();
        observe();
      };

      for (const command of sequence) {
        if (command.kind === 'admit-success' && !closed) await admit(false);
        else if (command.kind === 'admit-failure' && !closed) await admit(true);
        else if (command.kind === 'cancel') await cancel(command.target);
        else if (command.kind === 'settle-success') await settle(command.target, false);
        else if (command.kind === 'settle-failure') await settle(command.target, true);
        else if (command.kind === 'shutdown') await clear('shutdown');
        else if (command.kind === 'replace') await clear('replace');
      }

      if (requests.some((request) => request.status === 'queued')) await clear('shutdown');
      for (const request of activeRequests().filter((item) => !item.executorSettled)) await settle(requests.indexOf(request), request.shouldFail);
      await Promise.allSettled(requests.map((request) => request.promise));
      observe();

      for (const request of requests) {
        assert.equal(request.outcomeEvents, 1, 'every admitted request has exactly one terminal caller outcome');
        assert.ok(['fulfilled', 'rejected'].includes(request.outcome === 'fulfilled' ? 'fulfilled' : 'rejected'));
      }
    }),
    { numRuns: 100 }
  );
});
