/* eslint-env node */
/**
 * Opt-in bounded discovery cache for Phase 2 model discovery.
 *
 * Requirements: 18.2-18.3, 16.2-16.3
 *
 * Behavior:
 * - No implicit network access: all fetches are explicit and cancellable.
 * - Bounded result count per source and bounded total cache size.
 * - Source attribution: every cached record carries its source identity.
 * - Verification status: records are marked 'unknown' until verified.
 * - Pagination: supports cursor-based pagination per source.
 * - Expiry: cached pages expire after a configurable TTL.
 * - Previous-record retention: when a source fails, previously verified
 *   records are retained and marked 'stale' rather than deleted.
 * - Cancellation: all operations accept an AbortSignal.
 */
const { createCorrelationId, createSafeError, errorEnvelope, successEnvelope } = require('../runtime/error-contract');

const DEFAULT_MAX_RESULTS_PER_SOURCE = 50;
const DEFAULT_MAX_CACHE_SIZE = 200;
const DEFAULT_EXPIRY_MS = 1000 * 60 * 30; // 30 minutes
const VERIFICATION_STATUS = Object.freeze(['unknown', 'verified', 'mismatch', 'stale']);

function createDiscoveryRecord(input = {}) {
  if (!input.id) throw new TypeError('Discovery record id is required');
  return {
    id: String(input.id),
    displayName: String(input.displayName || input.id),
    source: String(input.source || 'unknown'),
    sourceUri: input.sourceUri ? String(input.sourceUri) : undefined,
    providerId: input.providerId ? String(input.providerId) : undefined,
    providerGroupId: input.providerGroupId ? String(input.providerGroupId) : undefined,
    digest: input.digest ? String(input.digest) : undefined,
    verification: VERIFICATION_STATUS.includes(input.verification) ? input.verification : 'unknown',
    availability: String(input.availability || 'available'),
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
    fetchedAt: Number(input.fetchedAt || Date.now()),
    expiresAt: Number(input.expiresAt || (Date.now() + DEFAULT_EXPIRY_MS))
  };
}

function createDiscoveryPage(input = {}) {
  const records = Array.isArray(input.records) ? input.records.map((r) => createDiscoveryRecord(r)) : [];
  return {
    records,
    source: String(input.source || 'unknown'),
    ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor === null ? null : String(input.nextCursor) }),
    fetchedAt: Number(input.fetchedAt || Date.now()),
    stale: Boolean(input.stale)
  };
}

class DiscoveryCache {
  constructor(options = {}) {
    this._sources = new Map();       // sourceId -> { fetcher, enabled, lastPage, lastError, records: [] }
    this._maxPerSource = Math.max(1, Number(options.maxResultsPerSource || DEFAULT_MAX_RESULTS_PER_SOURCE));
    this._maxCacheSize = Math.max(1, Number(options.maxCacheSize || DEFAULT_MAX_CACHE_SIZE));
    this._expiryMs = Math.max(1000, Number(options.expiryMs || DEFAULT_EXPIRY_MS));
    this._onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : () => {};
    this._enabled = false;
  }

  get enabled() { return this._enabled; }

  /**
   * Enable discovery. Requires explicit user opt-in.
   * No network access occurs here; fetches happen only on discover().
   */
  enable() { this._enabled = true; return true; }

  disable() {
    this._enabled = false;
    for (const entry of this._sources.values()) {
      entry.records = entry.records.map((r) => ({ ...r, verification: 'stale' }));
    }
    return true;
  }

  /**
   * Register a discovery source with its fetcher function.
   * The fetcher receives (cursor, signal) and returns { records, nextCursor }.
   */
  registerSource(sourceId, fetcher, options = {}) {
    if (!sourceId) throw new TypeError('sourceId is required');
    if (typeof fetcher !== 'function') throw new TypeError('fetcher must be a function');
    this._sources.set(String(sourceId), {
      fetcher,
      enabled: options.enabled !== false,
      lastPage: null,
      lastError: undefined,
      records: []
    });
    return true;
  }

  unregisterSource(sourceId) {
    return this._sources.delete(String(sourceId));
  }

