/* eslint-env node */
/**
 * Request Manager Module
 * 
 * Provides CircuitBreaker and RequestQueue implementations for robust
 * API request management with automatic failure detection and recovery.
 * 
 * @module request-manager
 */

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
    this.failureCount = 0;
    this.state = 'CLOSED'; // States: CLOSED, OPEN, HALF_OPEN
    this.lastFailureTime = null;
  }

  /**
   * Records a successful request, resetting failure count.
   */
  recordSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
    }
  }

  /**
   * Records a failed request, incrementing failure count.
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
    }
  }

  /**
   * Determines if a request can be attempted based on circuit state.
   * 
   * @returns {boolean} True if request can be attempted
   */
  canAttempt() {
    if (this.state === 'CLOSED') return true;
    
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure > this.resetMs) {
        this.state = 'HALF_OPEN';
        this.failureCount = 0;
        return true;
      }
      return false;
    }
    
    return this.state === 'HALF_OPEN';
  }

  /**
   * Gets current circuit breaker state information.
   * 
   * @returns {Object} Circuit breaker status
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      threshold: this.threshold,
      timeSinceLastFailure: this.lastFailureTime ? Date.now() - this.lastFailureTime : null,
      resetMs: this.resetMs,
      resetIn: this.state === 'OPEN' && this.lastFailureTime 
        ? Math.max(0, this.resetMs - (Date.now() - this.lastFailureTime))
        : 0
    };
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
    this.activeRequests = 0;
    this.queue = [];
    this.circuitBreaker = enableCircuitBreaker 
      ? new CircuitBreaker(circuitBreakerThreshold, circuitBreakerResetMs) 
      : null;
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.totalQueued = 0;
    this.requestLatencies = [];
    this.maxLatencyHistory = 100; // Keep last 100 latency measurements
  }

  /**
   * Adds a task to the queue and executes when capacity allows.
   * 
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Promise that resolves with task result
   */
  async enqueue(fn) {
    this.totalRequests++;
    
    return new Promise((resolve, reject) => {
      const task = { 
        fn, 
        resolve, 
        reject, 
        enqueuedAt: Date.now(),
        id: `req-${this.totalRequests}`
      };
      
      if (this.activeRequests < this.maxConcurrent && this.canAttempt()) {
        this.executeTask(task);
      } else {
        this.totalQueued++;
        this.queue.push(task);
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
    
    return new Promise((resolve, reject) => {
      const task = { 
        fn, 
        resolve, 
        reject, 
        enqueuedAt: Date.now(),
        id: `req-${this.totalRequests}`
      };
      
      if (this.activeRequests < this.maxConcurrent && this.canAttempt()) {
        this.executeTask(task);
      } else if (this.queue.length >= this.maxConcurrent * 2) {
        // Queue is full, reject immediately
        reject(new Error('Too Many Requests'));
      } else {
        this.totalQueued++;
        this.queue.push(task);
      }
    });
  }

  /**
   * Executes a task and tracks metrics.
   * 
   * @param {Object} task - Task object with fn, resolve, reject
   */
  executeTask(task) {
    this.activeRequests++;
    const startTime = Date.now();
    
    Promise.resolve()
      .then(() => {
        if (!this.canAttempt()) {
          throw new Error('Circuit breaker is OPEN');
        }
        return task.fn();
      })
      .then((result) => {
        if (this.circuitBreaker) {
          this.circuitBreaker.recordSuccess();
        }
        
        // Record latency
        const latency = Date.now() - task.enqueuedAt;
        this.requestLatencies.push(latency);
        if (this.requestLatencies.length > this.maxLatencyHistory) {
          this.requestLatencies.shift();
        }
        
        task.resolve(result);
      })
      .catch((error) => {
        this.totalErrors++;
        if (this.circuitBreaker) {
          this.circuitBreaker.recordFailure();
        }
        task.reject(error);
      })
      .finally(() => {
        this.activeRequests--;
        this.processQueue();
      });
  }

  /**
   * Processes the next task in queue if capacity allows.
   */
  processQueue() {
    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent && this.canAttempt()) {
      const task = this.queue.shift();
      this.executeTask(task);
    }
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
    const latencies = this.requestLatencies;
    const sorted = [...latencies].sort((a, b) => a - b);
    
    return {
      activeRequests: this.activeRequests,
      queuedRequests: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      totalQueued: this.totalQueued,
      errorRate: this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) : 0,
      circuitBreaker: this.circuitBreaker ? this.circuitBreaker.getState() : null,
      latency: {
        count: latencies.length,
        p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
        min: sorted[0] || 0,
        max: sorted[sorted.length - 1] || 0,
      }
    };
  }

  /**
   * Clears all queued requests with an error.
   * 
   * @param {Error} error - Error to reject all queued requests with
   */
  clearQueue(error = new Error('Queue cleared')) {
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      task.reject(error);
    }
  }

  /**
   * Resets metrics and circuit breaker.
   */
  reset() {
    this.failureCount = 0;
    this.requestLatencies = [];
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.totalQueued = 0;
    if (this.circuitBreaker) {
      this.circuitBreaker.failureCount = 0;
      this.circuitBreaker.state = 'CLOSED';
      this.circuitBreaker.lastFailureTime = null;
    }
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
