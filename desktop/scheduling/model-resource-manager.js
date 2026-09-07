'use strict';

const { contentIdentity, normalizeDigest } = require('../catalog/model-identity');
const { createSafeError } = require('../runtime/error-contract');

const RESOURCE_ERROR_CODES = Object.freeze({
  NOT_FOUND: 'RESOURCE_NOT_FOUND',
  CAPACITY: 'RESOURCE_CAPACITY'
});

class ModelResourceError extends Error {
  constructor({ code, message, retryable = false, recoveryAction = 'Open diagnostics', details } = {}) {
    super(message);
    this.name = 'ModelResourceError';
    Object.assign(this, createSafeError({ code, message, retryable, recoveryAction, details }));
  }
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function normalizeDuration(value) {
  const number = finiteNonNegative(value);
  return number === undefined ? 0 : number;
}

function asModelRef(value) {
  if (typeof value === 'string') return { id: value };
  if (!value || typeof value !== 'object') throw new TypeError('A model reference is required');
  return value;
}

function resourceBytes(resource = {}) {
  return finiteNonNegative(resource.bytes ?? resource.sizeBytes ?? resource.allocatedBytes ?? resource.memoryBytes);
}

function identityFor(model) {
  return contentIdentity(model);
}

function compareEntries(left, right) {
  return left.identity.localeCompare(right.identity) || String(left.providerId).localeCompare(String(right.providerId))
    || String(left.modelId).localeCompare(String(right.modelId));
}

class ModelResourceManager {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.idleMs = normalizeDuration(options.idleMs ?? options.idleUnloadMs ?? 0);
    this.maxResources = finiteNonNegative(options.maxResources ?? options.maxLoaded);
    this.maxBytes = finiteNonNegative(options.maxBytes ?? options.capacityBytes);
    this.unload = typeof options.unload === 'function' ? options.unload : null;
    this._resources = new Map();
    this._tokens = new Map();
    this._nextToken = 1;
  }

  _entry(model, resource = {}, options = {}) {
    const ref = asModelRef(model);
    const identity = options.identity || identityFor(ref);
    let entry = this._resources.get(identity);
    if (!entry) {
      entry = {
        identity,
        modelId: String(ref.id || ref.modelId || ''),
        providerId: String(ref.providerId || ''),
        digest: normalizeDigest(ref.digest) || undefined,
        referenceCount: 0,
        activeStreams: new Set(),
        reservations: new Set(),
        ensureReady: 0,
        lastUsedAt: this.now(),
        loaded: true,
        pinned: false,
        selected: false,
        recoveryProtected: false,
        bytes: resourceBytes(resource),
        resource: resource && typeof resource === 'object' ? { ...resource } : {}
      };
      this._resources.set(identity, entry);
    } else {
      if (resourceBytes(resource) !== undefined) entry.bytes = resourceBytes(resource);
      entry.resource = { ...entry.resource, ...(resource && typeof resource === 'object' ? resource : {}) };
      entry.loaded = true;
      entry.modelId ||= String(ref.id || ref.modelId || '');
      entry.providerId ||= String(ref.providerId || '');
      entry.digest ||= normalizeDigest(ref.digest) || undefined;
    }
    return entry;
  }

  _find(model) {
    const ref = asModelRef(model);
    return this._resources.get(identityFor(ref));
  }

  _require(model) {
    const entry = this._find(model);
    if (!entry) throw new ModelResourceError({ code: RESOURCE_ERROR_CODES.NOT_FOUND, message: 'The model resource is not loaded.', details: { identity: identityFor(asModelRef(model)) } });
    return entry;
  }

  _touch(entry, at = this.now()) {
    const time = Number(at);
    entry.lastUsedAt = Number.isFinite(time) ? time : this.now();
  }

  register(model, resource = {}, options = {}) { return this.markLoaded(model, resource, options); }

  markLoaded(model, resource = {}, options = {}) {
    const entry = this._entry(model, resource, options);
    if (options.pinned !== undefined) entry.pinned = Boolean(options.pinned);
    if (options.selected !== undefined) entry.selected = Boolean(options.selected);
    if (options.recoveryProtected !== undefined) entry.recoveryProtected = Boolean(options.recoveryProtected);
    if (options.lastUsedAt !== undefined) this._touch(entry, options.lastUsedAt);
    return this._snapshotEntry(entry);
  }

