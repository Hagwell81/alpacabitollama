/* eslint-env node */
const crypto = require('node:crypto');
const net = require('node:net');

const DEFAULT_API_POLICY = {
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


function isLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === 'ip6-localhost') return true;
  const addressType = net.isIP(normalized);
  if (addressType === 4) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return addressType === 6 && (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1');
}

function classifyExposure(host) {
  return isLoopbackHost(host) ? 'loopback' : 'non-loopback';
}

function normalizeCorsOrigins(origins) {
  if (!Array.isArray(origins) || origins.length === 0) throw new Error('CORS origins must be a non-empty array');
  const normalized = [...new Set(origins.map((origin) => {
    if (typeof origin !== 'string') throw new Error('CORS origins must be strings');
    const value = origin.trim();
    if (value === '*') return value;
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('CORS origins must be valid origins'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('CORS origins must be valid HTTP(S) origins');
    }
    return `${parsed.protocol}//${parsed.host}`;
  }))];
  if (normalized.includes('*') && normalized.length > 1) throw new Error('CORS wildcard cannot be combined with explicit origins');
  return normalized;
}

function validateApiConfig(input, defaults = {}, options = {}) {
  const config = { ...DEFAULT_API_POLICY, ...defaults, ...input };
  if (typeof config.enabled !== 'boolean' || typeof config.cors !== 'boolean' || typeof config.allowCredentials !== 'boolean' || typeof config.requireApiKey !== 'boolean') throw new Error('API security settings must be boolean');
  if (typeof config.host !== 'string' || !config.host.trim()) throw new Error('Host must be a non-empty string');
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Port must be between 1024 and 65535');
  if (!Number.isFinite(config.requestTimeout) || config.requestTimeout < 1000) throw new Error('Request timeout must be at least 1000ms');
  if (!Number.isInteger(config.maxConcurrentRequests) || config.maxConcurrentRequests < 1) throw new Error('Max concurrent requests must be at least 1');
  if (!Number.isInteger(config.circuitBreakerThreshold) || config.circuitBreakerThreshold < 1) throw new Error('Circuit breaker threshold must be at least 1');
  if (!Number.isFinite(config.circuitBreakerResetMs) || config.circuitBreakerResetMs < 1000) throw new Error('Circuit breaker reset time must be at least 1000ms');
  if (!Number.isFinite(config.streamHeartbeatIntervalMs) || config.streamHeartbeatIntervalMs < 5000) throw new Error('Stream heartbeat interval must be at least 5000ms');
  const corsOrigins = normalizeCorsOrigins(config.corsOrigins);
  if (config.allowCredentials && corsOrigins.includes('*')) throw new Error('Credentialed CORS cannot use wildcard origins');
  if (config.requireApiKey && (typeof config.apiKey !== 'string' || config.apiKey.length < 16)) throw new Error('API key protection requires a non-empty key of at least 16 characters');
  const exposure = classifyExposure(config.host);
  if (exposure === 'non-loopback') {
    if (!options.confirmed) throw new Error('Non-loopback API exposure requires explicit confirmation');
    if (!config.requireApiKey || !config.apiKey) throw new Error('Non-loopback API exposure requires API-key protection');
    if (corsOrigins.includes('*')) throw new Error('Non-loopback API exposure requires an explicit CORS allowlist');
  }
  return { config: { ...config, host: config.host.trim(), corsOrigins }, warnings: [] };
}

function validateApiKey(providedKey, configuredKey, required) {
  if (!required) return true;
  if (typeof configuredKey !== 'string' || configuredKey.length < 16 || typeof providedKey !== 'string' || providedKey.length !== configuredKey.length) return false;
  return crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(configuredKey));
}

module.exports = { isLoopbackHost, classifyExposure, normalizeCorsOrigins, validateApiConfig, validateApiKey };
