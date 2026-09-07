const { ERROR_CODES, createSafeError } = require('../runtime/error-contract');
const { executeWithControlledOomRecovery } = require('./controlled-oom-recovery');

class AdmissionError extends Error {
  constructor({ code, message, retryable = false, recoveryAction, details }) {
    super(message);
    this.name = 'AdmissionError';
    Object.assign(this, createSafeError({ code, message, retryable, recoveryAction, details }));
  }
}

function admissionError(code, message, options = {}) {
  return new AdmissionError({ code, message, ...options });
}

/**
 * Bounded FIFO admission for work which must have one and only one terminal result.
 * The executor is deliberately unaware of providers/resources; those concerns attach
 * at the executor boundary in later scheduling phases.
 */
function normalizeLimit(value, fallback, minimum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.floor(number));
}

class AdmissionScheduler {
  constructor(options = {}) {
    const maxActive = options.maxActive ?? options.maxConcurrent ?? 1;
    this.maxActive = normalizeLimit(maxActive, 1, 1);
    this.maxQueued = normalizeLimit(options.maxQueued ?? options.queueLimit ?? this.maxActive * 2, this.maxActive * 2, 0);
    this.now = options.now || (() => Date.now());
    this._active = 0;
    this._queue = [];
    this._nextId = 1;
    this._closed = null;
    this._counts = { rejected: 0, cancelled: 0, completed: 0, failed: 0 };
    this._latencies = [];
    this._maxLatencyHistory = options.maxLatencyHistory ?? 100;
  }

  enqueue(executor, options = {}) {
    return this._admit(executor, options, false);
  }

  enqueueOrReject(executor, options = {}) {
    return this._admit(executor, options, true);
  }

  /**
   * Admit one logical request whose executor may perform one controlled OOM
   * recovery retry. The retry is internal and cannot consume another queue slot.
   */
  enqueueWithControlledOomRecovery(executor, recoveryOptions = {}, admissionOptions = {}) {
    const options = { ...admissionOptions };
    const recover = recoveryOptions.recover;
    const wrapped = (context) => executeWithControlledOomRecovery(executor, {
      ...recoveryOptions,
      recover,
      id: context.id,
      signal: context.signal
    });
    return this._admit(wrapped, options, false);
  }

  _admit(executor, options, rejectOnCapacity) {
    if (typeof executor !== 'function') return Promise.reject(new TypeError('executor must be a function'));
    const signal = options.signal;
    const task = {
      id: options.id || `req-${this._nextId++}`,
      executor, signal, enqueuedAt: this.now(), resolve: null, reject: null,
      settled: false, started: false, abortHandler: null
    };
    const promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });

    if (this._closed) {
      this._rejectAdmission(task, this._closed);
      return promise;
    }
    if (signal?.aborted) {
      this._cancel(task);
      return promise;
    }
    if (this._active < this.maxActive) {
      this._start(task);
    } else if (this._queue.length >= this.maxQueued) {
      this._counts.rejected++;
      task.settled = true;
      task.reject(admissionError(ERROR_CODES.CAPACITY, 'The request queue is full.', { retryable: true, recoveryAction: 'Retry when capacity is available', details: { capacity: this.maxActive, queued: this._queue.length } }));
    } else {
      this._queue.push(task);
      this._watchCancellation(task);
    }
    return promise;
  }

  _removeAbortHandler(task) {
    if (task.abortHandler) {
      task.signal?.removeEventListener('abort', task.abortHandler);
      task.abortHandler = null;
    }
  }

  _rejectAdmission(task, reason) {
    this._counts.rejected++;
    this._removeAbortHandler(task);
    task.settled = true;
    task.reject(admissionError(reason.code, reason.message, { retryable: reason.code !== ERROR_CODES.REPLACEMENT, recoveryAction: 'Retry when runtime is available' }));
  }

  _watchCancellation(task) {
    if (!task.signal) return;
    task.abortHandler = () => this._cancel(task);
    task.signal.addEventListener('abort', task.abortHandler, { once: true });
  }

  _remove(task) {
    const index = this._queue.indexOf(task);
    if (index >= 0) this._queue.splice(index, 1);
  }

  _cancel(task) {
    if (task.settled) return;
    if (task.started) {
      task.settled = true;
      this._counts.cancelled++;
      task.reject(admissionError(ERROR_CODES.CALLER_CANCELLED, 'The request was cancelled.', { retryable: false }));
      return;
    }
    this._remove(task);
    task.settled = true;
    this._counts.cancelled++;
    task.reject(admissionError(ERROR_CODES.CALLER_CANCELLED, 'The request was cancelled.', { retryable: false }));
  }

  _start(task) {
    if (task.settled) return;
    task.started = true;
    this._active++;
    this._watchCancellation(task);
    Promise.resolve().then(() => task.executor({ id: task.id, signal: task.signal })).then(
      (value) => this._finish(task, null, value),
      (error) => this._finish(task, error)
    );
  }

  _finish(task, error, value) {
    if (!task.settled) {
      task.settled = true;
      const latency = Math.max(0, this.now() - task.enqueuedAt);
      this._latencies.push(latency);
      if (this._latencies.length > this._maxLatencyHistory) this._latencies.shift();
      if (error) { this._counts.failed++; task.reject(error); }
      else { this._counts.completed++; task.resolve(value); }
    }
    this._removeAbortHandler(task);
    this._active--;
    this._drain();
  }

  _drain() {
    while (!this._closed && this._active < this.maxActive && this._queue.length) this._start(this._queue.shift());
  }

  clear(reason = 'shutdown') {
    const suppliedError = reason && typeof reason === 'object' ? reason : null;
    const code = suppliedError?.code || (reason === 'replacement' ? ERROR_CODES.REPLACEMENT : ERROR_CODES.SHUTDOWN);
    const message = suppliedError?.message || (code === ERROR_CODES.REPLACEMENT ? 'Queued work was cleared for model replacement.' : 'Queued work was cleared because runtime is shutting down.');
    this._closed = { code, message };
    for (const task of [...this._queue]) this._rejectAdmission(task, this._closed);
    this._queue.length = 0;
  }

  shutdown() { this.clear('shutdown'); }
  replace() { this.clear('replacement'); }

  reset() {
    this._closed = null;
    this._counts = { rejected: 0, cancelled: 0, completed: 0, failed: 0 };
    this._latencies = [];
  }

  getCounters() {
    return { active: this._active, queued: this._queue.length, ...this._counts, capacity: this.maxActive };
  }

  getStatus() {
    const latencies = [...this._latencies].sort((a, b) => a - b);
    const percentile = (fraction) => latencies[Math.floor(latencies.length * fraction)] || 0;
    return { ...this.getCounters(), maxConcurrent: this.maxActive, activeRequests: this._active, queuedRequests: this._queue.length,
      latency: { count: latencies.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), min: latencies[0] || 0, max: latencies[latencies.length - 1] || 0 } };
  }
}

module.exports = { AdmissionScheduler, AdmissionError, admissionError };
