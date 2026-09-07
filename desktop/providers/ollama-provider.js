/* eslint-env node */
/**
 * Phase 2 provider adapter for Ollama-compatible local/remote endpoints.
 * Disabled unless phase1ExitCriteriaPassed and explicit user opt-in.
 *
 * Wire dialect: Ollama REST API (/api/chat, /api/tags, /api/show) with
 * JSON-line streaming (not SSE). Each line is a JSON object with partial
 * message content and a final done:true marker.
 */
const {
  createProviderDescriptor, createProviderCapabilities, requireCapability,
  createModelPage, createReadyResult, createHealthStatus, createProviderStatus
} = require('./provider-contract');
const { request, isAbort, abortError } = require('./shared-transport');
const { normalizeListing, normalizeReadiness, normalizeHealth, normalizeResponse, normalizeCancellation, normalizeProviderError } = require('./normalize');
const { createCorrelationId, errorEnvelope } = require('../runtime/error-contract');
const { createStreamEvent } = require('./stream-contract');

const CAPABILITIES = ['chat', 'streaming', 'model-listing', 'readiness', 'cancellation'];

class OllamaProvider {
  constructor(options = {}) {
    if (!options.baseUrl) throw new TypeError('baseUrl is required for OllamaProvider');
    this.providerId = String(options.providerId || 'ollama');
    this.groupId = String(options.groupId || this.providerId);
    this.baseUrl = String(options.baseUrl).replace(/\/$/, '');
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new TypeError('A fetch implementation is required');
    this.modelId = options.modelId ? String(options.modelId) : undefined;
    this.heartbeatTimeoutMs = Math.max(1000, Number(options.heartbeatTimeoutMs || 120000));
    this.lastHealth = null;
    this.lastStatus = null;
  }

  _url(path) { return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`; }

  descriptor() {
    const isLocal = this.baseUrl.startsWith('http://127.0.0.1') || this.baseUrl.startsWith('http://localhost');
    return createProviderDescriptor({
      id: this.providerId,
      groupId: this.groupId,
      name: 'Ollama',
      origin: isLocal ? 'local' : 'remote',
      authMode: 'none',
      endpoint: this.baseUrl,
      modelId: this.modelId,
      capabilities: CAPABILITIES
    });
  }

  capabilities() { return createProviderCapabilities(CAPABILITIES); }

  async listModels(signal) {
    const result = await request(this.fetch, this._url('/api/tags'), {}, 'list-models', this.providerId, signal);
    if (result.error) return result.error;
    const raw = result.body || {};
    const models = (raw.models || []).map((model) => ({
      id: String(model.name || model.model || ''),
      displayName: String(model.name || model.model || ''),
      providerId: this.providerId,
      providerGroupId: this.groupId,
      source: 'remote', format: 'remote',
      reference: String(model.name || ''),
      capabilities: CAPABILITIES.filter((c) => c !== 'model-listing'),
      availability: 'available', verification: 'unknown',
      metadata: { ...model }
    })).filter((m) => m.id);
    return normalizeListing({ models }, result.correlationId);
  }

  async health(signal) {
    const result = await request(this.fetch, this._url('/api/tags'), {}, 'health', this.providerId, signal);
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
    const body = {
      model: requestBody.model || this.modelId,
      messages: requestBody.messages || [],
      stream: false,
      ...(requestBody.options ? { options: requestBody.options } : {}),
      ...(requestBody.tools ? { tools: requestBody.tools } : {})
    };
    const result = await request(this.fetch, this._url('/api/chat'),
      { method: 'POST', body: JSON.stringify(body) }, 'chat', this.providerId, signal);
    if (result.error) return result.error;
    return normalizeResponse(result.body || {}, result.correlationId);
  }

  async stream(requestBody = {}, onEvent = () => {}, signal) {
    const unsupported = requireCapability(this.descriptor(), 'streaming', 'stream');
    if (unsupported) return unsupported;
    const body = {
      model: requestBody.model || this.modelId,
      messages: requestBody.messages || [],
      stream: true,
      ...(requestBody.options ? { options: requestBody.options } : {})
    };
    const result = await request(this.fetch, this._url('/api/chat'),
      { method: 'POST', streamResponse: true, body: JSON.stringify(body) },
      'stream', this.providerId, signal);
    if (result.error) return result.error;
    if (!result.response?.body) {
      return errorEnvelope(normalizeProviderError(new Error('Provider returned no stream body'),
        { providerId: this.providerId, operation: 'stream', code: 'PROVIDER_PROTOCOL', correlationId: result.correlationId }), result.correlationId);
    }
    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', model, completed = false;
    const emit = (event) => {
      if (event.kind === 'content') content += event.text;
      if (event.kind === 'model') model = event.id;
      if (event.kind === 'complete') completed = true;
      onEvent(event);
    };
    try {
      while (true) {
        if (signal?.aborted) {
          emit(createStreamEvent('cancelled'));
          return normalizeResponse({ status: 'cancelled', content }, result.correlationId);
        }
        let timeout;
        const read = reader.read();
        const guardedRead = Promise.race([read, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Stream heartbeat timeout')), this.heartbeatTimeoutMs);
        })]);
        const { done, value } = await guardedRead;
        clearTimeout(timeout);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.model) emit(createStreamEvent('model', parsed.model));
            if (parsed.message?.content) emit(createStreamEvent('content', parsed.message.content));
            if (parsed.done) emit(createStreamEvent('complete', parsed.done_reason || 'stop'));
          } catch (_) { /* skip malformed line */ }
        }
      }
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.model) emit(createStreamEvent('model', parsed.model));
          if (parsed.message?.content) emit(createStreamEvent('content', parsed.message.content));
          if (parsed.done && !completed) emit(createStreamEvent('complete', parsed.done_reason || 'stop'));
        } catch (_) { /* skip */ }
      }
      if (!completed && !signal?.aborted) emit(createStreamEvent('complete'));
      return normalizeResponse({
        status: signal?.aborted ? 'cancelled' : 'completed',
        content, model
      }, result.correlationId);
    } catch (error) {
      if (isAbort(error, signal)) {
        onEvent(createStreamEvent('cancelled'));
        return normalizeResponse({ status: 'cancelled', content }, result.correlationId);
      }
      const normalized = normalizeProviderError(error, { providerId: this.providerId, operation: 'stream', correlationId: result.correlationId });
      onEvent(createStreamEvent('error', normalized));
      return errorEnvelope(normalized, result.correlationId);
    } finally {
      if (signal?.aborted) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async cancel(requestId, signal) {
    if (signal?.aborted) return abortError(createCorrelationId('provider'), this.providerId, 'cancel');
    // Ollama supports POST /api/cancel for in-flight generation cancellation
    try {
      await request(this.fetch, this._url('/api/cancel'),
        { method: 'POST', body: JSON.stringify({ id: requestId }) },
        'cancel', this.providerId, signal);
    } catch (_) { /* transport-level abort is the primary mechanism */ }
    return normalizeCancellation({ cancelled: true, requestId }, createCorrelationId('provider'));
  }

  status() {
    return createProviderStatus({ providerId: this.providerId, status: this.lastStatus, health: this.lastHealth || undefined, lastCheckedAt: Date.now() });
  }
}

module.exports = { OllamaProvider };
