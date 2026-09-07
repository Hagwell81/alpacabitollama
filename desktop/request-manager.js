/* eslint-env node */
/**
 * Request Manager Module
 * 
 * Provides CircuitBreaker and RequestQueue implementations for robust
 * API request management with automatic failure detection and recovery.
 * 
 * @module request-manager
 */

const { AdmissionScheduler } = require('./scheduling/admission-scheduler');
const { CircuitBreaker: KeyedCircuitBreaker } = require('./scheduling/circuit-breaker');

/**
 * Circuit Breaker pattern implementation to prevent cascading failures
 * when API requests repeatedly fail.
 */
class CircuitBreaker {
  /**
   * Creates a new CircuitBreaker instance.
   * 
   * @param {number} threshold - Number of consecutive failures before opening circuit
   * @param {number} resetMs - Milliseconds to wait before attempting to close circuit again
   */
  constructor(threshold = 5, resetMs = 60000) {
    this.threshold = threshold;
    this.resetMs = resetMs;
    this._providerId = 'legacy-request-manager';
    this._operationCategory = 'request';
    this._lastFailureTime = null;
    this._breaker = new KeyedCircuitBreaker({ threshold, resetMs });
  }

  /**
   * Records a successful request, resetting failure count.
   */
  recordSuccess(permit) {
    this._breaker.recordSuccess(this._providerId, this._operationCategory, permit);
  }

  /**
   * Records a failed request, incrementing failure count.
   */
  acquire() {
    return this._breaker.acquire(this._providerId, this._operationCategory);
  }

  recordFailure(error, permit) {
    if (!error || !['CALLER_CANCELLED', 'CANCELLED', 'CANCELED'].includes(String(error.code || '').toUpperCase())) {
      this._lastFailureTime = Date.now();
    }
    return this._breaker.recordFailure(this._providerId, this._operationCategory, error, permit);
  }

  /**
   * Determines if a request can be attempted based on circuit state.
   * 
   * @returns {boolean} True if request can be attempted
   */
  canAttempt() {
    return this._breaker.canAttempt(this._providerId, this._operationCategory);
  }

  /**
   * Gets current circuit breaker state information.
   * 
   * @returns {Object} Circuit breaker status
   */
  getState() {
    const state = this._breaker.getState(this._providerId, this._operationCategory);
    return {
      state: state.state,
      failureCount: state.failureCount,
      threshold: state.threshold,
      timeSinceLastFailure: this._lastFailureTime === null ? null : Math.max(0, Date.now() - this._lastFailureTime),
      resetMs: state.resetMs,
      resetIn: state.resetIn
    };
  }

  reset() {
    this._breaker.reset(this._providerId, this._operationCategory);
    this._lastFailureTime = null;
  }
}

/**
 * Request Queue implementation that limits concurrent requests
 * and provides queueing with 429 responses when full.
 */
class RequestQueue {
  /**
   * Creates a new RequestQueue instance.
   * 
   * @param {number} maxConcurrent - Maximum number of concurrent requests
   * @param {boolean} enableCircuitBreaker - Whether to enable circuit breaker
   * @param {number} circuitBreakerThreshold - Failure threshold for circuit breaker
   * @param {number} circuitBreakerResetMs - Reset time for circuit breaker
   */
  constructor(maxConcurrent = 10, enableCircuitBreaker = true,
              circuitBreakerThreshold = 5, circuitBreakerResetMs = 60000) {
    this.maxConcurrent = maxConcurrent;
    this.admissionScheduler = new AdmissionScheduler({
      maxActive: maxConcurrent,
      maxQueued: maxConcurrent * 2,
      now: () => Date.now()
    });
    this.circuitBreaker = enableCircuitBreaker
      ? new CircuitBreaker(circuitBreakerThreshold, circuitBreakerResetMs)
      : null;
    this.totalRequests = 0;
    this.totalErrors = 0;
  }

  /**
   * Adds a task to the queue and executes when capacity allows.
   * 
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Promise that resolves with task result
   */
  async enqueue(fn) {
    this.totalRequests++;
    return this.admissionScheduler.enqueue(async () => {
      let permit = null;
      try {
        if (!this.canAttempt()) throw new Error('Circuit breaker is OPEN');
        permit = this.circuitBreaker?.acquire();
        const result = await fn();
        if (this.circuitBreaker) this.circuitBreaker.recordSuccess(permit);
        return result;
      } catch (error) {
        this.totalErrors++;
        if (this.circuitBreaker && permit) this.circuitBreaker.recordFailure(error, permit);
        throw error;
      }
    });
  }

  /**
   * Immediately rejects with 429 if queue is full, otherwise enqueues.
   * Used for API endpoints that need immediate rejection.
   * 
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Promise that resolves with task result
   */
  async enqueueOrReject(fn) {
    this.totalRequests++;
    return this.admissionScheduler.enqueueOrReject(async () => {
      let permit = null;
      try {
        if (!this.canAttempt()) throw new Error('Circuit breaker is OPEN');
        permit = this.circuitBreaker?.acquire();
        const result = await fn();
        if (this.circuitBreaker) this.circuitBreaker.recordSuccess(permit);
        return result;
      } catch (error) {
        this.totalErrors++;
        if (this.circuitBreaker && permit) this.circuitBreaker.recordFailure(error, permit);
        throw error;
      }
    });
  }

  /**
   * Checks if circuit breaker allows attempts.
   * 
   * @returns {boolean} True if attempts are allowed
   */
  canAttempt() {
    if (!this.circuitBreaker) return true;
    return this.circuitBreaker.canAttempt();
  }

  /**
   * Gets current queue status information.
   * 
   * @returns {Object} Queue status with active, queued, and metrics
   */
  getStatus() {
    const scheduler = this.admissionScheduler.getStatus();
    return {
      activeRequests: scheduler.active,
      queuedRequests: scheduler.queued,
      maxConcurrent: this.maxConcurrent,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      totalQueued: scheduler.queued,
      rejected: scheduler.rejected,
      cancelled: scheduler.cancelled,
      completed: scheduler.completed,
      failed: scheduler.failed,
      capacity: scheduler.capacity,
      errorRate: this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) : 0,
      circuitBreaker: this.circuitBreaker ? this.circuitBreaker.getState() : null,
      latency: scheduler.latency
    };
  }

  /**
   * Clears all queued requests with an error.
   * 
   * @param {Error} error - Error to reject all queued requests with
   */
  clearQueue(error = new Error('Queue cleared')) {
    this.admissionScheduler.clear(error);
  }

  /**
   * Resets metrics and circuit breaker.
   */
  reset() {
    this.admissionScheduler.reset();
    this.totalRequests = 0;
    this.totalErrors = 0;
    if (this.circuitBreaker) this.circuitBreaker.reset();
  }
}

/**
 * Creates a singleton request queue manager.
 * @type {RequestQueue|null}
 */
let globalRequestQueue = null;

/**
 * Gets or creates the global request queue instance.
 * 
 * @param {number} maxConcurrent - Maximum concurrent requests
 * @returns {RequestQueue} The global request queue instance
 */
function getRequestQueue(maxConcurrent = 10) {
  if (!globalRequestQueue) {
    globalRequestQueue = new RequestQueue(maxConcurrent);
  }
  return globalRequestQueue;
}

/**
 * Resets the global request queue instance.
 */
function resetRequestQueue() {
  if (globalRequestQueue) {
    globalRequestQueue.clearQueue();
    globalRequestQueue = null;
  }
}

module.exports = { 
  RequestQueue, 
  CircuitBreaker,
  getRequestQueue,
  resetRequestQueue
};
