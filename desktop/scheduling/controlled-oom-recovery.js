/* eslint-env node */
const {
  ERROR_CODES,
  createSafeError,
  serializeError
} = require('../runtime/error-contract');

const OOM_CODES = new Set([
  ERROR_CODES.OUT_OF_MEMORY,
  'OOM',
  'OUT_OF_MEMORY',
  'ERR_OUT_OF_MEMORY',
  'CUDA_OUT_OF_MEMORY',
  'ROCM_OUT_OF_MEMORY'
]);
const OOM_MESSAGES = /(?:out\s*of\s*(?:system\s+)?memory|\boom\b|memory\s+allocation\s+failed)/i;
const CANCELLATION_CODES = new Set([ERROR_CODES.CALLER_CANCELLED, 'CANCELLED', 'CANCELED']);

function cancellationError() {
  return Object.assign(new Error('The request was cancelled.'), createSafeError({
    code: ERROR_CODES.CALLER_CANCELLED,
    message: 'The request was cancelled.',
    retryable: false
  }));
}

function isCancellation(error, signal) {
  return Boolean(signal?.aborted)
    || CANCELLATION_CODES.has(String(error?.code || '').toUpperCase())
    || String(error?.name || '').toLowerCase() === 'aborterror'
    || error?.cancelled === true
    || error?.canceled === true;
}

function isRecognizedOom(error) {
  if (!error || isCancellation(error)) return false;
  const code = String(error.code || error.details?.code || '').toUpperCase();
  if (OOM_CODES.has(code)) return true;
  const type = String(error.type || error.kind || error.statusText || '').toUpperCase();
  return OOM_CODES.has(type) || OOM_MESSAGES.test(String(error.message || ''));
}

class ControlledOomRecoveryError extends Error {
  constructor(original, recovery) {
    super('The request failed after controlled out-of-memory recovery.');
    this.name = 'ControlledOomRecoveryError';
    this.original = serializeError(original);
    this.recovery = isCancellation(recovery) ? serializeError(cancellationError()) : serializeError(recovery);
    Object.assign(this, createSafeError({
      code: isCancellation(recovery) ? ERROR_CODES.CALLER_CANCELLED : ERROR_CODES.OOM_RECOVERY_FAILED,
      message: isCancellation(recovery) ? 'The request was cancelled.' : this.message,
      retryable: false,
      recoveryAction: isCancellation(recovery) ? 'No retry was performed' : 'Choose a smaller model or reduce context',
      details: { originalCode: this.original.code, recoveryCode: this.recovery.code }
    }));
  }
}

/**
 * Executes one logical request, allowing exactly one injected recovery and retry
 * after a conservative OOM classification. The retry stays inside one scheduler
 * admission and receives the same id and AbortSignal.
 */
async function executeWithControlledOomRecovery(execute, options = {}) {
  if (typeof execute !== 'function') throw new TypeError('execute must be a function');
  const signal = options.signal;
  const context = { id: options.id, signal, attempt: 0, recovery: false };
  let original;
  try {
    return await execute(context);
  } catch (error) {
    if (!isRecognizedOom(error)) throw error;
    original = error;
  }

  if (isCancellation(original, signal)) throw cancellationError();
  if (typeof options.recover === 'function') {
    try {
      await options.recover({ error: original, id: options.id, signal, attempt: 0 });
    } catch (error) {
      if (isCancellation(error, signal)) throw cancellationError();
      throw new ControlledOomRecoveryError(original, error);
    }
  }
  if (signal?.aborted) throw cancellationError();

  try {
    const value = await execute({ id: options.id, signal, attempt: 1, recovery: true });
    return {
      value,
      original: { success: false, error: serializeError(original) },
      recovery: { success: true, value }
    };
  } catch (error) {
    if (isCancellation(error, signal)) throw cancellationError();
    throw new ControlledOomRecoveryError(original, error);
  }
}

function createControlledOomRecovery(execute, options) {
  return () => executeWithControlledOomRecovery(execute, options);
}

module.exports = {
  ControlledOomRecoveryError,
  createControlledOomRecovery,
  executeWithControlledOomRecovery,
  isRecognizedOom,
  isCancellation
};
