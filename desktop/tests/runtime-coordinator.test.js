/* eslint-env node */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const { RuntimeCoordinator } = require('../runtime/runtime-coordinator');
const { FeatureGates } = require('../feature-gates');


function coordinator(extra = {}) {
  const calls = [];
  const value = new RuntimeCoordinator({
    lifecycle: {
      start: async () => { calls.push('start'); return true; },
      stop: async () => { calls.push('stop'); return true; }
    },
    ...extra
  });
  return { value, calls };
}

describe('RuntimeCoordinator compatibility seam', () => {
  it('composes runtime state, managed process, readiness, and local provider registry', async () => {
    const { value, calls } = coordinator();
    assert.ok(value.stateMachine);
    assert.ok(value.process);
    assert.ok(value.readiness);
    assert.ok(value.providers.get('local-llama-server'));
    assert.equal(await value.start(), true);
    assert.equal(value.snapshot().runtime.state, 'ready');
    assert.deepEqual(calls, ['start']);
    assert.equal(await value.stop(), true);
    assert.equal(value.snapshot().runtime.state, 'idle');
  });

  it('coalesces EnsureReady callers and preserves independent results', async () => {
    const { value } = coordinator();
    let executions = 0;
    const first = value.readiness.ensureReady({ providerId: 'test', modelIdentity: 'm' }, async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { success: true, state: 'ready' };
    });
    const second = value.readiness.ensureReady({ providerId: 'test', modelIdentity: 'm' }, async () => {
      executions += 1;
      return { success: true, state: 'ready' };
    });
    assert.deepEqual(await Promise.all([first, second]), [{ success: true, state: 'ready' }, { success: true, state: 'ready' }]);
    assert.equal(executions, 1);
  });

  it('keeps the legacy model-switch result unchanged while serializing the mutation', async () => {
    const { value } = coordinator();
    const result = await value.switchModel({ filename: 'model.gguf' }, async () => ({ success: true, restarted: false }));
    assert.deepEqual(result, { success: true, restarted: false });
    assert.equal(value.getServerStatus(), false);
    assert.equal(value.snapshot().compatibility.activeModel, 'model.gguf');
  });

  it('exposes coordinator-backed legacy aliases and a normalized snapshot', async () => {
    const { value, calls } = coordinator();
    assert.equal(value.getServerStatus(), false);
    assert.equal(await value.startServer(), true);
    assert.equal(value.getServerStatus(), true);
    assert.equal(value.getRuntimeSnapshot().runtime.state, 'ready');
    assert.equal(await value.stopServer(), true);
    assert.equal(value.getServerStatus(), false);
    assert.deepEqual(calls, ['start', 'stop']);
  });

  it('invokes provider readiness and records provider/model identity', async () => {
    const providerCalls = [];
    const provider = {
      descriptor: () => ({ id: 'test-provider', origin: 'loopback', capabilities: ['readiness'] }),
      ensureReady: async (model) => {
        providerCalls.push(model.id);
        return { success: true, providerId: 'test-provider', modelId: model.id, state: 'ready', digest: 'sha256:test' };
      }
    };
    const { value } = coordinator({ localProvider: provider, registerLocalProvider: false });
    const result = await value.ensureReady({ providerId: 'test-provider', modelId: 'model.gguf' });
    assert.equal(result.success, true);
    assert.deepEqual(providerCalls, ['model.gguf']);
    assert.deepEqual(value.snapshot().runtime.provider, 'test-provider');
    assert.equal(value.snapshot().runtime.model.id, 'model.gguf');
  });

  it('tracks readiness as busy and returns to ready without changing identity on provider failure', async () => {
    let release;
    const provider = {
      descriptor: () => ({ id: 'test-provider', origin: 'loopback', capabilities: ['readiness'] }),
      ensureReady: () => new Promise((resolve) => { release = resolve; })
    };
    const { value } = coordinator({ localProvider: provider, registerLocalProvider: false });
    const pending = value.ensureReady({ providerId: 'test-provider', modelId: 'model.gguf' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(value.snapshot().runtime.state, 'busy');
    release({ success: false, error: { code: 'MODEL_LOAD_FAILED' } });
    const result = await pending;
    assert.equal(result.success, false);
    assert.equal(value.snapshot().runtime.state, 'ready');
    assert.equal(value.snapshot().compatibility.activeModel, null);
  });

  it('does not commit a model switch superseded by stop', async () => {
    let release;
    const { value } = coordinator();
    await value.start();
    const switching = value.switchModel({ filename: 'next.gguf' }, () => new Promise((resolve) => { release = resolve; }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(value.snapshot().runtime.state, 'busy');
    const stopping = value.stop();
    release({ success: true });
    const result = await switching;
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'REPLACEMENT');
    await stopping;
    assert.equal(value.snapshot().runtime.state, 'idle');
    assert.equal(value.snapshot().compatibility.activeModel, null);
  });

  it('prevents a replaced startup from committing ready after stop', async () => {
    let release;
    const { value } = coordinator({
      lifecycle: {
        start: () => new Promise((resolve) => { release = resolve; }),
        stop: async () => true
      }
    });
    const starting = value.start();
    await new Promise((resolve) => setImmediate(resolve));
    const stopping = value.stop();
    release(true);
    assert.equal(await starting, false);
    assert.equal(await stopping, true);
    assert.equal(value.snapshot().runtime.state, 'idle');
  });
});


describe('RuntimeCoordinator scheduling integration', () => {
  it('exposes scheduler, keyed circuits, and model resources in additive status', () => {
    const { value } = coordinator({ maxActive: 1, maxQueued: 2 });
    const status = value.getSchedulerStatus();
    assert.equal(status.scheduler.capacity, 1);
    assert.deepEqual(status.circuits, []);
    assert.equal(status.resources.loaded, 0);
    assert.equal(value.snapshot().scheduler.capacity, 1);
  });

  it('runs a logical operation through admission, circuit, and resource ownership', async () => {
    const { value } = coordinator({
      circuitBreakerOptions: { threshold: 2 },
      idleUnloadMs: 0
    });
    const result = await value.executeScheduled(
      { providerId: 'provider-a', modelIdentity: 'model-a' },
      async ({ id, signal, attempt }) => {
        assert.ok(id);
        assert.equal(attempt, 0);
        return { success: true, state: 'ready' };
      },
      { operationCategory: 'chat', id: 'chat-1' }
    );
    assert.deepEqual(result, { success: true, state: 'ready' });
    assert.equal(value.getSchedulerStatus().scheduler.completed, 1);
    assert.equal(value.getSchedulerStatus().circuits[0].state, 'CLOSED');
    assert.deepEqual(value.getSchedulerStatus().resources.resources.map((entry) => entry.modelId), ['model-a']);
  });

  it('performs exactly one OOM recovery retry inside one admission', async () => {
    const { value } = coordinator({ idleUnloadMs: 0 });
    value.resources.markLoaded({ id: 'stale', providerId: 'provider-a' }, { bytes: 10 });
    let attempts = 0;
    const result = await value.executeScheduled(
      { providerId: 'provider-a', modelIdentity: 'model-a' },
      async ({ attempt, recovery }) => {
        attempts++;
        if (attempt === 0) throw Object.assign(new Error('CUDA out of memory'), { code: 'CUDA_OUT_OF_MEMORY' });
        assert.equal(recovery, true);
        return 'recovered';
      },
      { operationCategory: 'chat', id: 'oom-1' }
    );
    assert.equal(attempts, 2);
    assert.equal(result.value, 'recovered');
    assert.equal(result.recovery.success, true);
    assert.equal(value.getSchedulerStatus().scheduler.completed, 1);
    assert.equal(value.resources.getSnapshot().resources.some((entry) => entry.modelId === 'stale'), false);
  });

  it('rejects a scheduled operation after its keyed circuit opens', async () => {
    const { value } = coordinator({ circuitBreakerOptions: { threshold: 1, resetMs: 10000 } });
    const fail = () => value.executeScheduled(
      { providerId: 'provider-a', modelIdentity: 'model-a' },
      async () => { throw new Error('backend unavailable'); },
      { operationCategory: 'chat' }
    );
    await assert.rejects(fail, /backend unavailable/);
    await assert.rejects(fail, (error) => error.code === 'CIRCUIT_OPEN');
    const state = value.getSchedulerStatus().circuits.find((entry) => entry.providerId === 'provider-a');
    assert.equal(state.state, 'OPEN');
    assert.equal(state.failureCount, 1);
  });
});


describe('RuntimeCoordinator Phase 1 rollback integration', () => {
  it('shares the supplied gate, invalidates optional work, and preserves local providers', () => {
    const gates = new FeatureGates({ phase1ExitCriteriaPassed: true, phase2RemoteProviders: true });
    const local = { descriptor: () => ({ id: 'local-llama-server', origin: 'loopback', capabilities: ['readiness'] }) };
    const remote = { descriptor: () => ({ id: 'remote', origin: 'https://provider.example', capabilities: ['readiness'] }) };
    const { value } = coordinator({ featureGates: gates, localProvider: local, registerLocalProvider: false });
    value.registerProvider(remote, { remote: true });
    assert.equal(value.featureGates, gates);
    assert.equal(value.providerStatus('local-llama-server').status, 'available');
    const rollback = value.rollbackOptionalRuntime('phase1-check-failed');
    assert.equal(rollback.reason, 'phase1-check-failed');
    assert.equal(value.providerStatus('local-llama-server').status, 'available');
    assert.equal(value.providerStatus('remote').status, 'disabled');
    assert.equal(value.snapshot().featureGates.phase1ExitCriteriaPassed, false);
  });
});