  touch(model, at) { const entry = this._require(model); this._touch(entry, at); return this._snapshotEntry(entry); }

  _token(entry, kind, id) {
    const tokenId = String(id || `${kind}-${this._nextToken++}`);
    if (this._tokens.has(tokenId)) throw new TypeError(`Duplicate ${kind} token`);
    const token = { id: tokenId, kind, identity: entry.identity, released: false };
    this._tokens.set(tokenId, token);
    return { id: tokenId, kind, identity: entry.identity, release: () => this.release(tokenId) };
  }

  reserve(model, options = {}) {
    const entry = this._entry(model, options.resource, options);
    const token = this._token(entry, 'reservation', options.reservationId || options.id);
    entry.reservations.add(token.id);
    entry.referenceCount++;
    this._touch(entry);
    if (options.streamId !== undefined) this._startStream(entry, options.streamId);
    return token;
  }

  acquireReservation(model, options = {}) { return this.reserve(model, options); }

  _startStream(entry, streamId) {
    const id = String(streamId || `stream-${this._nextToken++}`);
    if (!entry.activeStreams.has(id)) entry.activeStreams.add(id);
    this._touch(entry);
    return id;
  }

  startStream(model, streamId) {
    const entry = this._require(model);
    const id = this._startStream(entry, streamId);
    return { id, identity: entry.identity, release: () => this.endStream(model, id) };
  }

  markStreamStart(model, streamId) { return this.startStream(model, streamId); }

  endStream(model, streamId) {
    const entry = this._require(model);
    const id = String(streamId);
    const removed = entry.activeStreams.delete(id);
    if (removed) this._touch(entry);
    return removed;
  }

  markStreamEnd(model, streamId) { return this.endStream(model, streamId); }

  release(tokenOrId) {
    const id = typeof tokenOrId === 'object' ? tokenOrId?.id : tokenOrId;
    const token = this._tokens.get(String(id));
    if (!token || token.released) return { released: false, reason: 'already-released' };
    token.released = true;
    const entry = this._resources.get(token.identity);
    if (!entry) return { released: false, reason: 'resource-unloaded' };
    if (token.kind === 'reservation') {
      entry.reservations.delete(token.id);
      entry.referenceCount = Math.max(0, entry.referenceCount - 1);
      this._touch(entry);
    } else if (token.kind === 'ensure-ready') {
      entry.ensureReady = Math.max(0, entry.ensureReady - 1);
      this._touch(entry);
    }
    return { released: true, identity: entry.identity, referenceCount: entry.referenceCount };
  }

  acquireEnsureReady(model, options = {}) {
    const entry = this._entry(model, options.resource, options);
    const token = this._token(entry, 'ensure-ready', options.id);
    entry.ensureReady++;
    this._touch(entry);
    return token;
  }

  markEnsureReady(model, owned = true) {
    const entry = this._require(model);
    entry.ensureReady = owned ? Math.max(1, entry.ensureReady) : 0;
    this._touch(entry);
    return this._snapshotEntry(entry);
  }

  setPinned(model, pinned = true) { const entry = this._require(model); entry.pinned = Boolean(pinned); return this._snapshotEntry(entry); }
  setSelected(model, selected = true) { const entry = this._require(model); entry.selected = Boolean(selected); return this._snapshotEntry(entry); }
  setRecoveryProtected(model, protectedState = true) { const entry = this._require(model); entry.recoveryProtected = Boolean(protectedState); return this._snapshotEntry(entry); }

  _eligibility(entry, at = this.now()) {
    const idle = Number(at) >= entry.lastUsedAt + this.idleMs;
    const eligible = entry.loaded && idle && entry.referenceCount === 0 && entry.activeStreams.size === 0
      && entry.reservations.size === 0 && entry.ensureReady === 0 && !entry.pinned && !entry.selected && !entry.recoveryProtected;
    return { idle, eligible };
  }

