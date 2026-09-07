/* eslint-env node */
const MODEL_SOURCES = Object.freeze(['local', 'curated', 'router', 'discovery']);
const MODEL_FORMATS = Object.freeze(['gguf', 'remote', 'unknown']);
const MODEL_AVAILABILITY = Object.freeze(['available', 'unavailable', 'stale']);
const VERIFICATION_STATUS = Object.freeze(['verified', 'pending', 'failed', 'unknown']);
const METADATA_STATUS = Object.freeze(['known', 'unknown', 'malformed']);

function createModelRef({ id, providerId, digest }) {
  if (!id || !providerId) throw new TypeError('Model references require id and providerId');
  return { id: String(id), providerId: String(providerId), ...(digest ? { digest: String(digest) } : {}) };
}

function createModelRecord(input) {
  if (!input?.id || !input?.displayName || !input?.providerId) throw new TypeError('Model identity is required');
  const source = MODEL_SOURCES.includes(input.source) ? input.source : 'local';
  const format = MODEL_FORMATS.includes(input.format) ? input.format : 'unknown';
  return {
    id: String(input.id), displayName: String(input.displayName), providerId: String(input.providerId),
    providerGroupId: String(input.providerGroupId || input.providerId), source, format,
    reference: String(input.reference || input.id),
    ...(input.digest ? { digest: { algorithm: String(input.digest.algorithm), value: String(input.digest.value), verified: Boolean(input.digest.verified) } } : {}),
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.map(String) : [],
    ...(input.contextLimit === undefined ? {} : { contextLimit: Number(input.contextLimit) }),
    ...(input.sizeBytes === undefined ? {} : { sizeBytes: Number(input.sizeBytes) }),
    availability: MODEL_AVAILABILITY.includes(input.availability) ? input.availability : 'unavailable',
    verification: VERIFICATION_STATUS.includes(input.verification) ? input.verification : 'unknown',
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
    metadataStatus: input.metadataStatus && typeof input.metadataStatus === 'object' ? { ...input.metadataStatus } : {},
    lastSeenAt: Number(input.lastSeenAt || Date.now())
  };
}

module.exports = { MODEL_SOURCES, MODEL_FORMATS, MODEL_AVAILABILITY, VERIFICATION_STATUS, METADATA_STATUS,
  createModelRef, createModelRecord };
