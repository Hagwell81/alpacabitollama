const assert = require('node:assert/strict');
const { AdmissionScheduler } = require('../../scheduling/admission-scheduler');

test('AdmissionScheduler bounds active and queued work with a typed capacity rejection', async () => {
    let release;
    const scheduler = new AdmissionScheduler({ maxActive: 1, maxQueued: 1 });
    const first = scheduler.enqueue(() => new Promise((resolve) => { release = resolve; }));
    const second = scheduler.enqueue(() => 'second');
    const third = scheduler.enqueue(() => 'third');
    await assert.rejects(third, (error) => error.code === 'CAPACITY');
    assert.deepEqual(scheduler.getCounters(), { active: 1, queued: 1, rejected: 1, cancelled: 0, completed: 0, failed: 0, capacity: 1 });
    release('first');
    assert.equal(await first, 'first');
    assert.equal(await second, 'second');
    assert.equal(scheduler.getCounters().completed, 2);
  });

test('classifies queued and active caller cancellation exactly once', async () => {
    let release;
    const scheduler = new AdmissionScheduler({ maxActive: 1, maxQueued: 2 });
    const controller = new AbortController();
    const active = scheduler.enqueue(() => new Promise((resolve) => { release = resolve; }));
    const queued = scheduler.enqueue(() => 'queued');
    controller.abort();
    const cancelled = scheduler.enqueue(() => 'cancelled', { signal: controller.signal });
    await assert.rejects(cancelled, (error) => error.code === 'CALLER_CANCELLED');
    release('done');
    assert.equal(await active, 'done');
    assert.equal(await queued, 'queued');
    assert.equal(scheduler.getCounters().cancelled, 1);
  });

test('clears queued work with shutdown/replacement reasons without touching active work', async () => {
    let release;
    const scheduler = new AdmissionScheduler({ maxActive: 1, maxQueued: 2 });
    const active = scheduler.enqueue(() => new Promise((resolve) => { release = resolve; }));
    const queued = scheduler.enqueue(() => 'must-not-run');
    scheduler.shutdown();
    await assert.rejects(queued, (error) => error.code === 'SHUTDOWN');
    release('still-admitted');
    assert.equal(await active, 'still-admitted');
    assert.equal(scheduler.getCounters().queued, 0);
    assert.equal(scheduler.getCounters().completed, 1);
    await assert.rejects(scheduler.enqueue(() => 'later'), (error) => error.code === 'SHUTDOWN');
    scheduler.reset();
    const replacement = scheduler.enqueue(() => 'replacement-ready');
    assert.equal(await replacement, 'replacement-ready');
  });

test('uses injected time for deterministic latency summaries', async () => {
    let time = 100;
    const scheduler = new AdmissionScheduler({ maxActive: 1, now: () => time });
    const result = scheduler.enqueue(() => { time = 145; return 'ok'; });
    assert.equal(await result, 'ok');
    assert.equal(scheduler.getStatus().latency.p50, 45);
});

test('normalizes invalid limits to safe finite bounds', () => {
    const scheduler = new AdmissionScheduler({ maxActive: Number.NaN, maxQueued: Number.POSITIVE_INFINITY });
    assert.equal(scheduler.getCounters().capacity, 1);
    assert.equal(scheduler.maxQueued, 2);
});

test('cancelling queued work removes it and drains the next FIFO task', async () => {
  let release;
  const scheduler = new AdmissionScheduler({ maxActive: 1, maxQueued: 2 });
  const active = scheduler.enqueue(() => new Promise((resolve) => { release = resolve; }));
  const firstQueued = scheduler.enqueue(() => 'first-queued');
  const controller = new AbortController();
  const cancelled = scheduler.enqueue(() => 'must-not-run', { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, (error) => error.code === 'CALLER_CANCELLED');
  assert.deepEqual(scheduler.getCounters(), { active: 1, queued: 1, rejected: 0, cancelled: 1, completed: 0, failed: 0, capacity: 1 });
  release('active');
  assert.equal(await active, 'active');
  assert.equal(await firstQueued, 'first-queued');
  assert.equal(scheduler.getCounters().active, 0);
  assert.equal(scheduler.getCounters().queued, 0);
  assert.equal(scheduler.getCounters().completed, 2);
});

test('counts executor failures once and does not run capacity-rejected work', async () => {
  let release;
  let rejectedExecutions = 0;
  const scheduler = new AdmissionScheduler({ maxActive: 1, maxQueued: 0 });
  const active = scheduler.enqueue(() => new Promise((resolve) => { release = resolve; }));
  const rejected = scheduler.enqueue(() => { rejectedExecutions++; return 'bad'; });
  await assert.rejects(rejected, (error) => error.code === 'CAPACITY');
  assert.equal(rejectedExecutions, 0);
  release('done');
  assert.equal(await active, 'done');
  const failed = scheduler.enqueue(() => { throw new Error('executor failed'); });
  await assert.rejects(failed, /executor failed/);
  assert.deepEqual(scheduler.getCounters(), { active: 0, queued: 0, rejected: 1, cancelled: 0, completed: 1, failed: 1, capacity: 1 });
});

test('active cancellation settles the caller once while the executor finishes normally', async () => {
  let release;
  let receivedSignal;
  const controller = new AbortController();
  const scheduler = new AdmissionScheduler({ maxActive: 1 });
  const request = scheduler.enqueue(({ signal }) => {
    receivedSignal = signal;
    return new Promise((resolve) => { release = resolve; });
  }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.equal(receivedSignal, controller.signal);
  await assert.rejects(request, (error) => error.code === 'CALLER_CANCELLED');
  release('late result');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(scheduler.getCounters(), { active: 0, queued: 0, rejected: 0, cancelled: 1, completed: 0, failed: 0, capacity: 1 });
});

test('replacement clears every queued request while preserving active work', async () => {
  let release;
  const scheduler = new AdmissionScheduler({ maxActive: 1, maxQueued: 2 });
  const active = scheduler.enqueue(() => new Promise((resolve) => { release = resolve; }));
  const queuedOne = scheduler.enqueue(() => 'one');
  const queuedTwo = scheduler.enqueue(() => 'two');
  scheduler.replace();
  await assert.rejects(queuedOne, (error) => error.code === 'REPLACEMENT');
  await assert.rejects(queuedTwo, (error) => error.code === 'REPLACEMENT');
  assert.equal(scheduler.getCounters().queued, 0);
  release('active survives');
  assert.equal(await active, 'active survives');
  await assert.rejects(scheduler.enqueueOrReject(() => 'blocked'), (error) => error.code === 'REPLACEMENT');
});
