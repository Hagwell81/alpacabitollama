/* eslint-env node */
const { createCorrelationId, createSafeError, errorEnvelope, successEnvelope } = require('../runtime/error-contract');
const {
  createProviderDescriptor,
  createProviderStatus,
  hasCapability,
  requireCapability
} = require('./provider-contract');
const { normalizeProviderError } = require('./normalize');
const { FeatureGates } = require('../feature-gates');

const LOCAL_ORIGINS = new Set(['loopback', 'local']);
const PHASE_2_CAPABILITIES = new Set(['remote-providers', 'discovery', 'calibration']);
const OPERATION_CAPABILITIES = Object.freeze({
  'list-models': 'model-listing',
  'ensure-ready': 'readiness',
  health: 'readiness',
  stream: 'streaming',
  cancel: 'cancellation'
});

function providerDescriptor(provider) {
  const value = typeof provider?.descriptor === 'function' ? provider.descriptor() : provider?.descriptor;
  return createProviderDescriptor(value || provider || {});
}

function isRemote(descriptor, explicit) {
  return explicit === true || !LOCAL_ORIGINS.has(String(descriptor.origin).toLowerCase());
}

function disabledStatus(descriptor, message) {
  return createProviderStatus({ providerId: descriptor.id, status: 'disabled', message });
}

class ProviderRegistry {
  constructor(options = {}) {
    this._providers = new Map();
    this._records = new Map();
    this._onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : () => {};
    this._gates = options.featureGates instanceof FeatureGates
      ? options.featureGates
      : new FeatureGates({
        runtimeLifecycleV1: options.runtimeLifecycleV1,
        phase1ExitCriteriaPassed: options.phase1ExitCriteriaPassed,
        phase2Flags: options.phase2Flags
      });
    this._remoteOptIn = options.remoteProviderOptIn === true || options.remoteProvidersOptIn === true;
  }

  get featureGates() { return this._gates; }

  flags() {
    const phase1Exit = this._gates.phase1Passed() ? 'passed' : 'pending';
    return { ...this._gates.snapshot(), phase1ExitCriteriaPassed: phase1Exit === 'passed', phase1Exit };
  }

  setRemoteProviderOptIn(enabled) {
    this._remoteOptIn = enabled === true;
    for (const record of this._records.values()) this._refreshRecord(record);
    return this._remoteOptIn;
  }

  register(provider, options = {}) {
    const descriptor = providerDescriptor(provider);
    if (!provider || (typeof provider !== 'object' && typeof provider !== 'function')) throw new TypeError('Provider adapter is required');
    if (this._providers.has(descriptor.id)) throw new Error(`Provider is already registered: ${descriptor.id}`);

    const remote = isRemote(descriptor, options.remote);
    const record = { descriptor, provider, remote, status: null, registeredAt: Date.now(), lastError: undefined };
    this._providers.set(descriptor.id, provider);
    this._records.set(descriptor.id, record);
    this._refreshRecord(record);
    return descriptor;
  }

  unregister(providerId) {
    const removed = this._providers.delete(String(providerId));
    this._records.delete(String(providerId));
    return removed;
  }

  _refreshRecord(record) {
    const { descriptor } = record;
    if (record.remote && !this._remoteOptIn) {
      record.status = disabledStatus(descriptor, 'Remote providers require explicit opt-in.');
    } else if (record.remote && !this._gates.isEnabled('phase2RemoteProviders')) {
      record.status = disabledStatus(descriptor, 'Remote providers are unavailable until Phase 1 passes.');
    } else if (record.status?.status === 'disabled') {
      record.status = createProviderStatus({ providerId: descriptor.id, status: 'available' });
    } else if (!record.status) {
      record.status = createProviderStatus({ providerId: descriptor.id, status: 'available' });
    }
  }

  get(providerId) {
    return this._providers.get(String(providerId));
  }

  descriptor(providerId) {
    return this._records.get(String(providerId))?.descriptor;
  }

