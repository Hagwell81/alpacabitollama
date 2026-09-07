'use strict';

const STATES = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });
const OPERATION_CATEGORIES = Object.freeze(['health', 'model-load', 'chat', 'stream', 'discovery']);

class CircuitOpenError extends Error {
  constructor({ providerId, operationCategory, resetAt, correlationId } = {}) {
    super(`Circuit is open for provider ${providerId} (${operationCategory}).`);
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
    this.retryable = true;
    this.recoveryAction = 'Retry after the circuit reset interval';
    this.providerId = providerId;
    this.operationCategory = operationCategory;
    this.resetAt = resetAt;
    if (correlationId !== undefined) this.correlationId = String(correlationId);
    this.details = { providerId, operationCategory, resetAt };
  }
}

function isCancellation(value) {
  const error = value && typeof value === 'object' ? value : {};
  const code = String(error.code || error.error?.code || '').toUpperCase();
  const name = String(error.name || error.error?.name || '').toLowerCase();
  return error.cancelled === true || error.canceled === true || code === 'CALLER_CANCELLED'
    || code === 'CANCELLED' || code === 'CANCELED' || name === 'aborterror';
}

function parseKey(providerId, operationCategory) {
  if (providerId && typeof providerId === 'object') {
    const input = providerId;
    return { providerId: String(input.providerId ?? input.provider ?? ''), operationCategory: String(input.operationCategory ?? input.category ?? '') };
  }
  return { providerId: String(providerId ?? ''), operationCategory: String(operationCategory ?? '') };
}

