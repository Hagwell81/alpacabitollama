/* eslint-env node */
const { createCorrelationId } = require('./error-contract');

const RUNTIME_STATES = Object.freeze([
  'idle', 'acquiring', 'starting', 'ready', 'busy', 'stopping', 'failed', 'cancelling'
]);

function isRuntimeState(value) { return RUNTIME_STATES.includes(value); }

function createTransitionReason({ from, to, reasonCode, correlationId = createCorrelationId('transition'),
  at = Date.now(), progress, cancellable = false }) {
  if (!isRuntimeState(from) || !isRuntimeState(to)) throw new TypeError('Invalid runtime state');
  return {
    from, to, reasonCode: String(reasonCode || 'unspecified'), correlationId: String(correlationId),
    at: Number(at), ...(progress === undefined ? {} : { progress: Math.max(0, Math.min(100, Number(progress))) }),
    cancellable: Boolean(cancellable)
  };
}

function createRuntimeSnapshot({ state = 'idle', reason, provider, model, operation, queue, circuit,
  phase = { phase1Exit: 'pending', phase2Enabled: false } }) {
  if (!isRuntimeState(state)) throw new TypeError(`Unknown runtime state: ${state}`);
  return { state, reason, ...(provider ? { provider } : {}), ...(model ? { model } : {}),
    ...(operation ? { operation } : {}), queue: queue || {}, circuit: circuit || [], phase };
}

module.exports = { RUNTIME_STATES, isRuntimeState, createTransitionReason, createRuntimeSnapshot };
