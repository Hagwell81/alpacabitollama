/* eslint-env node */
/**
 * Content identity and artifact verification primitives for catalog records.
 * This module deliberately does not read files itself: callers can feed an
 * async iterable (including a Node readable) to digestStream so large model
 * files are never buffered in memory.
 */
const crypto = require('crypto');

const DEFAULT_DIGEST_ALGORITHM = 'sha256';

function normalizeAlgorithm(algorithm = DEFAULT_DIGEST_ALGORITHM) {
  const value = String(algorithm).trim().toLowerCase();
  if (!value || !/^[a-z0-9-]+$/.test(value)) throw new TypeError('Digest algorithm must be a valid name');
  return value;
}

function normalizeDigest(digest) {
  if (!digest || typeof digest !== 'object') return null;
  try {
    const algorithm = normalizeAlgorithm(digest.algorithm);
    const value = String(digest.value || '').trim().toLowerCase();
    if (!value) return null;
    return { algorithm, value, verified: digest.verified === true };
  } catch (_) {
    return null;
  }
}

function hasVerifiedDigest(digest) {
  return Boolean(normalizeDigest(digest)?.verified);
}

function digestIdentity(digest) {
  const normalized = normalizeDigest(digest);
  return normalized?.verified ? `digest:${normalized.algorithm}:${normalized.value}` : null;
}

function provisionalIdentity(record = {}) {
  return `source:${String(record.source || 'local')}:${String(record.providerId || '')}:${String(record.id || '')}:${String(record.reference || '')}`;
}

function contentIdentity(record = {}) {
  return digestIdentity(record.digest) || provisionalIdentity(record);
}

function aliasKey(alias = {}) {
  return `${String(alias.source || 'local')}:${String(alias.providerId || '')}:${String(alias.id || '')}:${String(alias.reference || '')}`;
}

function aliasFor(record = {}) {
  return { id: String(record.id || ''), source: String(record.source || 'local'), reference: String(record.reference || ''), providerId: String(record.providerId || '') };
}

function isExecutableArtifact(record = {}) {
  return record.verification === 'verified' && hasVerifiedDigest(record.digest) && record.availability === 'available';
}

function executionAvailability(record = {}, requestedAvailability = record.availability) {
  if (requestedAvailability === 'stale') return 'stale';
  return requestedAvailability === 'available' && isExecutableArtifact({ ...record, availability: requestedAvailability })
    ? 'available' : 'unavailable';
}

function createHasher(algorithm = DEFAULT_DIGEST_ALGORITHM) {
  return crypto.createHash(normalizeAlgorithm(algorithm));
}

async function digestStream(source, options = {}) {
  if (!source || typeof source[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('Digest source must be an async iterable');
  }
  const algorithm = normalizeAlgorithm(options.algorithm);
  const hash = createHasher(algorithm);
  for await (const chunk of source) hash.update(chunk);
  return { algorithm, value: hash.digest('hex'), verified: true };
}

async function digestArtifact(source, options = {}) {
  return digestStream(source, options);
}

function verifyDigest(actual, expected) {
  const observed = normalizeDigest(actual);
  const trusted = normalizeDigest({ ...(expected || {}), verified: true });
  return Boolean(observed && trusted && observed.algorithm === trusted.algorithm && observed.value === trusted.value);
}

function artifactIdentity(digest) {
  const normalized = normalizeDigest({ ...(digest || {}), verified: true });
  if (!normalized) throw new TypeError('A verified digest is required for artifact identity');
  return digestIdentity(normalized);
}

module.exports = {
  DEFAULT_DIGEST_ALGORITHM,
  normalizeAlgorithm,
  normalizeDigest,
  hasVerifiedDigest,
  digestIdentity,
  provisionalIdentity,
  contentIdentity,
  aliasKey,
  aliasFor,
  isExecutableArtifact,
  executionAvailability,
  createHasher,
  digestStream,
  digestArtifact,
  verifyDigest,
  artifactIdentity
};
