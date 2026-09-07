/* eslint-env node */
const assert = require('node:assert/strict');
const test = globalThis.test;
const fc = require('fast-check');
const { validateApiConfig, normalizeCorsOrigins } = require('../../security/api-policy');

const loopbackHost = fc.constantFrom('127.0.0.1', 'localhost', '::1', '[::1]');
const exposedHost = fc.constantFrom('0.0.0.0', '192.168.1.25', 'example.test', '::');
const apiKey = fc.stringMatching(/^[A-Za-z0-9]{16,48}$/);
const explicitOrigin = fc.constantFrom('https://client.example.test', 'http://localhost:3000', 'https://app.example.test:8443');

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 14: Security policy validation
// **Validates: Requirements 10.1-10.7**

test('keeps loopback defaults available while requiring confirmation and key protection for exposure', () => {
  fc.assert(
    fc.property(loopbackHost, (host) => {
      const result = validateApiConfig({ host });
      assert.equal(result.config.host, host);
      assert.deepEqual(result.config.corsOrigins, ['*']);
      assert.throws(() => validateApiConfig({ host: '0.0.0.0' }), /confirmation/);
    }),
    { numRuns: 120 }
  );

  fc.assert(
    fc.property(exposedHost, apiKey, fc.array(explicitOrigin, { minLength: 1, maxLength: 3 }), (host, key, origins) => {
      assert.throws(
        () => validateApiConfig({ host, requireApiKey: true, apiKey: key, corsOrigins: origins }, {}, { confirmed: false }),
        /confirmation/
      );
      const result = validateApiConfig({ host, requireApiKey: true, apiKey: key, corsOrigins: origins }, {}, { confirmed: true });
      assert.equal(result.config.host, host);
      assert.deepEqual(normalizeCorsOrigins(origins), result.config.corsOrigins);
      assert.throws(() => validateApiConfig({ host, requireApiKey: true, apiKey: key, corsOrigins: ['*'] }, {}, { confirmed: true }), /explicit CORS/);
    }),
    { numRuns: 120 }
  );
});

test('never permits credentialed wildcard CORS for generated policy inputs', () => {
  fc.assert(
    fc.property(fc.boolean(), (allowCredentials) => {
      if (allowCredentials) assert.throws(() => validateApiConfig({ allowCredentials, corsOrigins: ['*'] }), /wildcard/);
      else assert.doesNotThrow(() => validateApiConfig({ allowCredentials, corsOrigins: ['*'] }));
    }),
    { numRuns: 120 }
  );
});
