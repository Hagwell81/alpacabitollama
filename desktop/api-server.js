/* eslint-env node */
const Store = require('electron-store');
const crypto = require('node:crypto');
const { VersionedConfigStore } = require('./config/versioned-config-store');
const store = new Store();

const DEFAULT_API_CONFIG = {
  // Basic settings
  enabled: true,
  host: '127.0.0.1',
  port: 13434,
  cors: true,
  
  // Timeout & concurrency
  requestTimeout: 300000, // 5 minutes for long generations
  maxConcurrentRequests: 10,
  
  // Circuit breaker settings
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 5, // fail after 5 consecutive errors
  circuitBreakerResetMs: 60000, // reset after 1 minute
  
  // Heartbeat for streaming
  streamHeartbeatIntervalMs: 30000, // 30 seconds
  
  // Security
  requireApiKey: false,
  apiKey: null,
  corsOrigins: ['*'],
  allowCredentials: false, // Credentialed wildcard CORS is never permitted
  // Monitoring
  logLevel: 'info',
  metricsEnabled: false,
};

const { isLoopbackHost, classifyExposure, normalizeCorsOrigins, validateApiConfig: validatePolicyApiConfig, validateApiKey: validatePolicyApiKey } = require('./security/api-policy');

function validateApiConfig(input, options = {}) {
  return validatePolicyApiConfig(input, DEFAULT_API_CONFIG, options);
}

const configStore = new VersionedConfigStore({
  store,
  defaults: DEFAULT_API_CONFIG,
  validate: (config) => validateApiConfig(config, { confirmed: isLoopbackHost(config.host) })
});
const pendingConfirmations = new Map();

function getApiConfig() {
  return configStore.snapshot().config;
}

function redactApiConfig(config) {
  return { ...config, apiKey: config.apiKey ? '[REDACTED]' : null, hasApiKey: Boolean(config.apiKey) };
}

function getPublicApiConfig() {
  return redactApiConfig(getApiConfig());
}

function previewApiConfig(config) {
  const candidate = { ...getApiConfig(), ...config };
  const validated = validateApiConfig(candidate, { confirmed: isLoopbackHost(candidate.host) });
  if (classifyExposure(validated.config.host) === 'non-loopback') {
    const token = crypto.randomBytes(24).toString('hex');
    pendingConfirmations.set(token, Date.now() + 120000);
    return { requiresConfirmation: true, confirmationToken: token, expiresInMs: 120000, exposure: 'non-loopback', config: redactApiConfig(validated.config) };
  }
  return { requiresConfirmation: false, exposure: 'loopback', config: redactApiConfig(validated.config) };
}

function setApiConfig(config, options = {}) {
  const current = getApiConfig();
  const candidate = { ...current, ...config };
  let confirmed = isLoopbackHost(candidate.host);
  if (!confirmed && options.confirmationToken) {
    const expiry = pendingConfirmations.get(options.confirmationToken);
    confirmed = Boolean(expiry && expiry > Date.now());
    pendingConfirmations.delete(options.confirmationToken);
  }
  const validated = validateApiConfig(candidate, { confirmed });
  const updated = configStore.save(validated.config).config;
  return { ...updated, exposure: classifyExposure(updated.host) };
}

function getApiUrl() {
  const cfg = getApiConfig();
  if (!cfg.enabled) return null;
  return `http://${cfg.host}:${cfg.port}`;
}

function getApiOpenAIEndpoint() {
  const url = getApiUrl();
  if (!url) return null;
  return `${url}/v1`;
}

function getServerArgs() {
  const cfg = getApiConfig();
  const args = [
    '--host', cfg.host || '127.0.0.1',
    '--port', String(cfg.port || 13434),
  ];

  // CORS: upstream llama-server (b9016+) no longer accepts the `--cors`
  // boolean flag and crashes on startup with "invalid argument: --cors".
  // The server is bound to 127.0.0.1 and the Electron renderer loads the
  // UI from the same origin, so no CORS configuration is required for
  // the default configuration. We intentionally do not forward any CORS
  // args to the binary. If the user has explicitly configured origins in
  // settings, emit a one-time warning so they know it is a no-op until
  // upstream support is reintroduced.
  if (cfg.cors && Array.isArray(cfg.corsOrigins) && cfg.corsOrigins.some(o => o && o !== '*')) {
    console.warn('[api-server] Custom CORS origins configured but current llama-server build does not accept CORS flags; ignoring. Server binds to 127.0.0.1 only.');
  }

  // Security: API key if configured
  if (cfg.requireApiKey && cfg.apiKey) {
    args.push('--api-key', cfg.apiKey);
  }

  return args;
}

function validateApiKey(providedKey) {
  const cfg = getApiConfig();
  return validatePolicyApiKey(providedKey, cfg.apiKey, cfg.requireApiKey);
}

module.exports = {
  getApiConfig,
  getPublicApiConfig,
  setApiConfig,
  previewApiConfig,
  validateApiConfig,
  isLoopbackHost,
  classifyExposure,
  normalizeCorsOrigins,
  getApiUrl,
  getApiOpenAIEndpoint,
  getServerArgs,
  validateApiKey,
  DEFAULT_API_CONFIG,
};
