/* eslint-env node */
/**
 * Provider adapter for the local llama-server OpenAI-compatible API.
 * The adapter deliberately owns only transport and wire normalization; callers
 * keep their existing request parameters and callback contract.
 */
const {
  createProviderDescriptor,
  createProviderCapabilities,
  requireCapability,
  createModelPage,
  createReadyResult,
  createHealthStatus,
  createProviderStatus
} = require('./provider-contract');
const { createStreamEvent } = require('./stream-contract');
const {
  createCorrelationId,
  createSafeError,
  errorEnvelope,
  successEnvelope,
  serializeError
} = require('../runtime/error-contract');
const {
  normalizeProviderError,
  normalizeResponse,
  normalizeListing,
  normalizeReadiness,
  normalizeHealth,
  normalizeCancellation,
  normalizeCapabilities
} = require('./normalize');

const DEFAULT_BASE_URL = 'http://127.0.0.1:13434';
const DEFAULT_CAPABILITIES = ['chat', 'streaming', 'model-listing', 'readiness', 'cancellation', 'tools', 'reasoning'];

function abortError(correlationId, providerId, operation) {
  return errorEnvelope(createSafeError({
    code: 'CALLER_CANCELLED',
    message: 'The provider request was cancelled.',
    retryable: false,
    recoveryAction: 'Retry',
    correlationId,
    details: { providerId, operation }
  }), correlationId);
}