  descriptors() {
    return [...this._records.values()].map(({ descriptor }) => ({ ...descriptor, capabilities: [...descriptor.capabilities] }));
  }

  status(providerId) {
    const record = this._records.get(String(providerId));
    if (!record) return undefined;
    this._refreshRecord(record);
    return { ...record.status, ...(record.status.health ? { health: { ...record.status.health } } : {}) };
  }

  projectStatus() {
    return [...this._records.keys()].map((id) => this.status(id));
  }

  providerStatuses() { return this.projectStatus(); }

  setStatus(providerId, input = {}) {
    const record = this._records.get(String(providerId));
    if (!record) return undefined;
    this._refreshRecord(record);
    if (record.status.status === 'disabled') return this.status(providerId);
    record.status = createProviderStatus({ providerId: record.descriptor.id, ...input });
    return this.status(providerId);
  }

  _availability(record, capability, operation) {
    this._refreshRecord(record);
    if (record.status.status === 'disabled') {
      return errorEnvelope(createSafeError({ code: 'PROVIDER_DISABLED', message: record.status.message,
        retryable: false, recoveryAction: 'Enable the provider explicitly', correlationId: createCorrelationId(),
        details: { providerId: record.descriptor.id, operation } }));
    }
    if (PHASE_2_CAPABILITIES.has(capability) && !this._gates.isEnabled(`phase2${capability[0].toUpperCase()}${capability.slice(1)}`)) {
      return errorEnvelope(createSafeError({ code: 'PHASE2_DISABLED', message: 'This optional provider capability is disabled until Phase 1 passes.',
        retryable: false, recoveryAction: 'Complete the Phase 1 exit checks', correlationId: createCorrelationId(),
        details: { providerId: record.descriptor.id, capability, operation } }));
    }
    return requireCapability(record.descriptor, capability, operation);
  }

  canUse(providerId, capability, operation = capability) {
    const record = this._records.get(String(providerId));
    if (!record) return false;
    return !this._availability(record, capability, operation);
  }

  capabilityError(providerId, capability, operation = capability) {
    const record = this._records.get(String(providerId));
    if (!record) return errorEnvelope(createSafeError({ code: 'PROVIDER_UNAVAILABLE', message: 'Provider is not registered.', retryable: false,
      recoveryAction: 'Select another provider', details: { providerId, operation } }));
    return this._availability(record, capability, operation);
  }

  async invoke(providerId, operation, args = [], options = {}) {
    const record = this._records.get(String(providerId));
    const capability = options.capability || OPERATION_CAPABILITIES[operation] || operation;
    if (!record) return errorEnvelope(createSafeError({ code: 'PROVIDER_UNAVAILABLE', message: 'Provider is not registered.', retryable: false,
      recoveryAction: 'Select another provider', details: { providerId, operation } }));
    const gateError = this._availability(record, capability, operation);
    if (gateError) return gateError;
    const method = record.provider[operation];
    if (typeof method !== 'function') return errorEnvelope(createSafeError({ code: 'PROVIDER_UNSUPPORTED_OPERATION', message: `Provider does not implement ${operation}.`,
      retryable: false, recoveryAction: 'Select another provider', details: { providerId, operation } }));
    try {
      const result = await method.apply(record.provider, Array.isArray(args) ? args : [args]);
      this.setStatus(providerId, { status: operation === 'health' && result?.status === 'healthy' ? 'ready' : 'available',
        ...(operation === 'health' ? { health: result } : {}) });
      return result?.success === false || result?.success === true ? result : successEnvelope(result);
    } catch (error) {
      const normalized = normalizeProviderError(error, { providerId: record.descriptor.id, operation });
      record.lastError = normalized;
      this.setStatus(providerId, { status: 'failed', message: normalized.message });
      this._onDiagnostic({ providerId: record.descriptor.id, operation, error: normalized });
      return errorEnvelope(normalized, normalized.correlationId);
    }
  }
}

function createProviderRegistry(options) { return new ProviderRegistry(options); }

module.exports = { LOCAL_ORIGINS, ProviderRegistry, createProviderRegistry };
