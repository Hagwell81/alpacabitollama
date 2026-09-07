/* eslint-env node */
/**
 * Runtime feature gates. Phase 2 is deliberately fail-closed: it cannot be
 * enabled unless the Phase 1 exit gate has been explicitly passed.
 */
const PHASE_2_FLAGS = Object.freeze([
  'phase2RemoteProviders',
  'phase2Discovery',
  'phase2Calibration'
]);

function normalizeBoolean(value) {
  return value === true;
}

class FeatureGates {
  constructor(options = {}) {
    this._onRollback = typeof options.onRollback === 'function' ? options.onRollback : () => {};
    this._rollback = null;
    this._lastEvaluation = null;
    this._flags = {
      runtimeLifecycleV1: options.runtimeLifecycleV1 !== false,
      phase1ExitCriteriaPassed: normalizeBoolean(options.phase1ExitCriteriaPassed),
      phase2RemoteProviders: false,
      phase2Discovery: false,
      phase2Calibration: false
    };
    this._applyPhase2(options.phase2Flags || options);
  }

  _applyPhase2(values = {}) {
    if (!this._flags.phase1ExitCriteriaPassed) return;
    for (const flag of PHASE_2_FLAGS) {
      if (values[flag] === true) this._flags[flag] = true;
    }
  }

  isEnabled(flag) {
    return this._flags[flag] === true;
  }

  phase1Passed() {
    return this._flags.phase1ExitCriteriaPassed;
  }

  enablePhase2(flags = {}) {
    if (!this.phase1Passed()) return false;
    this._applyPhase2(flags);
    return true;
  }

  setPhase1ExitCriteriaPassed(passed) {
    this._flags.phase1ExitCriteriaPassed = normalizeBoolean(passed);
    if (!this._flags.phase1ExitCriteriaPassed) this.disableOptional();
    else this._rollback = null;
    return this.snapshot();
  }

  rollback(reason = 'phase1-failed') {
    const safeReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 160) : 'phase1-failed';
    this._flags.phase1ExitCriteriaPassed = false;
    this.disableOptional();
    this._rollback = { reason: safeReason, rolledBack: true, at: new Date().toISOString() };
    const result = Object.freeze({ ...this._rollback, flags: this.snapshot() });
    try { this._onRollback(result); } catch (_) { /* rollback must remain fail-closed if observers fail */ }
    return result;
  }

  setPhase1Evaluation(report) {
    this._lastEvaluation = report && typeof report === 'object' ? Object.freeze({ ...report }) : null;
    return this.evaluationState();
  }

  evaluationState() {
    return Object.freeze({
      phase1Passed: this.phase1Passed(),
      ...(this._lastEvaluation ? { lastEvaluation: this._lastEvaluation } : {}),
      ...(this._rollback ? { rollback: Object.freeze({ ...this._rollback }) } : {})
    });
  }

  rollbackState() {
    return this._rollback ? Object.freeze({ ...this._rollback }) : null;
  }

  disableOptional() {
    for (const flag of PHASE_2_FLAGS) this._flags[flag] = false;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({ ...this._flags });
  }
}

function createFeatureGates(options) {
  return new FeatureGates(options);
}

module.exports = { PHASE_2_FLAGS, FeatureGates, createFeatureGates };
