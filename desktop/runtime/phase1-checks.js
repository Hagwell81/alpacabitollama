/* eslint-env node */
const fs = require('fs');
const path = require('path');

const REQUIRED_ALIASES = Object.freeze([
  'get-server-status', 'start-server', 'stop-server', 'switch-model',
  'get-installed-models', 'download-models'
]);

function releaseOutcome(context, name, fallback) {
  const value = context?.releaseResults?.[name];
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && typeof value.passed === 'boolean') return value;
  return fallback();
}

function createPhase1CheckMap({ coordinator, diagnosticsService, applicationRoot = path.resolve(__dirname, '..') } = {}) {
  if (!coordinator) throw new TypeError('Phase 1 checks require a runtime coordinator');
  return {
    runtimeLifecycle: (context) => {
      const runtime = context?.runtime || coordinator.snapshot();
      const state = runtime?.runtime?.state;
      const validStates = new Set(['idle', 'acquiring', 'starting', 'ready', 'busy', 'stopping', 'failed', 'cancelling']);
      const epoch = runtime?.runtime?.operationEpoch;
      return {
        passed: validStates.has(state) && Number.isInteger(epoch) && epoch >= 0,
        details: { state: String(state || 'unknown'), operationEpoch: epoch }
      };
    },
    localProvider: (context) => {
      const providers = context?.providers || coordinator.providerStatuses();
      return {
        passed: providers.some((provider) => String(provider?.providerId || '').startsWith('local') && provider.status !== 'disabled'),
        details: { providerCount: providers.length }
      };
    },
    readinessCoordination: () => {
      const snapshot = coordinator.snapshot();
      const readiness = snapshot.readiness || {};
      return { passed: Number.isFinite(readiness.pending) && snapshot.scheduler?.capacity > 0, details: { pending: readiness.pending, capacity: snapshot.scheduler?.capacity } };
    },
    securityContracts: () => {
      try {
        const bridge = require('../security/bridge-schema');
        const policy = require('../security/api-policy');
        return { passed: typeof bridge.validateArgs === 'function' && typeof policy.validateApiConfig === 'function' };
      } catch (_) { return { passed: false, reason: 'Security contracts unavailable' }; }
    },
    diagnosticsPrivacy: () => ({
      passed: Boolean(diagnosticsService?.getHealthProjection?.(coordinator.snapshot())),
      details: { diagnostics: Boolean(diagnosticsService) }
    }),
    compatibilityAliases: () => {
      try {
        const main = fs.readFileSync(path.join(applicationRoot, 'main.js'), 'utf8');
        const preload = fs.readFileSync(path.join(applicationRoot, 'preload.js'), 'utf8');
        const present = REQUIRED_ALIASES.filter((alias) => main.includes(`'${alias}'`) || preload.includes(`'${alias}'`));
        return { passed: present.length === REQUIRED_ALIASES.length, details: { aliases: present.length } };
      } catch (_) { return { passed: false, reason: 'Compatibility sources unavailable' }; }
    },
    artifactTrust: (context) => releaseOutcome(context, 'artifactTrust', () => ({ passed: false, reason: 'Trusted artifact manifest was not supplied' })),
    migrationRecovery: (context) => releaseOutcome(context, 'migrationRecovery', () => ({ passed: false, reason: 'Release migration result was not supplied' })),
    cancellationPrivacy: (context) => releaseOutcome(context, 'cancellationPrivacy', () => ({ passed: false, reason: 'Release cancellation/privacy result was not supplied' })),
    resourceLimits: (context) => releaseOutcome(context, 'resourceLimits', () => ({ passed: false, reason: 'Release resource-limit result was not supplied' })),
    regressionSuite: (context) => releaseOutcome(context, 'regressionSuite', () => ({ passed: false, reason: 'Phase 1 regression result was not supplied' }))
  };
}

module.exports = { REQUIRED_ALIASES, createPhase1CheckMap, releaseOutcome };
