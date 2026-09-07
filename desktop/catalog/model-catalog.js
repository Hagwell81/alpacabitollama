/* eslint-env node */
/**
 * Pure model-catalog snapshot merger. Sources are intentionally supplied as
 * plain data so this module does not own discovery, filesystem, or provider IO.
 */
const { createModelRecord, MODEL_SOURCES, MODEL_AVAILABILITY, VERIFICATION_STATUS } = require('../runtime/catalog-contract');
const {
  digestIdentity, provisionalIdentity, aliasFor, aliasKey, executionAvailability, normalizeDigest
} = require('./model-identity');

const SOURCE_ORDER = Object.freeze({ local: 0, curated: 1, router: 2, discovery: 3 });

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function sourceName(source) {
  return MODEL_SOURCES.includes(source) ? source : String(source || 'local');
}

function sourceInput(sources, source) {
  if (Array.isArray(sources)) return sources.filter((record) => sourceName(record?.source) === source);
  const value = sources?.[source];
  if (Array.isArray(value)) return { records: value };
  if (value && typeof value === 'object') return { records: Array.isArray(value.records) ? value.records : [], ...value };
  return value === undefined ? undefined : { records: [] };
}

function verificationOf(record) {
  return VERIFICATION_STATUS.includes(record.verification) ? record.verification : 'unknown';
}

function digestKey(record) { return digestIdentity(record.digest); }

function recordKey(record) { return digestKey(record) || provisionalIdentity(record); }

function mergeUnique(values, keyFn = (value) => JSON.stringify(value)) {
  const result = [];
  const seen = new Set();
  values.forEach((value) => { const key = keyFn(value); if (!seen.has(key)) { seen.add(key); result.push(value); } });
  return result;
}

function normalizeRecord(input, source, now) {
  const raw = { ...(input || {}), source: sourceName(input?.source || source) };
  const digest = normalizeDigest(raw.digest);
  const verification = verificationOf(raw);
  const availability = MODEL_AVAILABILITY.includes(raw.availability) ? raw.availability : 'unavailable';
  const record = createModelRecord({
    ...raw,
    availability: executionAvailability({ verification, digest }, availability),
    lastSeenAt: raw.lastSeenAt ?? now
  });
  const aliases = mergeUnique([...(Array.isArray(raw.aliases) ? raw.aliases : []), aliasFor(record)], aliasKey);
  return { ...record, verification, aliases, sources: [record.source] };
}

function mergeRecord(previous, incoming) {
  const preferred = SOURCE_ORDER[incoming.source] < SOURCE_ORDER[previous.source] ? incoming : previous;
  const merged = {
    ...previous,
    ...incoming,
    id: preferred.id,
    displayName: incoming.displayName || previous.displayName,
    providerId: preferred.providerId,
    providerGroupId: preferred.providerGroupId,
    source: preferred.source,
    format: incoming.format !== 'unknown' ? incoming.format : previous.format,
    reference: preferred.reference,
    digest: incoming.digest || previous.digest,
    capabilities: mergeUnique([...(previous.capabilities || []), ...(incoming.capabilities || [])], String),
    contextLimit: incoming.contextLimit ?? previous.contextLimit,
    sizeBytes: incoming.sizeBytes ?? previous.sizeBytes,
    metadata: { ...(previous.metadata || {}), ...(incoming.metadata || {}) },
    metadataStatus: { ...(previous.metadataStatus || {}), ...(incoming.metadataStatus || {}) },
    aliases: mergeUnique([...(previous.aliases || []), ...(incoming.aliases || []), aliasFor(previous), aliasFor(incoming)], aliasKey),
    sources: mergeUnique([...(previous.sources || []), ...(incoming.sources || [])], String),
    lastSeenAt: Math.max(Number(previous.lastSeenAt) || 0, Number(incoming.lastSeenAt) || 0)
  };
  // A fresh available observation wins over stale retention, but unavailable
  // observations must not erase a verified artifact from another source.
  if (incoming.availability === 'available' && incoming.verification === 'verified') merged.availability = 'available';
  else if (previous.availability === 'available') merged.availability = 'available';
  return merged;
}

