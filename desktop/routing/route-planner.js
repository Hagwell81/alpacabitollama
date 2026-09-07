/* eslint-env node */
/**
 * Opt-in route candidate evaluation (Task 14.1)
 * Requirements: 20.1, 20.3, 20.6
 *
 * Evaluates route candidates using capabilities, fit plans, privacy/availability
 * constraints, user preferences, and current scheduler state. Returns typed
 * no-route results and preserves configured fallback behavior.
 *
 * The route planner is pure: it does not own model loading, network access,
 * or scheduler mutations. It evaluates candidates and returns a decision.
 */
const { createCorrelationId } = require('../runtime/error-contract');
const { createRouteResult, createNoRouteResult, createFallbackResult, createRoutedResult } = require('./route-result');

const DEFAULT_PREFERENCES = Object.freeze({
  preferLocal: true,
  preferVerified: true,
  maxCandidates: 10
});

/**
 * Evaluate a set of model candidates and return a route decision.
 *
 * @param {Object} input
 * @param {Array} input.candidates - Model records with { id, providerId, digest, capabilities, fitPlan, availability, origin, verification }
 * @param {Object} input.requestCapabilities - Required capabilities (e.g. { streaming: true, chat: true })
 * @param {Object} input.preferences - User preferences (e.g. { preferLocal: true })
 * @param {Object} input.schedulerState - Current scheduler state (e.g. { hasActiveLoad: false })
 * @param {Object} input.phaseGates - Feature gate snapshot
 * @param {string} input.fallbackModelId - Configured fallback model
 * @param {AbortSignal} input.signal - Optional cancellation signal
 */
function planRoute(input = {}) {
  const correlationId = createCorrelationId('route');

  if (input.signal?.aborted) {
    return createRouteResult({ outcome: 'cancelled', reason: 'Route planning was cancelled.', correlationId });
  }

  // Phase gate: routing requires phase 1 passed
  if (!input.phaseGates?.phase1ExitCriteriaPassed) {
    return createNoRouteResult('Phase 1 exit criteria not satisfied; routing unavailable.', correlationId);
  }

  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  if (candidates.length === 0) {
    return createNoRouteResult('No candidates available for routing.', correlationId);
  }

  // Need at least 2 compatible models for routing (Requirement 20.1)
  if (candidates.length < 2) {
    return createNoRouteResult('Routing requires at least two compatible models.', correlationId);
  }

  const prefs = { ...DEFAULT_PREFERENCES, ...(input.preferences || {}) };
  const requiredCapabilities = input.requestCapabilities || {};
  const schedulerState = input.schedulerState || {};

  // Filter by required capabilities
  const capable = candidates.filter((c) => {
    const caps = c.capabilities || [];
    return Object.entries(requiredCapabilities).every(([key, required]) =>
      !required || caps.includes(key) || caps[key] === true
    );
  });

  if (capable.length === 0) {
    return createNoRouteResult('No candidate satisfies required capabilities.', correlationId);
  }

  // Filter by availability
  const available = capable.filter((c) => c.availability === 'available' || c.availability === 'stale');
  if (available.length === 0) {
    if (input.fallbackModelId) {
      return createFallbackResult('No available candidate; using configured fallback.', correlationId);
    }
    return createNoRouteResult('No candidate is currently available.', correlationId);
  }

  // Filter by fit plan (exclude does-not-fit)
  const fitting = available.filter((c) => {
    const fit = c.fitPlan;
    if (!fit) return true; // unknown fit is allowed but ranked lower
    return fit.status !== 'does-not-fit';
  });

  if (fitting.length === 0) {
    return createNoRouteResult('No candidate fits within resource constraints.', correlationId);
  }

  // Filter by privacy constraints: if preferLocal, exclude remote unless no local exists
  let eligible = fitting;
  if (prefs.preferLocal) {
    const local = fitting.filter((c) => c.origin === 'local' || c.origin === 'loopback');
    if (local.length > 0) eligible = local;
  }

  // Filter by verification if preferVerified
  if (prefs.preferVerified) {
    const verified = eligible.filter((c) => c.verification === 'verified');
    if (verified.length > 0) eligible = verified;
  }

  // Check scheduler state: if one-load-at-a-time and a load is active,
  // prefer the currently loaded model if it's in the candidate set
  if (schedulerState.hasActiveLoad && schedulerState.activeModelId) {
    const active = eligible.find((c) => c.id === schedulerState.activeModelId);
    if (active) {
      return createRoutedResult({
        modelDigest: active.digest,
        providerId: active.providerId,
        reason: 'Currently loaded model selected (one-load-at-a-time).',
        fitPlan: active.fitPlan
      }, correlationId);
    }
  }

  // Rank by fit status (fits > tight > unknown), then by preference order
  const ranked = eligible.slice().sort((a, b) => {
    const fitOrder = { fits: 0, tight: 1, unknown: 2 };
    const aFit = fitOrder[a.fitPlan?.status] ?? 3;
    const bFit = fitOrder[b.fitPlan?.status] ?? 3;
    if (aFit !== bFit) return aFit - bFit;
    // Prefer local as tiebreaker
    const aLocal = a.origin === 'local' || a.origin === 'loopback' ? 0 : 1;
    const bLocal = b.origin === 'local' || b.origin === 'loopback' ? 0 : 1;
    return aLocal - bLocal;
  });

  const best = ranked[0];
  return createRoutedResult({
    modelDigest: best.digest,
    providerId: best.providerId,
    reason: `Selected ${best.id} based on fit and preferences.`,
    fitPlan: best.fitPlan
  }, correlationId);
}

module.exports = { planRoute, DEFAULT_PREFERENCES };
