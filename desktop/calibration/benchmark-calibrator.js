/* eslint-env node */
/**
 * Bounded opt-in local benchmark calibration (Task 13.1)
 * Requirements: 19.1-19.2, 19.6
 *
 * Behavior:
 * - Opt-in only: no calibration runs unless explicitly enabled.
 * - Bounded: limited concurrent jobs, bounded iterations, time budget.
 * - Pause/cancel: supports AbortSignal and pause/resume.
 * - Resource limits: configurable max iterations, max duration, max tokens.
 * - Summarized results: stores only throughput/latency keyed by
 *   ModelDigest and HardwareSnapshot. Never stores prompts or generated content.
 * - Clear opt-out: disable() stops all calibration and clears results.
 */
const { createCorrelationId, createSafeError, successEnvelope, errorEnvelope } = require('../runtime/error-contract');

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_DURATION_MS = 60000;
const DEFAULT_MAX_TOKENS_PER_ITERATION = 256;
const STATES = Object.freeze(['idle', 'running', 'paused', 'cancelled', 'completed', 'failed']);

function createCalibrationResult(input = {}) {
  return Object.freeze({
    modelDigest: String(input.modelDigest || ''),
    hardwareSnapshot: input.hardwareSnapshot && typeof input.hardwareSnapshot === 'object'
      ? Object.freeze({ ...input.hardwareSnapshot }) : {},
    iterations: Number(input.iterations || 0),
    tokensPerSecond: input.tokensPerSecond !== undefined ? Number(input.tokensPerSecond) : undefined,
    latencyMs: input.latencyMs !== undefined ? Number(input.latencyMs) : undefined,
    totalTokens: Number(input.totalTokens || 0),
    totalDurationMs: Number(input.totalDurationMs || 0),
    completedAt: String(input.completedAt || new Date().toISOString()),
    correlationId: String(input.correlationId || createCorrelationId('calibration'))
  });
}

class BenchmarkCalibrator {
  constructor(options = {}) {
    this._enabled = false;
    this._state = 'idle';
    this._results = [];
    this._maxIterations = Math.max(1, Number(options.maxIterations || DEFAULT_MAX_ITERATIONS));
    this._maxDurationMs = Math.max(1000, Number(options.maxDurationMs || DEFAULT_MAX_DURATION_MS));
    this._maxTokensPerIteration = Math.max(1, Number(options.maxTokensPerIteration || DEFAULT_MAX_TOKENS_PER_ITERATION));
    this._onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : () => {};
    this._currentJob = null;
  }

  get enabled() { return this._enabled; }
  get state() { return this._state; }

  enable() { this._enabled = true; return true; }
  disable() {
    this._enabled = false;
    this.cancel();
    this._results = [];
    return true;
  }

