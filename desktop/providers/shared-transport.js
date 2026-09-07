/* eslint-env node */
/**
 * Shared transport layer for Phase 2 provider adapters. Extracts the common
 * HTTP request, SSE stream parsing, abort handling, and error normalization
 * logic so each adapter owns only its wire dialect (endpoint shape, auth
 * header, model listing format, streaming dialect).
 *
 * The Phase 1 LlamaServerProvider keeps its own transport for backward
 * compatibility; this module is the foundation for Phase 2 adapters.
 */
const { createCorrelationId, errorEnvelope } = require('../runtime/error-contract');
const { createStreamEvent } = require('./stream-contract');
const { normalizeProviderError, normalizeResponse } = require('./normalize');

function abortError(correlationId, providerId, operation) {
  return errorEnvelope(normalizeProviderError({
    code: 'CALLER_CANCELLED',
    message: 'The provider request was cancelled.',
    retryable: false,
    recoveryAction: 'Retry'
  }, { providerId, operation, correlationId }), correlationId);
}

function isAbort(error, signal) {
  return Boolean(signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR');
}

function asJsonHeaders(headers, hasBody, authHeaders) {
  return {
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    accept: 'application/json',
    ...(authHeaders || {}),
    ...(headers || {})
  };
}

/**
 * Perform a single HTTP request with normalized error handling.
 * Returns { response, body, error, correlationId }.
 */
async function request(fetch, url, init = {}, operation, providerId, signal, authHeaders) {
  const correlationId = createCorrelationId('provider');
  if (signal?.aborted) return { response: null, body: null, error: abortError(correlationId, providerId, operation) };
  try {
    const { streamResponse, ...requestInit } = init;
    const response = await fetch(url, {
      ...requestInit,
      signal,
      headers: asJsonHeaders(requestInit.headers, requestInit.body !== undefined, authHeaders)
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
      return { response, body, error: errorEnvelope(normalizeProviderError(body.error, { providerId, operation, correlationId }), correlationId) };
    }
    if (!response.ok) {
      const source = body?.error || body || { message: response.statusText || `Provider request failed (${response.status})` };
      const code = response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH'
        : (response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_PROTOCOL');
      return { response, body, error: errorEnvelope(normalizeProviderError({ ...source, code }, { providerId, operation, correlationId }), correlationId) };
    }
    return { response, body, correlationId };
  } catch (error) {
    if (isAbort(error, signal)) return { response: null, body: null, error: abortError(correlationId, providerId, operation) };
    return { response: null, body: null, error: errorEnvelope(normalizeProviderError(error, { providerId, operation, correlationId }), correlationId) };
  }
}

/**
 * Parse an SSE stream with a dialect-specific data parser.
 * Returns a normalizeResponse result with accumulated content/reasoning/model/timings.
 */
async function parseSseStream(response, onEvent, signal, providerId, operation, correlationId, parseData, heartbeatTimeoutMs = 120000) {
  if (!response?.body) {
    return errorEnvelope(normalizeProviderError(new Error('Provider returned no stream body'),
      { providerId, operation, code: 'PROVIDER_PROTOCOL', correlationId }), correlationId);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', content = '', reasoning = '', toolCalls = [], model, timings, finishReason, completed = false;
  const emit = (event) => {
    if (event.kind === 'content') content += event.text;
    if (event.kind === 'reasoning') reasoning += event.text;
    if (event.kind === 'model') model = event.id;
    if (event.kind === 'timings') timings = event.value;
    if (event.kind === 'complete') { completed = true; finishReason = event.finishReason; }
    if (event.kind === 'tool-progress') toolCalls = event.payload.tool_calls || toolCalls;
    onEvent(event);
  };
  try {
    while (true) {
      if (signal?.aborted) {
        emit(createStreamEvent('cancelled'));
        return normalizeResponse({ status: 'cancelled', content, reasoningContent: reasoning }, correlationId);
      }
      let timeout;
      const read = reader.read();
      const guardedRead = Promise.race([read, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Stream heartbeat timeout')), heartbeatTimeoutMs);
      })]);
      const { done, value } = await guardedRead;
      clearTimeout(timeout);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith(':') || !line.trim()) {
          if (line.startsWith(':')) onEvent(createStreamEvent('heartbeat'));
          continue;
        }
        if (line.startsWith('data:')) parseData(line.slice(5).trim(), emit);
      }
    }
    if (buffer.startsWith('data:')) parseData(buffer.slice(5).trim(), emit);
    if (!completed && !signal?.aborted) emit(createStreamEvent('complete'));
    return normalizeResponse({
      status: signal?.aborted ? 'cancelled' : 'completed',
      content, reasoningContent: reasoning || undefined,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      model, timings
    }, correlationId);
  } catch (error) {
    if (isAbort(error, signal)) {
      onEvent(createStreamEvent('cancelled'));
      return normalizeResponse({ status: 'cancelled', content, reasoningContent: reasoning || undefined }, correlationId);
    }
    const normalized = normalizeProviderError(error, { providerId, operation, correlationId });
    onEvent(createStreamEvent('error', normalized));
    return errorEnvelope(normalized, correlationId);
  } finally {
    if (signal?.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * OpenAI-compatible SSE data parser (used by OpenAICompatibleProvider and
 * LMStudioProvider since both follow the OpenAI streaming dialect).
 */
function openaiStreamParser(data, emit) {
  if (data === '[DONE]') { emit(createStreamEvent('complete')); return; }
  let parsed;
  try { parsed = JSON.parse(data); } catch (_) { return; }
  const choice = parsed.choices?.[0] || {};
  const delta = choice.delta || {};
  if (parsed.model) emit(createStreamEvent('model', parsed.model));
  if (delta.content) emit(createStreamEvent('content', delta.content));
  if (delta.reasoning_content) emit(createStreamEvent('reasoning', delta.reasoning_content));
  if (delta.tool_calls?.length) emit(createStreamEvent('tool-progress', { tool_calls: delta.tool_calls }));
  if (choice.finish_reason) emit(createStreamEvent('complete', choice.finish_reason));
}

module.exports = { request, parseSseStream, openaiStreamParser, isAbort, abortError };