function sortRecords(a, b) {
  const fields = [a.providerGroupId, a.displayName, digestKey(a) || '', a.id];
  const other = [b.providerGroupId, b.displayName, digestKey(b) || '', b.id];
  for (let index = 0; index < fields.length; index += 1) {
    const left = String(fields[index]).toLocaleLowerCase();
    const right = String(other[index]).toLocaleLowerCase();
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

function normalizeFailure(source, failure, now) {
  const value = failure instanceof Error ? { message: failure.message } : (failure || {});
  return {
    source: sourceName(source), code: String(value.code || 'SOURCE_UNAVAILABLE'),
    message: String(value.message || 'Catalog source is unavailable.'), retryable: value.retryable !== false,
    ...(value.correlationId ? { correlationId: String(value.correlationId) } : {}), at: Number(value.at || now)
  };
}

function createCatalogSnapshot(input = {}, previous, options = {}) {
  const now = Number(options.now ?? input.now ?? Date.now());
  const old = previous?.records ? previous : { records: [], sourceFailures: [] };
  const byKey = new Map();
  old.records.forEach((record) => byKey.set(recordKey(record), clone(record)));
  const failures = new Map((old.sourceFailures || []).map((failure) => [failure.source, clone(failure)]));
  const supplied = Array.isArray(input) ? new Set(input.map((record) => sourceName(record?.source))) : new Set(MODEL_SOURCES.filter((source) => sourceInput(input, source) !== undefined));

  MODEL_SOURCES.forEach((source) => {
    if (!supplied.has(source)) return;
    const batch = sourceInput(input, source) || { records: [] };
    const failure = batch.error || batch.failure;
    if (failure) {
      failures.set(source, normalizeFailure(source, failure, now));
      byKey.forEach((record, key) => {
        const sources = record.sources || [record.source];
        if (sources.includes(source) && sources.every((value) => value === source)) byKey.set(key, { ...record, availability: 'stale' });
      });
      return;
    }
    failures.delete(source);
    const records = Array.isArray(batch) ? batch : (batch.records || []);
    // Replace observations for this source; retained records from other sources stay.
    Array.from(byKey.entries()).forEach(([key, record]) => {
      if ((record.sources || [record.source]).length === 1 && record.source === source) byKey.delete(key);
    });
    records.forEach((value) => {
      const record = normalizeRecord(value, source, now);
      const key = recordKey(record);
      // A later verified observation upgrades a matching provisional alias to
      // the canonical digest identity instead of leaving two catalog entries.
      const provisional = record.aliases.find((alias) => byKey.has(`source:${alias.source}:${alias.providerId}:${alias.id}:${alias.reference}`));
      const matchingKey = provisional && !byKey.has(key) ? `source:${provisional.source}:${provisional.providerId}:${provisional.id}:${provisional.reference}` : key;
      byKey.set(key, byKey.has(key) ? mergeRecord(byKey.get(key), record) : (matchingKey !== key && byKey.has(matchingKey)
        ? mergeRecord(byKey.get(matchingKey), record) : record));
      if (matchingKey !== key) byKey.delete(matchingKey);
    });
  });

  const records = Array.from(byKey.values()).sort(sortRecords).map((record) => ({
    ...record,
    aliases: mergeUnique(record.aliases || [aliasFor(record)], aliasKey),
    sources: mergeUnique(record.sources || [record.source], String)
  }));
  const aliases = Object.fromEntries(records.flatMap((record) => (record.aliases || []).map((alias) => [aliasKey(alias), record.id])));
  return deepFreeze({ version: Number(old.version || 0) + 1, generatedAt: now, records, aliases,
    sourceFailures: Array.from(failures.values()).sort((a, b) => a.source.localeCompare(b.source)) });
}

function mergeCatalogSources(sources, previous, options) { return createCatalogSnapshot(sources, previous, options); }

class ModelCatalog {
  constructor(options = {}) { this.snapshot = createCatalogSnapshot(options.sources || {}, options.snapshot, options); }
  merge(sources, options = {}) { this.snapshot = createCatalogSnapshot(sources, this.snapshot, options); return this.snapshot; }
  getSnapshot() { return this.snapshot; }
  list() { return this.snapshot.records; }
}

function serializeSnapshot(snapshot) { return JSON.stringify(snapshot); }
function deserializeSnapshot(value) { return deepFreeze(JSON.parse(String(value))); }

module.exports = { ModelCatalog, createCatalogSnapshot, mergeCatalogSources, normalizeRecord, serializeSnapshot, deserializeSnapshot, deepFreeze };
