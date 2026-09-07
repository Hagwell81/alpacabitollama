/* eslint-env node */
/** Normalization helpers shared by provider adapters and their tests. */
const { createCorrelationId, createSafeError, successEnvelope, errorEnvelope, serializeError } = require('../runtime/error-contract');
const { createModelPage, createReadyResult, createHealthStatus, createProviderStatus } = require('./provider-contract');

const SECRET_PATTERN = /((?:authorization|api[-_ ]?key|access[-_ ]?token|secret|password|private[-_ ]?key)\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/ig;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s/]+(?::[^\s/@]+)?@[^\s/]+/ig;
const HOME_PATH_PATTERN = /(?:[A-Z]:\\Users\\[^\r\n,]+?\.(?:gguf|bin|safetensors)|\/(?:home|Users)\/[^\r\n,]+?\.(?:gguf|bin|safetensors))/ig;

function redactText(value) {
  return String(value || 'Provider request failed.')
    .replace(SECRET_PATTERN, '$1[REDACTED]')
    .replace(CREDENTIAL_URL_PATTERN, '[REDACTED_URL]')
    .replace(HOME_PATH_PATTERN, '[REDACTED_PATH]');
}

function normalizeProviderError(error, context = {}) {
  const source = error && typeof error === 'object' ? error : { message: error };
  const code = String(source.code || context.code || 'PROVIDER_UNAVAILABLE');
  const correlationId = String(source.correlationId || context.correlationId || createCorrelationId());
  const operation = context.operation || source.operation || 'provider-request';
  const providerId = context.providerId || source.providerId;
  const retryable = source.retryable === undefined
    ? ['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(code)
    : Boolean(source.retryable);
  // Provider errors cross a trust boundary: only the documented, non-content
  // context is allowed through. In particular, do not copy arbitrary wire
  // details (which may contain credentials, paths, URLs, or response bodies).
  const details = {
    ...(providerId ? { providerId: redactText(providerId) } : {}),
    operation: redactText(operation)
  };
  return createSafeError({ code, message: redactText(source.safeMessage || source.message), retryable,
    recoveryAction: source.recoveryAction || (retryable ? 'Retry' : 'Open diagnostics'), correlationId, details });
}

function normalizeError(error, context) {
  const normalized = normalizeProviderError(error, context);
  return errorEnvelope(normalized, normalized.correlationId);
}

function normalizeResponse(data, correlationId = createCorrelationId()) {
  if (data && data.success === false && data.error) return errorEnvelope(normalizeProviderError(data.error, { correlationId }), correlationId);
  if (data && data.success === true && Object.prototype.hasOwnProperty.call(data, 'data')) return { ...data, correlationId: data.correlationId || correlationId };
  return { success: true, correlationId, data };
}

function normalizeListing(data, correlationId) {
  const payload = data?.data !== undefined && data?.success !== false ? data.data : data;
  if (data?.success === false) return normalizeResponse(data, correlationId);
  return normalizeResponse(createModelPage(payload || {}), correlationId);
}

function normalizeReadiness(data, correlationId) {
  if (data?.success === false) return normalizeResponse(data, correlationId);
  const payload = data?.data || data;
  return normalizeResponse(createReadyResult(payload), correlationId);
}

function normalizeHealth(data, correlationId) {
  if (data?.success === false) return normalizeResponse(data, correlationId);
  const payload = data?.data || data;
  return normalizeResponse(createHealthStatus(payload), correlationId);
}

function normalizeStatus(data, correlationId) {
  if (data?.success === false) return normalizeResponse(data, correlationId);
  const payload = data?.data || data;
  return normalizeResponse(createProviderStatus(payload), correlationId);
}

function normalizeStreamResult(data, correlationId) {
  if (data?.success === false) return normalizeResponse(data, correlationId);
  const payload = data?.data || data || {};
  return normalizeResponse({ status: payload.status || 'completed',
    ...(payload.events ? { events: payload.events } : {}),
    ...(payload.metrics ? { metrics: { ...payload.metrics } } : {}) }, correlationId);
}

function normalizeCancellation(data, correlationId) {
  if (data?.success === false) return normalizeResponse(data, correlationId);
  const payload = data?.data && typeof data.data === 'object' ? data.data : data;
  return normalizeResponse({ cancelled: payload?.cancelled === undefined ? true : Boolean(payload.cancelled) }, correlationId);
}

function normalizeCapabilities(data, correlationId) {
  if (data?.success === false) return normalizeResponse(data, correlationId);
  return normalizeResponse(data?.data || data || {}, correlationId);
}

module.exports = { redactText, normalizeProviderError, normalizeError, normalizeResponse,
  normalizeListing, normalizeReadiness, normalizeHealth, normalizeStatus,
  normalizeStreamResult, normalizeCancellation, normalizeCapabilities, serializeError };
