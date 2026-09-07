/* eslint-env node */
const { createSafeError } = require('../runtime/error-contract');

const STREAM_EVENT_KINDS = Object.freeze(['content', 'reasoning', 'tool-progress', 'heartbeat', 'model', 'timings', 'complete', 'cancelled', 'error']);

function createStreamEvent(kind, value) {
  if (!STREAM_EVENT_KINDS.includes(kind)) throw new TypeError(`Unknown stream event: ${kind}`);
  if (kind === 'content' || kind === 'reasoning') return { kind, text: String(value ?? '') };
  if (kind === 'tool-progress') return { kind, payload: value && typeof value === 'object' ? { ...value } : {} };
  if (kind === 'heartbeat') return { kind, at: Number(value ?? Date.now()) };
  if (kind === 'model') return { kind, id: String(value ?? '') };
  if (kind === 'timings') return { kind, value: value && typeof value === 'object' ? { ...value } : {} };
  if (kind === 'complete') return { kind, ...(value === undefined ? {} : { finishReason: String(value) }) };
  if (kind === 'cancelled') return { kind };
  return { kind, error: createSafeError(value || {}) };
}

module.exports = { STREAM_EVENT_KINDS, createStreamEvent };