function isAbort(error, signal) {
  return Boolean(signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR');
}

function asJsonHeaders(headers, hasBody) {
  return { ...(hasBody ? { 'content-type': 'application/json' } : {}), accept: 'application/json', ...headers };
}

class LlamaServerProvider {
  constructor(options = {}) {
    this.providerId = String(options.providerId || 'local-llama-server');
    this.groupId = String(options.groupId || this.providerId);
    this.baseUrl = String(options.baseUrl || options.endpoint || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiPrefix = String(options.apiPrefix === undefined ? '/v1' : options.apiPrefix).replace(/\/$/, '');
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new TypeError('A fetch implementation is required');
    this.headers = { ...(options.headers || {}) };
    this.modelId = options.modelId ? String(options.modelId) : undefined;
    this.modelSwitchPath = options.modelSwitchPath || '/models';
    this.lastHealth = null;
    this.heartbeatTimeoutMs = Math.max(1000, Number(options.heartbeatTimeoutMs || 120000));
  }

  descriptor() {
    return createProviderDescriptor({
      id: this.providerId,
      groupId: this.groupId,
      name: 'llama-server',
      origin: this.baseUrl.startsWith('http://127.0.0.1') || this.baseUrl.startsWith('http://localhost') ? 'loopback' : 'remote',
      authMode: 'none',
      endpoint: `${this.baseUrl}${this.apiPrefix}`,
      modelId: this.modelId,
      capabilities: DEFAULT_CAPABILITIES
    });
  }

  capabilities() {
    return createProviderCapabilities(DEFAULT_CAPABILITIES);
  }

  async _request(path, init = {}, operation, signal) {
    const correlationId = createCorrelationId('provider');
    if (signal?.aborted) return { response: null, body: null, error: abortError(correlationId, this.providerId, operation) };
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      const { streamResponse, ...requestInit } = init;
      const response = await this.fetch(url, {
        ...requestInit,
        signal,
        headers: asJsonHeaders(this.headers, requestInit.body !== undefined)
      });
      let body = null;
      if (!streamResponse) {
        const text = await response.text();
        if (text.trim()) {
          try { body = JSON.parse(text); } catch (_) {
            body = { error: { code: 'PROVIDER_PROTOCOL', message: 'Provider returned malformed JSON.' } };
          }
        }
      }
      if (body?.error?.code === 'PROVIDER_PROTOCOL' && response.ok) {
        return { response, body, error: errorEnvelope(normalizeProviderError(body.error, {
          providerId: this.providerId, operation, correlationId
        }), correlationId) };
      }
      if (!response.ok) {
        const source = body?.error || body || { message: response.statusText || `Provider request failed (${response.status})` };
        const code = response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH' : (response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_PROTOCOL');
        return { response, body, error: errorEnvelope(normalizeProviderError({ ...source, code }, { providerId: this.providerId, operation, correlationId }), correlationId) };
      }
      return { response, body, correlationId };
    } catch (error) {
      if (isAbort(error, signal)) return { response: null, body: null, error: abortError(correlationId, this.providerId, operation) };
      return { response: null, body: null, error: errorEnvelope(normalizeProviderError(error, { providerId: this.providerId, operation, correlationId }), correlationId) };
    }
  }

  _path(path, api = false) { return `${api ? this.apiPrefix : ''}${path}` || '/'; }

  async listModels(signal) {
    const result = await this._request(this._path('/models', true), {}, 'list-models', signal);
    if (result.error) return result.error;
    const raw = Array.isArray(result.body) ? { models: result.body } : (result.body || {});
    const models = (raw.models || raw.data || []).map((model) => ({
      id: String(model.id || model.name || model.model || ''),
      displayName: String(model.displayName || model.name || model.id || model.model || ''),
      providerId: this.providerId,
      providerGroupId: this.groupId,
      source: 'local', format: 'remote', reference: String(model.path || model.id || model.name || ''),
      capabilities: DEFAULT_CAPABILITIES.filter((capability) => capability !== 'model-listing'),
      availability: 'available', verification: 'unknown', metadata: { ...model }
    })).filter((model) => model.id);
    return normalizeListing({ models, nextCursor: raw.nextCursor }, result.correlationId);
  }

  async health(signal) {
    const result = await this._request('/health', {}, 'health', signal);
    if (result.error) { this.lastStatus = 'unavailable'; return result.error; }
    const raw = result.body || {};
    const status = raw.status === 'ok' || raw.status === 'healthy' || result.response?.status === 200 ? 'healthy' : 'unhealthy';
    const value = createHealthStatus({ status, providerId: this.providerId, message: raw.message, checkedAt: Date.now() });
    this.lastHealth = value;
    this.lastStatus = status === 'healthy' ? 'ready' : 'degraded';
    return normalizeHealth(value, result.correlationId);
  }

  async slots(model, signal) {
    const query = model ? `?model=${encodeURIComponent(typeof model === 'string' ? model : model.id)}` : '';
    const result = await this._request(`/slots${query}`, {}, 'slots', signal);
    if (result.error) return result.error;
    const slots = Array.isArray(result.body) ? result.body : (result.body?.slots || []);
    return normalizeResponse({ slots, allIdle: slots.every((slot) => !slot.is_processing) }, result.correlationId);
  }

  async areAllSlotsIdle(model, signal) {
    const result = await this.slots(model, signal);
    return result.success ? Boolean(result.data.allIdle) : true;
  }

  async ensureReady(model, signal) {
    const ref = typeof model === 'string' ? { id: model } : (model || {});
    const health = await this.health(signal);
    if (!health.success) return health;
    const providerModel = ref.id || this.modelId;
    if (providerModel && ref.switchModel) {
      const switched = await this.switchModel(providerModel, signal);
      if (!switched.success) return switched;
    }
    return normalizeReadiness(createReadyResult({ providerId: this.providerId, modelId: providerModel || this.modelId || 'default', model: { id: providerModel || this.modelId || 'default', providerId: this.providerId }, state: 'ready' }), health.correlationId);
  }

  async switchModel(model, signal) {
    const modelId = typeof model === 'string' ? model : model?.id;
    if (!modelId) return errorEnvelope(normalizeProviderError(new Error('Model identity is required'), { providerId: this.providerId, operation: 'model-switch', code: 'PROVIDER_PROTOCOL' }));
    const result = await this._request(this.modelSwitchPath, { method: 'POST', body: JSON.stringify({ model: modelId }) }, 'model-switch', signal);
    if (result.error) return result.error;
    this.modelId = modelId;
    return normalizeReadiness({ providerId: this.providerId, modelId, state: 'ready' }, result.correlationId);
  }

  async chat(request = {}, signal) {
    const unsupported = requireCapability(this.descriptor(), 'chat', 'chat');
    if (unsupported) return unsupported;
    const result = await this._request(this._path('/chat/completions', true), { method: 'POST', body: JSON.stringify({ ...request, ...(request.stream === undefined ? { stream: false } : {}) }) }, 'chat', signal);
    if (result.error) return result.error;
    return normalizeResponse(result.body || {}, result.correlationId);
  }

  async stream(request = {}, onEvent = () => {}, signal) {
    const unsupported = requireCapability(this.descriptor(), 'streaming', 'stream');
    if (unsupported) return unsupported;
    const result = await this._request(this._path('/chat/completions', true), { method: 'POST', streamResponse: true, body: JSON.stringify({ ...request, stream: true, return_progress: request.return_progress === undefined ? true : request.return_progress }) }, 'stream', signal);
    if (result.error) return result.error;
    if (!result.response?.body) return errorEnvelope(normalizeProviderError(new Error('Provider returned no stream body'), { providerId: this.providerId, operation: 'stream', code: 'PROVIDER_PROTOCOL', correlationId: result.correlationId }), result.correlationId);
    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', reasoning = '', toolCalls = [], model, timings, finishReason, completed = false;
    const emit = (event) => { if (event.kind === 'content') content += event.text; if (event.kind === 'reasoning') reasoning += event.text; if (event.kind === 'model') model = event.id; if (event.kind === 'timings') timings = event.value; if (event.kind === 'complete') { completed = true; finishReason = event.finishReason; } if (event.kind === 'tool-progress') toolCalls = event.payload.tool_calls || toolCalls; onEvent(event); };
    const parseData = (data) => {
      if (data === '[DONE]') { if (!completed) emit(createStreamEvent('complete', finishReason)); return; }
      let parsed;
      try { parsed = JSON.parse(data); } catch (_) { return; }
      const choice = parsed.choices?.[0] || {};
      const delta = choice.delta || {};
      if (parsed.model) emit(createStreamEvent('model', parsed.model));
      if (parsed.timings) emit(createStreamEvent('timings', parsed.timings));
      if (parsed.prompt_progress) emit(createStreamEvent('timings', { prompt_progress: parsed.prompt_progress }));
      if (delta.content) emit(createStreamEvent('content', delta.content));
      if (delta.reasoning_content) emit(createStreamEvent('reasoning', delta.reasoning_content));
      if (delta.tool_calls?.length) emit(createStreamEvent('tool-progress', { tool_calls: delta.tool_calls }));
      if (choice.finish_reason && !completed) emit(createStreamEvent('complete', choice.finish_reason));
    };
    try {
      while (true) {
        if (signal?.aborted) { emit(createStreamEvent('cancelled')); return normalizeResponse({ status: 'cancelled', events: [], content, reasoningContent: reasoning }, result.correlationId); }
        let timeout;
        const read = reader.read();
        const guardedRead = Promise.race([read, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Stream heartbeat timeout')), this.heartbeatTimeoutMs); })]);
        const { done, value } = await guardedRead;
        clearTimeout(timeout);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith(':') || !line.trim()) { if (line.startsWith(':')) onEvent(createStreamEvent('heartbeat')); continue; }
          if (line.startsWith('data:')) parseData(line.slice(5).trim());
        }
      }
      if (buffer.startsWith('data:')) parseData(buffer.slice(5).trim());
      if (!completed && !signal?.aborted) emit(createStreamEvent('complete'));
      return normalizeResponse({ status: signal?.aborted ? 'cancelled' : 'completed', content, reasoningContent: reasoning || undefined, toolCalls: toolCalls.length ? toolCalls : undefined, model, timings }, result.correlationId);
    } catch (error) {
      if (isAbort(error, signal)) { onEvent(createStreamEvent('cancelled')); return normalizeResponse({ status: 'cancelled', content, reasoningContent: reasoning || undefined }, result.correlationId); }
      const normalized = normalizeProviderError(error, { providerId: this.providerId, operation: 'stream', correlationId: result.correlationId });
      onEvent(createStreamEvent('error', normalized));
      return errorEnvelope(normalized, result.correlationId);
    } finally { if (signal?.aborted) await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }

  async cancel(requestId, signal) {
    if (signal?.aborted) return abortError(createCorrelationId('provider'), this.providerId, 'cancel');
    // llama-server cancellation is transport-level: aborting the caller's
    // controller stops fetch/body consumption. There is no remote cancel API.
    return normalizeCancellation({ cancelled: true, requestId }, createCorrelationId('provider'));
  }

  status() {
    return createProviderStatus({ providerId: this.providerId, status: this.lastStatus, health: this.lastHealth || undefined, lastCheckedAt: Date.now() });
  }
}

module.exports = { LlamaServerProvider, DEFAULT_BASE_URL };