  isIdleUnloadEligible(model, at) { return this._eligibility(this._require(model), at).eligible; }

  _snapshotEntry(entry, at = this.now()) {
    const eligibility = this._eligibility(entry, at);
    return {
      identity: entry.identity, modelId: entry.modelId, providerId: entry.providerId,
      ...(entry.digest ? { digest: { ...entry.digest } } : {}), loaded: entry.loaded,
      referenceCount: Math.max(0, entry.referenceCount), activeStreams: entry.activeStreams.size,
      reservationCount: entry.reservations.size, ensureReady: entry.ensureReady,
      pinned: entry.pinned, selected: entry.selected, recoveryProtected: entry.recoveryProtected,
      lastUsedAt: entry.lastUsedAt, idleDeadline: entry.lastUsedAt + this.idleMs,
      idle: eligibility.idle, idleUnloadEligible: eligibility.eligible,
      ...(entry.bytes !== undefined ? { bytes: entry.bytes } : {})
    };
  }

  _candidates(at = this.now()) {
    return [...this._resources.values()].filter((entry) => this._eligibility(entry, at).eligible)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt || compareEntries(left, right));
  }

  _remove(entry, reason) {
    const snapshot = this._snapshotEntry(entry);
    if (this.unload) this.unload(snapshot, reason);
    entry.loaded = false;
    this._resources.delete(entry.identity);
    return { identity: entry.identity, reason, resource: snapshot };
  }

  unloadIdle(options = {}) {
    const limit = options.limit === undefined ? Infinity : Math.max(0, Math.floor(Number(options.limit)));
    const evicted = [];
    for (const entry of this._candidates(options.at)) {
      if (evicted.length >= limit) break;
      evicted.push(this._remove(entry, options.reason || 'idle'));
    }
    return { evicted, snapshot: this.getSnapshot(options.at) };
  }

  evictForCapacity(request = {}, options = {}) {
    const required = finiteNonNegative(typeof request === 'number' ? request : request.bytes ?? request.requiredBytes) || 0;
    const maxResources = this.maxResources === undefined ? Infinity : this.maxResources;
    const maxBytes = this.maxBytes === undefined ? Infinity : this.maxBytes;
    let totalBytes = this.getSnapshot().loadedBytes;
    let count = this._resources.size;
    const needCount = Math.max(0, count + 1 - maxResources);
    const evicted = [];
    for (const entry of this._candidates(options.at)) {
      if (evicted.length >= needCount && totalBytes + required <= maxBytes) break;
      evicted.push(this._remove(entry, options.reason || 'capacity'));
      count--;
      if (entry.bytes !== undefined) totalBytes -= entry.bytes;
    }
    const fits = count + 1 <= maxResources && totalBytes + required <= maxBytes;
    if (!fits) throw new ModelResourceError({ code: RESOURCE_ERROR_CODES.CAPACITY, message: 'No eligible model resource can satisfy capacity.', retryable: true, recoveryAction: 'Close an active model or retry after resources become idle', details: { requiredBytes: required, loaded: count, loadedBytes: totalBytes } });
    return { evicted, snapshot: this.getSnapshot(options.at) };
  }

  getSnapshot(at) {
    const entries = [...this._resources.values()].sort(compareEntries).map((entry) => this._snapshotEntry(entry, at));
    const loadedBytes = entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0);
    return { resources: entries, loaded: entries.length, loadedBytes, protected: entries.filter((entry) => entry.pinned || entry.selected || entry.recoveryProtected || entry.referenceCount > 0 || entry.activeStreams > 0 || entry.reservationCount > 0 || entry.ensureReady > 0).length, idleEligible: entries.filter((entry) => entry.idleUnloadEligible).length, idleMs: this.idleMs, ...(this.maxResources !== undefined ? { maxResources: this.maxResources } : {}), ...(this.maxBytes !== undefined ? { maxBytes: this.maxBytes } : {}) };
  }

  getStatus(at) { return this.getSnapshot(at); }
}

module.exports = { ModelResourceManager, ModelResourceError, RESOURCE_ERROR_CODES };
