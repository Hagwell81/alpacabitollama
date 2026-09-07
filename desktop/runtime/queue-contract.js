/* eslint-env node */
const QUEUE_OUTCOMES = Object.freeze(['active', 'queued', 'rejected', 'cancelled', 'completed', 'failed']);
const CIRCUIT_STATES = Object.freeze(['CLOSED', 'OPEN', 'HALF_OPEN']);

function createQueueStatus(input = {}) {
  return {
    active: Math.max(0, Number(input.active ?? input.activeRequests ?? 0)),
    queued: Math.max(0, Number(input.queued ?? input.queuedRequests ?? 0)),
    rejected: Math.max(0, Number(input.rejected ?? 0)),
    cancelled: Math.max(0, Number(input.cancelled ?? 0)),
    completed: Math.max(0, Number(input.completed ?? 0)),
    failed: Math.max(0, Number(input.failed ?? 0)),
    capacity: Math.max(0, Number(input.capacity ?? input.maxConcurrent ?? 0))
  };
}

function createCircuitStatus(input = {}) {
  const state = CIRCUIT_STATES.includes(input.state) ? input.state : 'CLOSED';
  return { providerId: input.providerId ? String(input.providerId) : undefined,
    operation: input.operation ? String(input.operation) : undefined, state,
    consecutiveFailures: Math.max(0, Number(input.consecutiveFailures ?? input.failureCount ?? 0)),
    ...(input.resetAt === undefined ? {} : { resetAt: Number(input.resetAt) }) };
}

module.exports = { QUEUE_OUTCOMES, CIRCUIT_STATES, createQueueStatus, createCircuitStatus };
