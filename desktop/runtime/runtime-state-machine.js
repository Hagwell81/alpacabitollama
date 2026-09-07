/* eslint-env node */
const {
  RUNTIME_STATES,
  isRuntimeState,
  createTransitionReason
} = require('./runtime-contract');
const { ERROR_CODES, createCorrelationId, createSafeError } = require('./error-contract');

/**
 * The public lifecycle graph. Keep this table explicit: internal work such as
 * health checking belongs in operation metadata, not in the public state set.
 */
const RUNTIME_STATE_ADJACENCY = Object.freeze({
  idle: Object.freeze(['acquiring']),
  acquiring: Object.freeze(['starting', 'failed']),
  starting: Object.freeze(['ready', 'failed']),
  ready: Object.freeze(['busy', 'stopping']),
  busy: Object.freeze(['ready', 'cancelling']),
  stopping: Object.freeze(['idle', 'failed']),
  failed: Object.freeze(['acquiring', 'idle']),
  cancelling: Object.freeze(['ready'])
});

const DEFAULT_HISTORY_LIMIT = 100;

function normalizeLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_HISTORY_LIMIT;
}

class RuntimeStateMachine {
  constructor({
    initialState = 'idle',
    historyLimit = DEFAULT_HISTORY_LIMIT,
    onDiagnostic,
    diagnostics
  } = {}) {
    if (!isRuntimeState(initialState)) throw new TypeError(`Unknown runtime state: ${initialState}`);
    this._state = initialState;
    this._reason = null;
    this._history = [];
    this._historyLimit = normalizeLimit(historyLimit);
    this._operationEpoch = 0;
    this._onDiagnostic = onDiagnostic || diagnostics;
  }

  get state() { return this._state; }
  get currentState() { return this._state; }
  get reason() { return this._reason; }
  get operationEpoch() { return this._operationEpoch; }
  get historyLimit() { return this._historyLimit; }

  getState() { return this._state; }
  getOperationEpoch() { return this._operationEpoch; }
  getHistory() { return this._history.map((entry) => ({ ...entry })); }

  snapshot() {
    return {
      state: this._state,
      ...(this._reason ? { reason: { ...this._reason } } : {}),
      operationEpoch: this._operationEpoch
    };
  }

  canTransition(from, to) {
    return isRuntimeState(from) && isRuntimeState(to)
      && RUNTIME_STATE_ADJACENCY[from].includes(to);
  }

  /** Start a new lifecycle operation and invalidate completions from older work. */
  beginOperation() {
    this._operationEpoch += 1;
    return this._operationEpoch;
  }

  /** Alias useful to coordinators which call this an epoch rollover. */
  advanceOperationEpoch() { return this.beginOperation(); }

  isCurrentEpoch(epoch) {
    return Number.isInteger(epoch) && epoch === this._operationEpoch;
  }

  isEpochCurrent(epoch) { return this.isCurrentEpoch(epoch); }

  /**
   * Commit a public transition. Both transition('ready', options) and
   * transition({to: 'ready', ...options}) are accepted for small integrations.
   * A rejected result never mutates state or history.
   */
  transition(target, options = {}) {
    const input = typeof target === 'string' ? { ...options, to: target } : { ...(target || {}) };
    const {
      to,
      reasonCode = 'unspecified',
      correlationId = createCorrelationId('transition'),
      at = Date.now(),
      progress,
      cancellable = false,
      epoch
    } = input;
    const from = this._state;

    if (!isRuntimeState(to)) {
      return this._reject({ from, to, reasonCode, correlationId, at, epoch,
        code: ERROR_CODES.INVALID_TRANSITION, message: `Unknown runtime state: ${String(to)}` });
    }

    if (epoch !== undefined && !this.isCurrentEpoch(epoch)) {
      return this._reject({ from, to, reasonCode: 'stale-operation-epoch', correlationId, at, epoch,
        code: ERROR_CODES.INVALID_TRANSITION,
        message: `Stale operation epoch ${String(epoch)} cannot transition runtime state` });
    }

    if (!this.canTransition(from, to)) {
      return this._reject({ from, to, reasonCode, correlationId, at, epoch,
        code: ERROR_CODES.INVALID_TRANSITION,
        message: `Invalid runtime transition from ${from} to ${to}` });
    }

    const reason = createTransitionReason({ from, to, reasonCode, correlationId, at, progress, cancellable });
    this._state = to;
    this._reason = reason;
    this._history.push(reason);
    if (this._history.length > this._historyLimit) this._history.splice(0, this._history.length - this._historyLimit);
    return { ...this.snapshot(), accepted: true };
  }

  transitionOrThrow(target, options = {}) {
    const result = this.transition(target, options);
    if (!result.accepted) {
      const error = new Error(result.error.message);
      Object.assign(error, result.error);
      throw error;
    }
    return result;
  }

  _reject({ from, to, reasonCode, correlationId, at, epoch, code, message }) {
    const diagnostic = {
      timestamp: Number(at),
      severity: 'error',
      subsystem: 'runtime',
      operation: 'lifecycle-transition',
      correlationId: String(correlationId),
      runtimeState: from,
      attemptedTransition: { from, to },
      reasonCode: String(reasonCode || 'unspecified'),
      ...(epoch === undefined ? {} : { operationEpoch: epoch }),
      error: createSafeError({
        code,
        message,
        retryable: false,
        recoveryAction: 'Open diagnostics',
        correlationId
      })
    };
    if (typeof this._onDiagnostic === 'function') this._onDiagnostic(diagnostic);
    return {
      accepted: false,
      ...this.snapshot(),
      diagnostic,
      error: diagnostic.error
    };
  }
}

module.exports = {
  RUNTIME_STATE_ADJACENCY,
  ALLOWED_TRANSITIONS: RUNTIME_STATE_ADJACENCY,
  RuntimeStateMachine,
  DEFAULT_HISTORY_LIMIT
};