function keyFor(providerId, operationCategory) {
  return JSON.stringify([providerId, operationCategory]);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeDuration(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

class CircuitBreaker {
  constructor(options = {}, resetMs) {
    if (typeof options === 'number') options = { threshold: options, resetMs };
    const clock = options.clock;
    this.threshold = normalizePositiveInteger(options.threshold, 5);
    this.resetMs = normalizeDuration(options.resetMs, 60000);
    this.now = typeof options.now === 'function' ? options.now
      : (clock && typeof clock.now === 'function' ? () => clock.now() : () => Date.now());
    this.allowedCategories = options.operationCategories || OPERATION_CATEGORIES;
    this.buckets = new Map();
  }

  _bucket(providerId, operationCategory) {
    const key = keyFor(providerId, operationCategory);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { providerId, operationCategory, state: STATES.CLOSED, failureCount: 0,
        openedAt: null, resetAt: null, probeInFlight: false, lastCorrelationId: null };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  _resolve(providerId, operationCategory) {
    const key = parseKey(providerId, operationCategory);
    if (!key.providerId || !key.operationCategory) throw new TypeError('providerId and operationCategory are required');
    return { ...key, key: keyFor(key.providerId, key.operationCategory), bucket: this._bucket(key.providerId, key.operationCategory) };
  }

  _refresh(bucket) {
    if (bucket.state === STATES.OPEN && this.now() >= bucket.resetAt) {
      bucket.state = STATES.HALF_OPEN;
      bucket.probeInFlight = false;
    }
    return bucket;
  }

  /** Reserve admission. A HALF_OPEN bucket can reserve exactly one probe. */
  acquire(providerId, operationCategory, correlationId) {
    const resolved = this._resolve(providerId, operationCategory);
    const bucket = this._refresh(resolved.bucket);
    if (bucket.state === STATES.OPEN || (bucket.state === STATES.HALF_OPEN && bucket.probeInFlight)) {
      throw new CircuitOpenError({ ...resolved, resetAt: bucket.resetAt, correlationId });
    }
    const probe = bucket.state === STATES.HALF_OPEN;
    if (probe) bucket.probeInFlight = true;
    if (correlationId !== undefined) bucket.lastCorrelationId = String(correlationId);
    let released = false;
    return {
      key: resolved.key, providerId: resolved.providerId, operationCategory: resolved.operationCategory, probe,
      release: () => {
        if (released) return;
        released = true;
        if (probe && bucket.probeInFlight) bucket.probeInFlight = false;
      }
    };
  }

  tryAcquire(providerId, operationCategory, correlationId) {
    try { return { allowed: true, permit: this.acquire(providerId, operationCategory, correlationId) }; }
    catch (error) { if (error.code === 'CIRCUIT_OPEN') return { allowed: false, error }; throw error; }
  }

  canAttempt(providerId, operationCategory) {
    const resolved = this._resolve(providerId, operationCategory);
    const bucket = this._refresh(resolved.bucket);
    return bucket.state === STATES.CLOSED || (bucket.state === STATES.HALF_OPEN && !bucket.probeInFlight);
  }

  recordSuccess(providerId, operationCategory, permit) {
    const resolved = this._resolve(providerId, operationCategory);
    const bucket = this._refresh(resolved.bucket);
    bucket.failureCount = 0;
    bucket.state = STATES.CLOSED;
    bucket.openedAt = null;
    bucket.resetAt = null;
    bucket.probeInFlight = false;
    if (permit?.release) permit.release();
    return this.getState(providerId, operationCategory);
  }

  recordFailure(providerId, operationCategory, error, permit) {
    const resolved = this._resolve(providerId, operationCategory);
    const bucket = this._refresh(resolved.bucket);
    if (isCancellation(error)) {
      if (permit?.release) permit.release();
      return this.getState(providerId, operationCategory);
    }
    bucket.failureCount += 1;
    bucket.lastCorrelationId = error?.correlationId || bucket.lastCorrelationId;
    if (bucket.state === STATES.HALF_OPEN || bucket.failureCount >= this.threshold) {
      bucket.state = STATES.OPEN;
      bucket.openedAt = this.now();
      bucket.resetAt = bucket.openedAt + this.resetMs;
      bucket.probeInFlight = false;
    }
    if (permit?.release) permit.release();
    return this.getState(providerId, operationCategory);
  }

  recordOutcome(providerId, operationCategory, outcome, permit) {
    if (isCancellation(outcome)) return this.recordFailure(providerId, operationCategory, outcome, permit);
    if (outcome && outcome.success === false) return this.recordFailure(providerId, operationCategory, outcome.error || outcome, permit);
    return this.recordSuccess(providerId, operationCategory, permit);
  }

  async execute(providerId, operationCategory, operation, correlationId) {
    const permit = this.acquire(providerId, operationCategory, correlationId);
    try {
      const outcome = await operation();
      this.recordOutcome(providerId, operationCategory, outcome, permit);
      return outcome;
    } catch (error) {
      this.recordFailure(providerId, operationCategory, error, permit);
      throw error;
    }
  }

  getState(providerId, operationCategory) {
    const resolved = this._resolve(providerId, operationCategory);
    const bucket = this._refresh(resolved.bucket);
    const now = this.now();
    return { providerId: bucket.providerId, operationCategory: bucket.operationCategory, state: bucket.state,
      failureCount: bucket.failureCount, threshold: this.threshold, resetMs: this.resetMs,
      resetAt: bucket.resetAt, resetIn: bucket.state === STATES.OPEN ? Math.max(0, bucket.resetAt - now) : 0,
      probeInFlight: bucket.probeInFlight, lastCorrelationId: bucket.lastCorrelationId };
  }

  getStatus(providerId, operationCategory) {
    if (providerId !== undefined) return this.getState(providerId, operationCategory);
    return [...this.buckets.values()].map((bucket) => this.getState(bucket.providerId, bucket.operationCategory));
  }

  reset(providerId, operationCategory) {
    if (providerId === undefined) { this.buckets.clear(); return; }
    const resolved = this._resolve(providerId, operationCategory);
    this.buckets.delete(resolved.key);
  }
}

module.exports = { CircuitBreaker, CircuitOpenError, STATES, CIRCUIT_STATES: STATES, OPERATION_CATEGORIES, isCancellation };
