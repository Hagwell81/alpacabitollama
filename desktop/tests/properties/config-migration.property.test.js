/* eslint-env node */
const assert = require('node:assert/strict');
const test = globalThis.test;
const fc = require('fast-check');
const { VersionedConfigStore } = require('../../config/versioned-config-store');

function fakeStore(initial) {
  const values = { ...initial };
  return {
    get(key, fallback) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback; },
    set(key, value) { values[key] = JSON.parse(JSON.stringify(value)); },
    values
  };
}

const hostArbitrary = fc.constantFrom('127.0.0.1', 'localhost', '::1');
const unknownKeyArbitrary = fc.stringMatching(/^[a-z][a-z0-9]{1,10}$/)
  .filter((key) => !['host', 'port', 'enabled', 'schemaVersion', 'revision', 'config', 'warnings', 'updatedAt'].includes(key));
const unknownValueArbitrary = fc.oneof(fc.string({ maxLength: 24 }), fc.boolean(), fc.integer({ min: 0, max: 100000 }));

function validate(config) {
  if (typeof config.host !== 'string' || !config.host) throw new Error('invalid host');
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('invalid port');
  if (typeof config.enabled !== 'boolean') throw new Error('invalid enabled');
  return { config, warnings: [] };
}

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 15: Configuration migration idempotence
// **Validates: Requirements 11.1-11.6, 16.4**

test('migrates generated legacy configurations idempotently while retaining unknown settings', () => {
  fc.assert(
    fc.property(
      hostArbitrary,
      fc.integer({ min: 1024, max: 65535 }),
      fc.boolean(),
      unknownKeyArbitrary,
      unknownValueArbitrary,
      (host, port, enabled, unknownKey, unknownValue) => {
        const legacy = { host, port, enabled, [unknownKey]: unknownValue };
        const store = fakeStore({ apiServer: legacy });
        const config = new VersionedConfigStore({
          store,
          defaults: { host: '127.0.0.1', port: 13434, enabled: true },
          validate,
          clock: () => '2026-01-01T00:00:00.000Z'
        });
        const first = config.snapshot();
        const second = config.snapshot();
        assert.deepEqual(second, first);
        assert.equal(first.schemaVersion, 1);
        assert.equal(first.config[unknownKey], unknownValue);
        assert.deepEqual(store.values.apiServer, legacy);
        assert.deepEqual(store.values.apiServerConfig.config, first.config);
      }
    ),
    { numRuns: 120 }
  );
});

test('applies ordered generated migration chains exactly once', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1024, max: 65535 }), (port) => {
      const store = fakeStore({ apiServerConfig: { schemaVersion: 1, revision: 2, config: { port }, warnings: [] } });
      const config = new VersionedConfigStore({
        store,
        currentVersion: 3,
        defaults: { host: '127.0.0.1', port: 13434, enabled: true },
        validate,
        migrations: [
          { from: 1, to: 2, up: (value) => ({ ...value, host: 'localhost' }) },
          { from: 2, to: 3, up: (value) => ({ config: { ...value, migrated: true }, warnings: ['generated migration'] }) }
        ],
        clock: () => '2026-01-01T00:00:00.000Z'
      });
      const result = config.snapshot();
      assert.equal(result.schemaVersion, 3);
      assert.equal(result.config.migrated, true);
      assert.equal(config.snapshot().revision, 2);
      assert.equal(store.values.apiServerConfig.schemaVersion, 3);
    }),
    { numRuns: 120 }
  );
});
