/* eslint-env node */
const Store = require('electron-store');
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
  corsOrigins: ['*'], // Restrict in production
  
  // Monitoring
  logLevel: 'info',
  metricsEnabled: false,
};

function getApiConfig() {
  const stored = store.get('apiServer', DEFAULT_API_CONFIG);
  // Merge with defaults to ensure all fields exist (backward compatibility)
  return { ...DEFAULT_API_CONFIG, ...stored };
}

function setApiConfig(config) {
  const current = getApiConfig();
  const merged = { ...current, ...config };
  
  // Validate
  if (merged.port && (merged.port < 1024 || merged.port > 65535)) {
    throw new Error('Port must be between 1024 and 65535');
  }
  if (merged.host && typeof merged.host !== 'string') {
    throw new Error('Host must be a string');
  }
  if (merged.requestTimeout && merged.requestTimeout < 1000) {
    throw new Error('Request timeout must be at least 1000ms');
  }
  if (merged.maxConcurrentRequests && merged.maxConcurrentRequests < 1) {
    throw new Error('Max concurrent requests must be at least 1');
  }
  if (merged.circuitBreakerThreshold && merged.circuitBreakerThreshold < 1) {
    throw new Error('Circuit breaker threshold must be at least 1');
  }
  if (merged.circuitBreakerResetMs && merged.circuitBreakerResetMs < 1000) {
    throw new Error('Circuit breaker reset time must be at least 1000ms');
  }
  if (merged.streamHeartbeatIntervalMs && merged.streamHeartbeatIntervalMs < 5000) {
    throw new Error('Stream heartbeat interval must be at least 5000ms');
  }
  
  store.set('apiServer', merged);
  return merged;
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
  if (!cfg.requireApiKey) return true;
  if (!cfg.apiKey) return true; // No key configured, skip validation
  return providedKey === cfg.apiKey;
}

module.exports = {
  getApiConfig,
  setApiConfig,
  getApiUrl,
  getApiOpenAIEndpoint,
  getServerArgs,
  validateApiKey,
  DEFAULT_API_CONFIG,
};
