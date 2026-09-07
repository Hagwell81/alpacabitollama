/* eslint-env node */
const { createCorrelationId } = require('./error-contract');

const MAX_CHECKS = 64;
const MAX_REASON_LENGTH = 240;
const MAX_DETAILS = 8;

function safeText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, MAX_REASON_LENGTH);
}

function safeDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).slice(0, MAX_DETAILS).filter(([key, item]) => {
    return /^[a-zA-Z0-9_.-]{1,64}$/.test(key) && ['string', 'number', 'boolean'].includes(typeof item);
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeOutcome(name, value) {
  if (value === true) return { name, passed: true };
  if (value === false || value == null) return { name, passed: false, reason: 'Check did not pass' };
  if (typeof value === 'object') {
    const passed = value.passed === true;
    return {
      name,
      passed,
      ...(passed ? {} : { reason: safeText(value.reason, 'Check did not pass') }),
      ...(safeDetails(value.details) ? { details: safeDetails(value.details) } : {})
    };
  }
  return { name, passed: false, reason: 'Check returned an invalid result' };
}

class Phase1ExitEvaluator {
  constructor(options = {}) {
    if (!options.featureGates) throw new TypeError('Phase1ExitEvaluator requires featureGates');
    this.featureGates = options.featureGates;
    this.onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : () => {};
    this.checks = new Map();
    this._lastReport = null;
    this._history = [];
    for (const check of options.checks || []) this.register(check.name, check.run || check.check);
    for (const [name, run] of Object.entries(options.checkMap || {})) this.register(name, run);
  }

  register(name, run) {
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (!normalized || normalized.length > 96) throw new TypeError('Phase 1 check names must be bounded and non-empty');
    if (typeof run !== 'function') throw new TypeError(`Phase 1 check ${normalized} must be a function`);
    if (this.checks.has(normalized)) throw new Error(`Duplicate Phase 1 check: ${normalized}`);
    if (this.checks.size >= MAX_CHECKS) throw new Error('Phase 1 check limit exceeded');
    this.checks.set(normalized, run);
    return this;
  }

  async evaluate(context = {}) {
    const correlationId = createCorrelationId('phase1');
    const checks = [];
    for (const [name, run] of this.checks) {
      try {
        checks.push(normalizeOutcome(name, await run(Object.freeze({ ...context }))));
      } catch (error) {
        checks.push({ name, passed: false, reason: safeText(error?.message, 'Check failed') });
      }
    }
    const failedChecks = checks.filter((check) => !check.passed).map((check) => ({ ...check }));
    const passed = checks.length > 0 && failedChecks.length === 0;
    const report = Object.freeze({
      correlationId,
      passed,
      evaluatedAt: new Date().toISOString(),
      checks: Object.freeze(checks.map((check) => Object.freeze({ ...check }))),
      failedChecks: Object.freeze(failedChecks.map((check) => Object.freeze({ ...check })))
    });
    this._lastReport = report;
    this._history = [...this._history.slice(-9), report];
    if (typeof this.featureGates.setPhase1Evaluation === 'function') this.featureGates.setPhase1Evaluation(report);
    if (passed) {
      this.featureGates.setPhase1ExitCriteriaPassed(true);
    } else {
      this.featureGates.rollback('phase1-check-failed');
    }
    try {
      this.onDiagnostic({
        type: 'phase1-exit-evaluation',
        correlationId,
        passed,
        failedChecks: failedChecks.map(({ name, reason }) => ({ name, reason }))
      });
    } catch (_) { /* diagnostics are best effort */ }
    return report;
  }

  lastReport() { return this._lastReport; }
  history() { return Object.freeze([...this._history]); }
  snapshot() {
    return Object.freeze({
      ...(this._lastReport ? { lastEvaluation: this._lastReport } : {}),
      phase1Passed: this.featureGates.phase1Passed()
    });
  }
}

module.exports = { Phase1ExitEvaluator, normalizeOutcome };
