/* eslint-env node */
/**
 * Provider boundary contracts. These are deliberately plain serializable
 * objects: adapters may keep wire-specific details private, but everything
 * crossing the provider boundary uses these shapes.
 */
const { createCorrelationId, createSafeError, successEnvelope, errorEnvelope } = require('../runtime/error-contract');
const { createModelRef } = require('../runtime/catalog-contract');

const AUTH_MODES = Object.freeze(['none', 'api-key', 'token', 'secure-store']);
const PROVIDER_OPERATIONS = Object.freeze(['descriptor', 'list-models', 'ensure-ready', 'health', 'chat', 'stream', 'cancel', 'capabilities', 'status']);
const CAPABILITIES = Object.freeze(['chat', 'streaming', 'model-listing', 'readiness', 'cancellation', 'tools', 'reasoning']);
const PROVIDER_STATUSES = Object.freeze(['available', 'unavailable', 'degraded', 'starting', 'ready', 'failed', 'disabled']);

function requiredString(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') throw new TypeError(`${name} is required`);
  return String(value);
}

function createProviderRef({ id, groupId } = {}) {
  return { id: requiredString(id, 'Provider identity'), groupId: String(groupId || id) };
}

function createProviderDescriptor(input = {}) {
  const ref = createProviderRef(input);
  const capabilities = Array.isArray(input.capabilities)
    ? [...new Set(input.capabilities.map(String).filter((value) => CAPABILITIES.includes(value)))] : [];
  return {
    id: ref.id,
    groupId: ref.groupId,
    name: String(input.name || ref.id),
    origin: String(input.origin || 'loopback'),
    authMode: AUTH_MODES.includes(input.authMode) ? input.authMode : 'none',
    capabilities,
    ...(input.endpoint ? { endpoint: String(input.endpoint) } : {}),
    ...(input.modelId ? { modelId: String(input.modelId) } : {})
  };
}

function createModelPage(input = {}) {
  const models = Array.isArray(input.models) ? input.models.map((model) => ({ ...model })) : [];
  return {
    models,
    ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor === null ? null : String(input.nextCursor) }),
    ...(input.stale === undefined ? {} : { stale: Boolean(input.stale) })
  };
}

function createReadyResult(input = {}) {
  const providerId = requiredString(input.providerId, 'Ready provider identity');
  const model = input.model || createModelRef({ id: input.modelId, providerId, digest: input.digest });
  return { providerId, model, state: String(input.state || 'ready'),
    ...(input.digest ? { digest: String(input.digest) } : {}),
    ...(input.correlationId ? { correlationId: String(input.correlationId) } : {}) };
}

function createHealthStatus(input = {}) {
  const status = input.status === 'healthy' ? 'healthy' : (input.status || 'unhealthy');
  return { status: String(status),
    ...(input.providerId === undefined ? {} : { providerId: String(input.providerId) }),
    ...(input.latencyMs === undefined ? {} : { latencyMs: Number(input.latencyMs) }),
    ...(input.message ? { message: String(input.message) } : {}),
    ...(input.checkedAt === undefined ? {} : { checkedAt: Number(input.checkedAt) }) };
}

function createProviderCapabilities(input = {}) {
  const values = input.capabilities || input;
  return Object.fromEntries(CAPABILITIES.map((capability) => [capability, Boolean(values[capability] || (Array.isArray(values) && values.includes(capability)))]));
}

function createProviderStatus(input = {}) {
  return { providerId: requiredString(input.providerId, 'Provider identity'),
    status: PROVIDER_STATUSES.includes(input.status) ? input.status : 'unavailable',
    ...(input.message ? { message: String(input.message) } : {}),
    ...(input.lastCheckedAt === undefined ? {} : { lastCheckedAt: Number(input.lastCheckedAt) }),
    ...(input.health ? { health: createHealthStatus(input.health) } : {}) };
}

function unsupportedCapability(providerId, capability, operation, correlationId = createCorrelationId()) {
  return errorEnvelope(createSafeError({ code: 'PROVIDER_UNSUPPORTED_CAPABILITY',
    message: `Provider does not support ${capability}.`, retryable: false,
    recoveryAction: 'Select another provider', correlationId,
    details: { providerId, capability, operation } }), correlationId);
}

function hasCapability(capabilities, capability) {
  return Array.isArray(capabilities) ? capabilities.includes(capability) : Boolean(capabilities?.[capability]);
}

function requireCapability(descriptor, capability, operation, correlationId) {
  return hasCapability(descriptor?.capabilities, capability)
    ? null : unsupportedCapability(descriptor?.id, capability, operation, correlationId);
}

module.exports = { AUTH_MODES, PROVIDER_OPERATIONS, CAPABILITIES, PROVIDER_STATUSES,
  createProviderRef, createProviderDescriptor, createModelRef, createModelPage,
  createReadyResult, createHealthStatus, createProviderCapabilities, createProviderStatus,
  hasCapability, requireCapability, unsupportedCapability, successEnvelope, errorEnvelope };
