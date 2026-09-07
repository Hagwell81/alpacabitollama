/* eslint-env node */
/** Serializable, renderer-safe error contracts shared by runtime services. */

const ERROR_CODES = Object.freeze({
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  ENSURE_READY: 'ENSURE_READY',
  PROVIDER_UNSUPPORTED_CAPABILITY: 'PROVIDER_UNSUPPORTED_CAPABILITY',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_PROTOCOL: 'PROVIDER_PROTOCOL',
  PROVIDER_AUTH: 'PROVIDER_AUTH',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  CALLER_CANCELLED: 'CALLER_CANCELLED',
  SHUTDOWN: 'SHUTDOWN',
  REPLACEMENT: 'REPLACEMENT',
  CAPACITY: 'CAPACITY',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  FIT_UNKNOWN: 'FIT_UNKNOWN',
  FIT_INSUFFICIENT: 'FIT_INSUFFICIENT',
  ARTIFACT_DIGEST_MISMATCH: 'ARTIFACT_DIGEST_MISMATCH',
  ARTIFACT_SIGNATURE: 'ARTIFACT_SIGNATURE',
  UNSAFE_ARCHIVE: 'UNSAFE_ARCHIVE',
  CONFIG_MIGRATION: 'CONFIG_MIGRATION',
  RECOVERY_MODE: 'RECOVERY_MODE',
  STREAM_HEARTBEAT_TIMEOUT: 'STREAM_HEARTBEAT_TIMEOUT',
  STREAM_MALFORMED_EVENT: 'STREAM_MALFORMED_EVENT',
  CONTEXT_OVERFLOW: 'CONTEXT_OVERFLOW',
  OUT_OF_MEMORY: 'OUT_OF_MEMORY',
  OOM_RECOVERY_FAILED: 'OOM_RECOVERY_FAILED',
  UNKNOWN: 'UNKNOWN'
});

function createCorrelationId(prefix = 'corr') {
  const value = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${value}`;
}

function safeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  return Object.fromEntries(Object.entries(details).filter(([, value]) => (
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  )));
}

function createSafeError({ code = ERROR_CODES.UNKNOWN, message, retryable = false,
  recoveryAction = 'Open diagnostics', correlationId = createCorrelationId(), details }) {
  return {
    code: String(code),
    message: String(message || 'The operation could not be completed.'),
    retryable: Boolean(retryable),
    recoveryAction: String(recoveryAction || 'Open diagnostics'),
    correlationId: String(correlationId),
    ...(safeDetails(details) ? { details: safeDetails(details) } : {})
  };
}

function errorEnvelope(error, correlationId = error?.correlationId || createCorrelationId()) {
  const safe = createSafeError({ ...(error || {}), correlationId });
  return { success: false, correlationId, error: safe };
}

function successEnvelope(data, correlationId = createCorrelationId()) {
  return { success: true, correlationId, data };
}

function serializeError(error) {
  return createSafeError({
    code: error?.code,
    message: error?.message,
    retryable: error?.retryable,
    recoveryAction: error?.recoveryAction,
    correlationId: error?.correlationId,
    details: error?.details
  });
}

module.exports = {
  ERROR_CODES,
  createCorrelationId,
  createSafeError,
  serializeError,
  successEnvelope,
  errorEnvelope
};