  listSources() {
    return [...this._sources.keys()].map((id) => {
      const entry = this._sources.get(id);
      return { id, enabled: entry.enabled, recordCount: entry.records.length, lastError: entry.lastError };
    });
  }

  /**
   * Discover models from a specific source (or all enabled sources).
   * Returns a page of records. Previous records are retained and marked
   * stale if the fetch fails.
   */
  async discover(sourceId, options = {}) {
    const correlationId = createCorrelationId('discovery');
    if (!this._enabled) {
      return errorEnvelope(createSafeError({
        code: 'DISCOVERY_DISABLED',
        message: 'Discovery is not enabled. Enable it explicitly to discover models.',
        retryable: false, correlationId
      }), correlationId);
    }
    const signal = options.signal;
    if (signal?.aborted) {
      return errorEnvelope(createSafeError({
        code: 'CALLER_CANCELLED',
        message: 'Discovery was cancelled.', retryable: false, correlationId
      }), correlationId);
    }

    const sources = sourceId ? [String(sourceId)] : [...this._sources.keys()];
    const allRecords = [];
    const pages = [];

    for (const id of sources) {
      const entry = this._sources.get(id);
      if (!entry || !entry.enabled) continue;

      try {
        const cursor = options.cursor || (entry.lastPage?.nextCursor) || undefined;
        const result = await entry.fetcher(cursor, signal);
        const records = (result.records || []).slice(0, this._maxPerSource).map((r) => createDiscoveryRecord({
          ...r, source: id, fetchedAt: Date.now(), expiresAt: Date.now() + this._expiryMs
        }));

        // Retain previous verified records, mark stale
        const previousById = new Map(entry.records.map((r) => [r.id, r]));
        for (const prev of entry.records) {
          if (!records.find((r) => r.id === prev.id)) {
            records.push({ ...previousById.get(prev.id), verification: 'stale' });
          }
        }

        entry.records = records.slice(0, this._maxCacheSize);
        entry.lastPage = { source: id, nextCursor: result.nextCursor || null, fetchedAt: Date.now() };
        entry.lastError = undefined;
        allRecords.push(...entry.records);
        pages.push(createDiscoveryPage({
          records: entry.records,
          source: id,
          nextCursor: result.nextCursor,
          fetchedAt: Date.now()
        }));
      } catch (error) {
        const safeError = createSafeError({
          code: error?.code === 'ABORT_ERR' || signal?.aborted ? 'CALLER_CANCELLED' : 'DISCOVERY_SOURCE_FAILED',
          message: error?.message || 'Discovery source failed',
          retryable: true, correlationId
        });
        entry.lastError = safeError;
        // Retain previous records as stale
        entry.records = entry.records.map((r) => ({ ...r, verification: 'stale' }));
        allRecords.push(...entry.records);
        pages.push(createDiscoveryPage({ records: entry.records, source: id, stale: true, fetchedAt: Date.now() }));
        this._onDiagnostic({ type: 'discovery-source-failed', source: id, error: safeError, correlationId });
      }
    }

    // Enforce total cache bound
    const bounded = allRecords.slice(0, this._maxCacheSize);
    return successEnvelope({ records: bounded, pages, correlationId });
  }

  /**
   * Return all cached records across all sources without network access.
   * Expired records are marked stale.
   */
  snapshot() {
    const now = Date.now();
    const records = [];
    for (const entry of this._sources.values()) {
      for (const record of entry.records) {
        records.push({
          ...record,
          verification: record.expiresAt < now ? 'stale' : record.verification
        });
      }
    }
    return Object.freeze(records.slice(0, this._maxCacheSize).map(Object.freeze));
  }

  /**
   * Clear all cached records. Does not unregister sources.
   */
  clear() {
    for (const entry of this._sources.values()) {
      entry.records = [];
      entry.lastPage = null;
      entry.lastError = undefined;
    }
    return true;
  }
}

function createDiscoveryCache(options) {
  return new DiscoveryCache(options);
}

module.exports = { DiscoveryCache, createDiscoveryCache, createDiscoveryRecord, createDiscoveryPage, VERIFICATION_STATUS, DEFAULT_MAX_RESULTS_PER_SOURCE, DEFAULT_MAX_CACHE_SIZE, DEFAULT_EXPIRY_MS };