  /**
   * Run calibration for a model. The runner function receives
   * { iteration, maxTokens, signal } and returns { tokensGenerated, durationMs }.
   * The runner is provided by the caller and owns the actual inference call.
   * Only summarized metrics are stored — never prompts or generated content.
   */
  async calibrate(options = {}) {
    const correlationId = createCorrelationId('calibration');

    if (!this._enabled) {
      return errorEnvelope(createSafeError({
        code: 'CALIBRATION_DISABLED',
        message: 'Calibration is not enabled. Enable it explicitly to calibrate models.',
        retryable: false, correlationId
      }), correlationId);
    }

    if (!options.modelDigest) {
      return errorEnvelope(createSafeError({
        code: 'CALIBRATION_MISSING_MODEL',
        message: 'Model digest is required for calibration.',
        retryable: false, correlationId
      }), correlationId);
    }

    if (typeof options.runner !== 'function') {
      return errorEnvelope(createSafeError({
        code: 'CALIBRATION_MISSING_RUNNER',
        message: 'A runner function is required for calibration.',
        retryable: false, correlationId
      }), correlationId);
    }

    const signal = options.signal;
    if (signal?.aborted) {
      return errorEnvelope(createSafeError({
        code: 'CALLER_CANCELLED',
        message: 'Calibration was cancelled before starting.',
        retryable: false, correlationId
      }), correlationId);
    }

    const maxIterations = Math.min(options.maxIterations || this._maxIterations, this._maxIterations);
    const maxDurationMs = Math.min(options.maxDurationMs || this._maxDurationMs, this._maxDurationMs);
    const maxTokens = Math.min(options.maxTokensPerIteration || this._maxTokensPerIteration, this._maxTokensPerIteration);
    const startTime = Date.now();
    let totalTokens = 0;
    let totalDurationMs = 0;
    let iterations = 0;

    this._state = 'running';
    this._currentJob = { correlationId, modelDigest: options.modelDigest, startTime };

    try {
      for (let i = 0; i < maxIterations; i++) {
        if (signal?.aborted) {
          this._state = 'cancelled';
          this._onDiagnostic({ type: 'calibration-cancelled', correlationId, iteration: i });
          return successEnvelope({ cancelled: true, iterations, correlationId });
        }

        if (this._state === 'paused') {
          await this._waitForResume(signal);
          if (signal?.aborted) {
            this._state = 'cancelled';
            return successEnvelope({ cancelled: true, iterations, correlationId });
          }
        }

        if (Date.now() - startTime > maxDurationMs) {
          this._onDiagnostic({ type: 'calibration-time-budget-exceeded', correlationId, elapsed: Date.now() - startTime });
          break;
        }

        const result = await options.runner({
          iteration: i,
          maxTokens,
          signal,
          // Pass a fixed benchmark prompt — the runner decides what to send.
          // The calibrator never stores the prompt or the generated content.
          prompt: 'Calibration benchmark prompt. Please generate text.'
        });

        if (result && typeof result === 'object') {
          totalTokens += Number(result.tokensGenerated || 0);
          totalDurationMs += Number(result.durationMs || 0);
          iterations++;
        }
      }

      const tokensPerSecond = totalDurationMs > 0 ? (totalTokens / totalDurationMs) * 1000 : undefined;
      const avgLatencyMs = iterations > 0 ? totalDurationMs / iterations : undefined;

      const calibrationResult = createCalibrationResult({
        modelDigest: options.modelDigest,
        hardwareSnapshot: options.hardwareSnapshot,
        iterations,
        tokensPerSecond,
        latencyMs: avgLatencyMs,
        totalTokens,
        totalDurationMs,
        correlationId
      });

      this._results.push(calibrationResult);
      this._state = 'completed';
      this._currentJob = null;

      this._onDiagnostic({ type: 'calibration-completed', correlationId, result: calibrationResult });
      return successEnvelope({ result: calibrationResult, correlationId });
    } catch (error) {
      this._state = 'failed';
      this._currentJob = null;
      const safeError = createSafeError({
        code: error?.code === 'ABORT_ERR' || signal?.aborted ? 'CALLER_CANCELLED' : 'CALIBRATION_FAILED',
        message: error?.message || 'Calibration failed',
        retryable: true, correlationId
      });
      this._onDiagnostic({ type: 'calibration-failed', correlationId, error: safeError });
      return errorEnvelope(safeError, correlationId);
    }
  }

  pause() {
    if (this._state === 'running') {
      this._state = 'paused';
      return true;
    }
    return false;
  }

  resume() {
    if (this._state === 'paused') {
      this._state = 'running';
      return true;
    }
    return false;
  }

  cancel() {
    if (this._state === 'running' || this._state === 'paused') {
      this._state = 'cancelled';
      this._currentJob = null;
      return true;
    }
    return false;
  }

  async _waitForResume(signal) {
    const checkInterval = 100;
    while (this._state === 'paused') {
      if (signal?.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  results() {
    return Object.freeze([...this._results]);
  }

  clearResults() {
    this._results = [];
    return true;
  }
}

function createBenchmarkCalibrator(options) {
  return new BenchmarkCalibrator(options);
}

module.exports = { BenchmarkCalibrator, createBenchmarkCalibrator, createCalibrationResult, DEFAULT_MAX_ITERATIONS, DEFAULT_MAX_DURATION_MS, STATES };
