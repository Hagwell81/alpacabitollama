const assert = require('node:assert/strict');
const { VersionedConfigStore } = require('../../config/versioned-config-store');

function fakeStore(initial = {}) {
  const values = { ...initial };
  return {
    get(key, fallback) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback; },
    set(key, value) { values[key] = JSON.parse(JSON.stringify(value)); },
    values
  };
}

const defaults = { host: '127.0.0.1', port: 13434, enabled: true };
const validate = (config) => {
  if (typeof config.host !== 'string' || !config.host) throw new Error('invalid host');
  if (!Number.isInteger(config.port) || config.port < 1024) throw new Error('invalid port');
  return { config, warnings: [] };
};

test('versioned store migrates legacy config and preserves unknown settings idempotently', () => {
  const store = fakeStore({ apiServer: { host: 'localhost', port: 14000, unknownSetting: 'retained' } });
  const config = new VersionedConfigStore({ store, defaults, validate, clock: () => '2026-01-01T00:00:00.000Z' });
  const first = config.snapshot();
  const second = config.snapshot();
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.config.unknownSetting, 'retained');
  assert.deepEqual(second, first);
  assert.deepEqual(store.values.apiServer, { host: 'localhost', port: 14000, unknownSetting: 'retained' });
  assert.equal(store.values.apiServerConfig.schemaVersion, 1);
});

test('versioned store applies ordered migrations and increments revisions', () => {
  const store = fakeStore({ apiServerConfig: { schemaVersion: 1, revision: 3, config: { port: 14000 }, warnings: [] } });
  const config = new VersionedConfigStore({
    store,
    defaults,
    currentVersion: 3,
    validate,
    migrations: [
      { from: 1, to: 2, up: (value) => ({ ...value, host: 'localhost' }) },
      { from: 2, to: 3, up: (value) => ({ config: { ...value, migrated: true }, warnings: ['migrated'] }) }
    ],
    clock: () => '2026-01-01T00:00:00.000Z'
  });
  assert.equal(config.snapshot().config.migrated, true);
  assert.equal(config.save({ host: 'localhost', port: 15000 }).revision, 4);
  assert.equal(config.snapshot().revision, 4);
});

test('versioned store backs up before writes and resets without deleting data', () => {
  const store = fakeStore({ apiServerConfig: { schemaVersion: 1, revision: 1, config: { ...defaults, keep: true }, warnings: [] } });
  const config = new VersionedConfigStore({ store, defaults, validate });
  const backupCalls = [];
  config.createBackup = () => { backupCalls.push(true); };
  const reset = config.resetToDefaults();
  assert.equal(backupCalls.length, 1);
  assert.equal(reset.config.keep, undefined);
  assert.equal(store.values.apiServerConfig.config.host, defaults.host);
  assert.equal(config.exportRecovery().recoveryMode, true);
});

test('invalid stored config recovers to safe defaults with a warning', () => {
  const store = fakeStore({ apiServerConfig: { schemaVersion: 1, revision: 5, config: { host: '', port: 1 }, warnings: [] } });
  const config = new VersionedConfigStore({ store, defaults, validate });
  const snapshot = config.snapshot();
  assert.deepEqual(snapshot.config, defaults);
  assert.match(snapshot.warnings.join(' '), /recovery/i);
});
