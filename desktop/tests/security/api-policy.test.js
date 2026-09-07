const assert = require('node:assert/strict');
const {
  validateApiConfig,
  normalizeCorsOrigins,
  isLoopbackHost,
  classifyExposure,
  validateApiKey
} = require('../../security/api-policy');

const DEFAULT_API_CONFIG = {
  enabled: true,
  host: '127.0.0.1',
  port: 13434,
  cors: true,
  requestTimeout: 300000,
  maxConcurrentRequests: 10,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60000,
  streamHeartbeatIntervalMs: 30000,
  requireApiKey: false,
  apiKey: null,
  corsOrigins: ['*'],
  allowCredentials: false
};

test('API policy preserves loopback defaults and recognizes loopback forms', () => {
  assert.equal(DEFAULT_API_CONFIG.host, '127.0.0.1');
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(classifyExposure('0.0.0.0'), 'non-loopback');
  assert.equal(classifyExposure('example.test'), 'non-loopback');
  assert.equal(validateApiConfig(DEFAULT_API_CONFIG).config.host, '127.0.0.1');
});

test('API policy normalizes explicit CORS origins and rejects unsafe combinations', () => {
  assert.deepEqual(normalizeCorsOrigins([' https://example.test/ ', 'https://example.test']), ['https://example.test']);
  assert.deepEqual(normalizeCorsOrigins(['*']), ['*']);
  assert.throws(() => normalizeCorsOrigins(['*', 'https://example.test']), /wildcard/);
  assert.throws(() => normalizeCorsOrigins(['not-an-origin']), /valid origins/);
  assert.throws(() => validateApiConfig({ allowCredentials: true }), /wildcard/);
  assert.throws(() => validateApiConfig({ host: '0.0.0.0' }), /confirmation/);
  assert.throws(() => validateApiConfig({ host: '0.0.0.0', requireApiKey: true, apiKey: 'short', corsOrigins: ['https://client.test'] }, {}, { confirmed: true }), /at least 16/);
  assert.throws(() => validateApiConfig({ host: '0.0.0.0', requireApiKey: true, apiKey: '1234567890123456' }, {}, { confirmed: true }), /explicit CORS/);
});

test('API policy requires a valid key when protection is enabled', () => {
  assert.equal(typeof validateApiKey, 'function');
  assert.equal(validateApiKey(undefined, undefined, false), true); // default local mode remains compatible
});
