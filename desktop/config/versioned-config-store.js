/* eslint-env node */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_MIGRATIONS = 20;
const MAX_BACKUPS = 5;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

class VersionedConfigStore {
  constructor(options = {}) {
    if (!options.store || typeof options.store.get !== 'function' || typeof options.store.set !== 'function') {
      throw new TypeError('A store with get/set methods is required');
    }
    this.store = options.store;
    this.key = options.key || 'apiServerConfig';
    this.legacyKey = options.legacyKey || 'apiServer';
    this.currentVersion = Number.isInteger(options.currentVersion) ? options.currentVersion : 1;
    this.defaults = clone(options.defaults || {});
    this.validate = options.validate || ((config) => ({ config: clone(config), warnings: [] }));
    this.migrations = Array.isArray(options.migrations) ? options.migrations.slice() : [];
    this.backupDir = options.backupDir || null;
    this.fs = options.fs || fs;
    this.path = options.path || path;
    this.clock = options.clock || (() => new Date().toISOString());
    this.maxBackups = options.maxBackups || MAX_BACKUPS;
  }

  _record(config, revision = 0, warnings = []) {
    return {
      schemaVersion: this.currentVersion,
      revision,
      config: clone(config),
      warnings: clone(warnings),
      updatedAt: this.clock()
    };
  }

  _raw() {
    return this.store.get(this.key, null);
  }

  _legacy() {
    return this.store.get(this.legacyKey, null);
  }

  _validate(config) {
    const result = this.validate({ ...this.defaults, ...clone(config) });
    if (!result || typeof result !== 'object' || !result.config) throw new Error('Configuration validation failed');
    return { config: clone(result.config), warnings: Array.isArray(result.warnings) ? result.warnings.slice() : [] };
  }

  _migrate(record) {
    let current = clone(record);
    let count = 0;
    const warnings = Array.isArray(current.warnings) ? current.warnings.slice() : [];
    while (current.schemaVersion < this.currentVersion) {
      if (++count > MAX_MIGRATIONS) throw new Error('Configuration migration limit exceeded');
      const migration = this.migrations.find((item) => item && item.from === current.schemaVersion);
      if (!migration || typeof migration.up !== 'function') {
        if (current.schemaVersion === 0) {
          current.schemaVersion = this.currentVersion;
          break;
        }
        throw new Error(`No migration from schema ${current.schemaVersion}`);
      }
      const result = migration.up(clone(current.config));
      current.config = result?.config || result;
      if (Array.isArray(result?.warnings)) warnings.push(...result.warnings);
      current.schemaVersion = migration.to;
    }
    const checked = this._validate(current.config);
    return { config: checked.config, warnings: [...warnings, ...checked.warnings] };
  }

  _write(record) {
    const next = this._record(record.config, record.revision, record.warnings);
    this.store.set(this.key, next);
    return clone(next);
  }

  load() {
    const raw = this._raw();
    const source = raw || (() => {
      const legacy = this._legacy();
      return legacy ? { schemaVersion: 0, revision: 0, config: legacy, warnings: ['Migrated legacy configuration'] } : null;
    })();
    if (!source) return this._write(this._record(this.defaults, 0, []));
    try {
      const migrated = this._migrate({
        schemaVersion: Number.isInteger(source.schemaVersion) ? source.schemaVersion : 0,
        revision: Number.isInteger(source.revision) ? source.revision : 0,
        config: source.config || source,
        warnings: source.warnings || []
      });
      const needsWrite = !raw || source.schemaVersion !== this.currentVersion || JSON.stringify(raw.config) !== JSON.stringify(migrated.config);
      return needsWrite ? this._write(this._record(migrated.config, Number(source.revision) || 0, migrated.warnings)) : this._record(migrated.config, source.revision, migrated.warnings);
    } catch (error) {
      const fallback = this._validate(this.defaults);
      return this._record(fallback.config, 0, [...fallback.warnings, `Configuration recovery: ${error.message}`]);
    }
  }

  snapshot() {
    const record = this.load();
    return {
      schemaVersion: record.schemaVersion,
      revision: record.revision,
      config: clone(record.config),
      warnings: clone(record.warnings),
      updatedAt: record.updatedAt
    };
  }

  save(config) {
    const current = this.load();
    const checked = this._validate(config);
    this.createBackup(current);
    return this._write(this._record(checked.config, current.revision + 1, checked.warnings));
  }

  createBackup(record = this.load()) {
    if (!this.backupDir) return null;
    this.fs.mkdirSync(this.backupDir, { recursive: true });
    const payload = { ...clone(record), checksum: null };
    payload.checksum = crypto.createHash('sha256').update(safeJson(payload)).digest('hex');
    const filename = `config-${Date.now()}-${record.revision}.json`;
    const target = this.path.join(this.backupDir, filename);
    const temporary = `${target}.tmp`;
    this.fs.writeFileSync(temporary, safeJson(payload), 'utf8');
    this.fs.renameSync(temporary, target);
    const files = this.fs.readdirSync(this.backupDir).filter((item) => item.startsWith('config-') && item.endsWith('.json')).sort().reverse();
    for (const old of files.slice(this.maxBackups)) this.fs.rmSync(this.path.join(this.backupDir, old), { force: true });
    return target;
  }

  exportRecovery() {
    const record = this.snapshot();
    return {
      schemaVersion: record.schemaVersion,
      revision: record.revision,
      config: clone(record.config),
      warnings: clone(record.warnings),
      recoveryMode: true
    };
  }

  resetToDefaults() {
    const current = this.load();
    this.createBackup(current);
    return this._write(this._record(this.defaults, current.revision + 1, ['Configuration reset to safe defaults']));
  }
}

module.exports = { VersionedConfigStore, MAX_MIGRATIONS, MAX_BACKUPS };
