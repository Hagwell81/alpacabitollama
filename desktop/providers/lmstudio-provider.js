/* eslint-env node */
/**
 * Phase 2 provider adapter for LM Studio-compatible local endpoints.
 * Disabled unless phase1ExitCriteriaPassed and explicit user opt-in.
 *
 * Wire dialect: LM Studio exposes an OpenAI-compatible REST API at /v1/
 * with /v1/models for listing and /v1/chat/completions for chat/stream.
 * No authentication required for local instances. Streaming uses the
 * OpenAI SSE dialect.
 */
const {
  createProviderDescriptor, createProviderCapabilities, requireCapability,
  createModelPage, createReadyResult, createHealthStatus, createProviderStatus
} = require('./provider-contract');
const { request, parseSseStream, openaiStreamParser, abortError } = require('./shared-transport');
const { normalizeListing, normalizeReadiness, normalizeHealth, normalizeResponse, normalizeCancellation } = require('./normalize');
const { createCorrelationId } = require('../runtime/error-contract');

const DEFAULT_BASE_URL = 'http://127.0.0.1:1234';
const CAPABILITIES = ['chat', 'streaming', 'model-listing', 'readiness', 'cancellation', 'tools', 'reasoning'];

class LMStudioProvider {
  constructor(options = {}) {
    this.providerId = String(options.providerId || 'lmstudio');
    this.groupId = String(options.groupId || this.providerId);
    this.baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiPrefix = String(options.apiPrefix || '/v1').replace(/\/$/, '');
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new TypeError('A fetch implementation is required');
    this.modelId = options.modelId ? String(options.modelId) : undefined;
    this.heartbeatTimeoutMs = Math.max(1000, Number(options.heartbeatTimeoutMs || 120000));
    this.lastHealth = null;
    this.lastStatus = null;
  }

  _url(path) {
    return `${this.baseUrl}${this.apiPrefix}${path.startsWith('/') ? path : `/${path}`}`;
  }

  descriptor() {
    const isLocal = this.baseUrl.startsWith('http://127.0.0.1') || this.baseUrl.startsWith('http://localhost');
    return createProviderDescriptor({
      id: this.providerId,
      groupId: this.groupId,
      name: 'LM Studio',
      origin: isLocal ? 'local' : 'remote',
      authMode: 'none',
      endpoint: `${this.baseUrl}${this.apiPrefix}`,
      modelId: this.modelId,
      capabilities: CAPABILITIES
    });
  }

  capabilities() { return createProviderCapabilities(CAPABILITIES); }

  async listModels(signal) {
    const result = await request(this.fetch, this._url('/models'), {}, 'list-models', this.providerId, signal);
    if (result.error) return result.error;
    const raw = result.body || {};
    const models = (raw.data || raw.models || []).map((model) => ({
      id: String(model.id || model.name || ''),
      displayName: String(model.name || model.id || ''),
      providerId: this.providerId,
      providerGroupId: this.groupId,
      source: 'remote', format: 'remote',
      reference: String(model.id || ''),
      capabilities: CAPABILITIES.filter((c) => c !== 'model-listing'),
      availability: 'available', verification: 'unknown',
      metadata: { ...model }
    })).filter((m) => m.id);
    return normalizeListing({ models }, result.correlationId);
  }

  async health(signal) {
    const result = await request(this.fetch, this._url('/models'), {}, 'health', this.providerId, signal);
    if (result.error) { this.lastStatus = 'unavailable'; return result.error; }
    const status = result.response?.ok ? 'healthy' : 'unhealthy';
    const value = createHealthStatus({ status, providerId: this.providerId, checkedAt: Date.now() });
    this.lastHealth = value;
    this.lastStatus = status === 'healthy' ? 'ready' : 'degraded';
    return normalizeHealth(value, result.correlationId);
  }

  async ensureReady(model, signal) {
    const ref = typeof model === 'string' ? { id: model } : (model || {});
    const health = await this.health(signal);
    if (!health.success) return health;
    return normalizeReadiness(createReadyResult({
      providerId: this.providerId,
      modelId: ref.id || this.modelId || 'default',
      model: { id: ref.id || this.modelId || 'default', providerId: this.providerId },
      state: 'ready'
    }), health.correlationId);
  }

  async chat(requestBody = {}, signal) {
    const unsupported = requireCapability(this.descriptor(), 'chat', 'chat');
    if (unsupported) return unsupported;
    const result = await request(this.fetch, this._url('/chat/completions'),
      { method: 'POST', body: JSON.stringify({ ...requestBody, stream: false }) },
      'chat', this.providerId, signal);
    if (result.error) return result.error;
    return normalizeResponse(result.body || {}, result.correlationId);
  }

  async stream(requestBody = {}, onEvent = () => {}, signal) {
    const unsupported = requireCapability(this.descriptor(), 'streaming', 'stream');
    if (unsupported) return unsupported;
    const result = await request(this.fetch, this._url('/chat/completions'),
      { method: 'POST', streamResponse: true, body: JSON.stringify({ ...requestBody, stream: true }) },
      'stream', this.providerId, signal);
    if (result.error) return result.error;
    return parseSseStream(result.response, onEvent, signal, this.providerId, 'stream', result.correlationId, openaiStreamParser, this.heartbeatTimeoutMs);
  }

  async cancel(requestId, signal) {
    if (signal?.aborted) return abortError(createCorrelationId('provider'), this.providerId, 'cancel');
    return normalizeCancellation({ cancelled: true, requestId }, createCorrelationId('provider'));
  }

  status() {
    return createProviderStatus({ providerId: this.providerId, status: this.lastStatus, health: this.lastHealth || undefined, lastCheckedAt: Date.now() });
  }
}

module.exports = { LMStudioProvider, DEFAULT_BASE_URL };
