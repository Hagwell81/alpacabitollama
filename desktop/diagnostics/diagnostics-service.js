/* eslint-env node */
const fs = require('fs');
const path = require('path');
const { redactDiagnostic } = require('./redactor');
const { createCorrelationId } = require('../runtime/error-contract');

const DEFAULT_MAX_RECORDS = 500;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class DiagnosticsService {
  constructor(options = {}) {
    this.storagePath = options.storagePath || null;
    this.maxRecords = finitePositive(options.maxRecords, DEFAULT_MAX_RECORDS);
    this.maxBytes = finitePositive(options.maxBytes, DEFAULT_MAX_BYTES);
    this.metricsEnabled = options.metricsEnabled === true;
    this.fs = options.fs || fs;
    this.clock = options.clock || (() => new Date().toISOString());
    this.records = [];
    this.bytes = 0;
    this._load();
  }

  _load() {
    if (!this.storagePath) return;
    try {
      const content = this.fs.readFileSync(this.storagePath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { this._appendLoaded(JSON.parse(line)); } catch (_) { /* ignore truncated/corrupt lines */ }
      }
      this._enforceBounds();
    } catch (_) { /* diagnostics must never prevent startup */ }
  }

  _appendLoaded(record) {
    const serialized = JSON.stringify(record);
    const bytes = Buffer.byteLength(`${serialized}\n`, 'utf8');
    if (bytes <= this.maxBytes) { this.records.push(record); this.bytes += bytes; }
  }

  _enforceBounds() {
    while (this.records.length > this.maxRecords || this.bytes > this.maxBytes) {
      const removed = this.records.shift();
      if (removed) this.bytes -= Buffer.byteLength(`${JSON.stringify(removed)}\n`, 'utf8');
    }
  }

  _persist() {
    if (!this.storagePath) return;
    try {
      this.fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      const content = this.records.map((record) => JSON.stringify(redactDiagnostic(record, { metricsEnabled: this.metricsEnabled }))).join('\n');
      this.fs.writeFileSync(this.storagePath, content ? `${content}\n` : '', 'utf8');
    } catch (_) { /* persistence failure must not affect runtime operations */ }
  }

  record(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const record = redactDiagnostic({
      timestamp: source.timestamp || this.clock(),
      severity: source.severity || 'info',
      subsystem: source.subsystem || 'runtime',
      operation: source.operation || 'unknown',
      correlationId: source.correlationId || source.correlation?.id || createCorrelationId('diagnostic'),
      runtimeState: source.runtimeState || source.state || 'unknown',
      ...(source.providerId || source.provider ? { providerId: source.providerId || source.provider } : {}),
      ...(source.modelId || source.model ? { modelId: source.modelId || source.model } : {}),
      ...source
    }, { metricsEnabled: this.metricsEnabled });
    if (!record.timestamp) record.timestamp = this.clock();
    const serialized = JSON.stringify(record);
    const bytes = Buffer.byteLength(`${serialized}\n`, 'utf8');
    if (bytes > this.maxBytes) return null;
    this.records.push(record);
    this.bytes += bytes;
    this._enforceBounds();
    this._persist();
    return copy(record);
  }

  emit(input) { return this.record(input); }
  getRecords() { return copy(this.records); }
  getLatestError() {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      if (this.records[index].error || this.records[index].severity === 'error') return copy(this.records[index].error || this.records[index]);
    }
    return null;
  }

  projectHealth(snapshot = {}, extra = {}) {
    const runtime = snapshot.runtime || {};
    const scheduler = snapshot.scheduler || {};
    const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
    const active = snapshot.readiness?.active || snapshot.readiness?.operation;
    const latestError = this.getLatestError();
    const provider = runtime.provider || snapshot.activeProvider || null;
    const model = runtime.model || snapshot.activeModel || null;
    return copy({
      readiness: runtime.state || 'unknown',
      runtimeState: runtime.state || 'unknown',
      activeProvider: typeof provider === 'string' ? provider : provider?.id || provider?.providerId || null,
      activeModel: typeof model === 'string' ? model : model?.id || model?.identity || null,
      activeRequests: Number(scheduler.active ?? snapshot.readiness?.activeCount ?? 0) || 0,
      queuedRequests: Number(scheduler.queued ?? snapshot.readiness?.pending ?? 0) || 0,
      providers: providers.map((item) => ({ providerId: item.providerId || item.id || null, status: item.status || 'unknown', checkedAt: item.checkedAt || null })),
      latestError: latestError ? {
        code: latestError.code || latestError.error?.code || 'UNKNOWN',
        message: latestError.message || latestError.error?.message || 'The operation could not be completed.',
        retryable: Boolean(latestError.retryable ?? latestError.error?.retryable),
        recoveryAction: latestError.recoveryAction || latestError.error?.recoveryAction || 'Open diagnostics',
        correlationId: latestError.correlationId || latestError.error?.correlationId || null
      } : null,
      artifactVerification: extra.artifactVerification || snapshot.artifactVerification || 'unknown'
    });
  }

  getHealthProjection(snapshot, extra) { return this.projectHealth(snapshot, extra); }

  async exportToStream(writable, options = {}) {
    if (!writable || typeof writable.write !== 'function') throw new TypeError('A writable stream is required');
    const records = this.records.map((item) => redactDiagnostic(item, { metricsEnabled: this.metricsEnabled }));
    const header = options.includeHeader === false ? null : { format: 'alpacabitollama-diagnostics', version: 1, exportedAt: this.clock(), recordCount: records.length };
    const lines = header ? [header, ...records] : records;
    for (const item of lines) {
      const line = `${JSON.stringify(item)}\n`;
      if (!writable.write(line)) await new Promise((resolve, reject) => { writable.once('drain', resolve); writable.once('error', reject); });
    }
    if (typeof writable.end === 'function') await new Promise((resolve, reject) => { writable.once('finish', resolve); writable.once('error', reject); writable.end(); });
    return { recordCount: records.length };
  }
}

module.exports = { DiagnosticsService, DEFAULT_MAX_RECORDS, DEFAULT_MAX_BYTES };
