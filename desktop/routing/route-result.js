/* eslint-env node */
/**
 * Route result types (Task 14.1)
 * Requirement 20.3: typed no-route results.
 */
const ROUTE_OUTCOMES = Object.freeze(['routed', 'no-route', 'fallback', 'cancelled']);

function createRouteResult(input = {}) {
  const outcome = ROUTE_OUTCOMES.includes(input.outcome) ? input.outcome : 'no-route';
  return Object.freeze({
    outcome,
    ...(input.modelDigest ? { modelDigest: String(input.modelDigest) } : {}),
    ...(input.providerId ? { providerId: String(input.providerId) } : {}),
    ...(input.reason ? { reason: String(input.reason) } : {}),
    ...(input.fitPlan ? { fitPlan: Object.freeze({ ...input.fitPlan }) } : {}),
    ...(input.readinessOutcome ? { readinessOutcome: Object.freeze({ ...input.readinessOutcome }) } : {}),
    ...(input.correlationId ? { correlationId: String(input.correlationId) } : {})
  });
}

function createNoRouteResult(reason, correlationId) {
  return createRouteResult({ outcome: 'no-route', reason, correlationId });
}

function createFallbackResult(reason, correlationId) {
  return createRouteResult({ outcome: 'fallback', reason, correlationId });
}

function createRoutedResult(input, correlationId) {
  return createRouteResult({ ...input, outcome: 'routed', correlationId });
}

module.exports = { ROUTE_OUTCOMES, createRouteResult, createNoRouteResult, createFallbackResult, createRoutedResult };
