/* eslint-env node */
const { RuntimeStateMachine } = require('./runtime-state-machine');
const { EnsureReadyRegistry, normalizeIdentity } = require('./ensure-ready-registry');
const { ManagedProcess } = require('./managed-process');
const { ProviderRegistry } = require('../providers/provider-registry');
const { LlamaServerProvider } = require('../providers/llama-server-provider');
const { ModelCatalog } = require('../catalog/model-catalog');
const { AdmissionScheduler } = require('../scheduling/admission-scheduler');
const { CircuitBreaker } = require('../scheduling/circuit-breaker');
const { ModelResourceManager } = require('../scheduling/model-resource-manager');
const { executeWithControlledOomRecovery } = require('../scheduling/controlled-oom-recovery');
const { ERROR_CODES, createSafeError, errorEnvelope } = require('./error-contract');

/**
 * Owns the mutable runtime lifecycle, active model identity, and readiness
 * operations. Legacy main-process work is supplied as lifecycle/model-switch
 * callbacks so its established launch and IPC contracts remain unchanged.
 */
class RuntimeCoordinator {
  constructor(options = {}) {
    this.lifecycle = options.lifecycle || {};
    this.featureGates = options.featureGates || this.providers?.featureGates;
    this.stateMachine = options.stateMachine || new RuntimeStateMachine({ onDiagnostic: options.onDiagnostic });
    this.process = options.process || new ManagedProcess({
      binaryManager: options.binaryManager, app: options.app, capabilities: options.capabilities,
      spawnImpl: options.spawnImpl, fetchImpl: options.fetch
    });
    this.providers = options.providers || new ProviderRegistry({ featureGates: this.featureGates || options.featureGates, onDiagnostic: options.onDiagnostic });
    this.featureGates = this.featureGates || this.providers.featureGates;
    if (options.localProvider) this.providers.register(options.localProvider);
    else if (options.registerLocalProvider !== false && typeof (options.fetch || globalThis.fetch) === 'function') {
      this.providers.register(new LlamaServerProvider({
        providerId: 'local-llama-server', baseUrl: options.baseUrl || 'http://127.0.0.1:13434',
        fetch: options.fetch || globalThis.fetch
      }));
    }
    this.catalog = options.catalog || new ModelCatalog();
    this.scheduler = options.scheduler || new AdmissionScheduler({
      maxActive: options.maxActive ?? options.maxConcurrent ?? 1,
      maxQueued: options.maxQueued ?? options.queueLimit
    });
    this.circuitBreaker = options.circuitBreaker || new CircuitBreaker(options.circuitBreakerOptions || {});
    this.resources = options.resources || options.resourceManager || new ModelResourceManager({
      idleMs: options.idleUnloadMs,
      maxResources: options.maxResources,
      maxBytes: options.maxResourceBytes,
      unload: options.unloadResource
    });
    this._catalogProvider = options.catalogProvider;
    this._startPromise = null;
    this._stopPromise = null;
    this._activeModel = null;
    this._activeProvider = null;
    this._operation = null;
    this._switching = false;
    this.phase1Evaluator = options.phase1Evaluator || null;
    this._rollbackState = null;
    this.readiness = options.readiness || new EnsureReadyRegistry({
      executor: async (request, context) => this._ensureReady(request, context),
      onDiagnostic: options.onDiagnostic
    });
  }

  registerProvider(provider, options) { return this.providers.register(provider, options); }
  providerStatus(providerId) { return this.providers.status(providerId); }
  providerStatuses() { return this.providers.projectStatus(); }

  snapshot() {
    const runtime = this.stateMachine.snapshot();
    const active = this.readiness.active;
    return {
      runtime: {
        ...runtime,
        ...(this._activeProvider ? { provider: this._activeProvider } : {}),
        ...(this._activeModel ? { model: this._activeModel } : {}),
        ...(this._operation ? { operation: { ...this._operation } } : {})
      },
      process: this.process.status(),
      providers: this.providerStatuses(),
      scheduler: this.scheduler.getStatus(),
      circuits: this.circuitBreaker.getStatus(),
      resources: this.resources.getStatus(),
      readiness: {
        active,
        pending: this.readiness.pendingCount,
        ...(active ? { operation: active } : {})
      },
      compatibility: {
        serverRunning: this.isRunning(),
        switching: this._switching,
        activeModel: this._activeModel?.id || this._activeModel?.identity || null
      },
      featureGates: this.featureGates?.snapshot ? this.featureGates.snapshot() : null,
      phase1Evaluation: this.phase1Evaluator?.lastReport?.() || null,
      rollback: this._rollbackState ? { ...this._rollbackState } : null
    };
  }

  getRuntimeSnapshot() { return this.snapshot(); }
  getFeatureGates() {
    return {
      flags: this.featureGates?.snapshot ? this.featureGates.snapshot() : {},
      evaluation: this.phase1Evaluator?.snapshot ? this.phase1Evaluator.snapshot() : null,
      rollback: this.featureGates?.rollbackState ? this.featureGates.rollbackState() : null
    };
  }
  async evaluatePhase1(context = {}) {
    if (!this.phase1Evaluator) throw new Error('Phase 1 evaluator is not configured');
    const report = await this.phase1Evaluator.evaluate({ ...context, runtime: this.snapshot(), providers: this.providerStatuses() });
    if (!report.passed) this.rollbackOptionalRuntime('phase1-check-failed');
    return report;
  }
  rollbackOptionalRuntime(reason = 'phase1-failed') {
    if (this.featureGates?.phase1Passed?.()) this.featureGates.rollback(reason);
    const epoch = this.stateMachine.beginOperation();
    this.readiness.cancelAll({ reason });
    this.scheduler.replace();
    this._rollbackState = { reason: String(reason).slice(0, 160), epoch, at: new Date().toISOString() };
    return {
      ...this._rollbackState,
      localProviders: this.providerStatuses().filter((provider) => provider.origin === 'loopback' || provider.origin === 'local')
    };
  }
  isRunning() { return ['ready', 'busy'].includes(this.stateMachine.state) || this.process.running === true; }
  getServerStatus() { return this.isRunning(); }

  async start(options = {}) {
    if (this.stateMachine.state === 'ready' || this.stateMachine.state === 'busy') return true;
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._start(options).finally(() => { this._startPromise = null; });
    return this._startPromise;
  }

  async _start(options) {
    const epoch = this.stateMachine.beginOperation();
    if (this.stateMachine.state !== 'acquiring') {
      const acquired = this.stateMachine.transition('acquiring', { reasonCode: 'start-requested', epoch });
      if (!acquired.accepted) throw this._transitionError(acquired);
    }
    const starting = this.stateMachine.transition('starting', { reasonCode: 'acquire-complete', epoch });
    if (!starting.accepted) throw this._transitionError(starting);
    this._operation = { type: 'start', correlationId: starting.reason.correlationId, epoch };
    try {
      const started = await this._call('start', options);
      if (!this.stateMachine.isCurrentEpoch(epoch)) return false;
      if (!started) {
        this.stateMachine.transition('failed', { reasonCode: 'start-failed', epoch });
        return false;
      }
      // If a readiness check is supplied, verify model health before
      // transitioning to 'ready'. This ensures 'ready' means the model is
      // actually loaded and serving, not just that the process spawned.
      if (typeof this.lifecycle.readinessCheck === 'function') {
        await this.lifecycle.readinessCheck(options);
      }
      this.stateMachine.transition('ready', { reasonCode: 'server-ready', epoch });
      return true;
    } catch (error) {
      if (this.stateMachine.isCurrentEpoch(epoch)) this.stateMachine.transition('failed', { reasonCode: 'start-error', epoch });
      throw error;
    } finally {
      if (this._operation?.epoch === epoch) this._operation = null;
    }
  }

  async stop(options = {}) {
    if (this._stopPromise) return this._stopPromise;
    this._stopPromise = this._stop(options).finally(() => { this._stopPromise = null; });
    return this._stopPromise;
  }

  async _stop(options) {
    const previous = this.stateMachine.state;
    const epoch = this.stateMachine.beginOperation();
    this.scheduler.replace();
    // starting/acquiring cannot transition directly to stopping. Mark the
    // superseded operation failed before entering the terminal stop path.
    if (previous === 'acquiring' || previous === 'starting') {
      this.stateMachine.transition('failed', { reasonCode: 'start-replaced-by-stop' });
      this.stateMachine.transition('idle', { reasonCode: 'stop-requested-before-ready' });
    }
    // Busy work must pass through the public cancellation state before stop;
    // otherwise a stop request would be rejected and leave the runtime busy.
    if (this.stateMachine.state === 'busy') {
      const cancelling = this.stateMachine.transition('cancelling', { reasonCode: 'stop-requested-during-operation', epoch });
      if (!cancelling.accepted) throw this._transitionError(cancelling);
      const cancelled = this.stateMachine.transition('ready', { reasonCode: 'operation-cancelled-for-stop', epoch });
      if (!cancelled.accepted) throw this._transitionError(cancelled);
    }
    if (this.stateMachine.state !== 'idle' && this.stateMachine.state !== 'stopping') {
      const stopping = this.stateMachine.transition('stopping', { reasonCode: 'stop-requested', epoch });
      if (!stopping.accepted) throw this._transitionError(stopping);
    }
    await this._call('stop', options);
    this.scheduler.reset();
    if (this.stateMachine.state === 'stopping' && this.stateMachine.isCurrentEpoch(epoch)) {
      this.stateMachine.transition('idle', { reasonCode: 'server-stopped', epoch });
    } else if (this.stateMachine.state === 'failed') {
      this.stateMachine.transition('idle', { reasonCode: 'server-stopped-after-failure' });
    }
    if (this._activeModel) {
      try { this.resources.setSelected(this._activeModel, false); } catch (_) { /* resource may have been evicted */ }
    }
    this._activeModel = null;
    this._activeProvider = null;
    this._operation = null;
    return true;
  }

  stopServer(options) { return this.stop(options); }
  startServer(options) { return this.start(options); }

  ensureReady(request = {}, options = {}) {
    const input = { ...request, providerId: request.providerId || 'local-llama-server', modelIdentity: request.modelIdentity || request.modelId || request.model };
    return this.readiness.ensureReady(input, undefined, options);
  }

  cancelOperation(request, callerId) { return this.readiness.cancel(request, callerId); }

  async switchModel(request, operation) {
    if (typeof operation !== 'function') throw new TypeError('A compatibility model-switch operation is required');
    const input = { ...(request || {}), providerId: request?.providerId || 'local-llama-server', local: true, modelIdentity: request?.modelIdentity || request?.filename };
    return this.readiness.runMutation(input, async (context) => {
      this._switching = true;
      const epoch = this.stateMachine.beginOperation();
      const enteredBusy = this._enterBusy(epoch, 'model-switch-requested', context.correlationId);
      this._operation = { type: 'switch-model', correlationId: context.correlationId, epoch, model: input.modelIdentity };
      try {
        const result = await this.executeScheduled(input, async (scheduledContext) => {
          return operation({ ...context, ...scheduledContext, epoch });
        }, {
          operationCategory: 'model-load', signal: context.signal, id: context.correlationId,
          resource: { ...(input.resource || {}), modelId: input.modelIdentity }
        });
        if (!this.stateMachine.isCurrentEpoch(epoch)) {
          return errorEnvelope(createSafeError({
            code: ERROR_CODES.REPLACEMENT,
            message: 'The model switch was superseded by a newer runtime operation.',
            retryable: true,
            recoveryAction: 'Retry model switch',
            correlationId: context.correlationId
          }));
        }
        if (result?.success !== false) {
          this._activeProvider = input.providerId;
          this._activeModel = { id: input.modelIdentity, identity: input.modelIdentity };
          this.resources.markLoaded(this._activeModel, input.resource || {}, { selected: true });
        }
        return result;
      } finally {
        if (enteredBusy && this.stateMachine.isCurrentEpoch(epoch) && this.stateMachine.state === 'busy') {
          this.stateMachine.transition('ready', { reasonCode: 'model-switch-complete', correlationId: context.correlationId, epoch });
        }
        this._switching = false;
        if (this._operation?.epoch === epoch) this._operation = null;
      }
    });
  }

  /**
   * Runs provider/model work through the shared admission, keyed circuit, and
   * resource ownership layers. OOM recovery remains one logical admission.
   */
  executeScheduled(request, operation, options = {}) {
    if (typeof operation !== 'function') throw new TypeError('A scheduled operation is required');
    const providerId = String(request?.providerId || 'local-llama-server');
    const category = options.operationCategory || 'model-load';
    const model = request?.model || {
      id: request?.modelIdentity || request?.modelId || request?.model
    };
    const resource = options.resource || request?.resource || {};
    const protect = options.protectResource !== false;
    const admissionOptions = { signal: options.signal, id: options.id || options.correlationId };
    const run = async (context) => {
      const permit = this.circuitBreaker.acquire(providerId, category, context.id);
      const token = protect ? this.resources.acquireEnsureReady(model, { resource }) : null;
      const recover = options.recover || (options.recoverOom === false ? undefined : async () => {
        this.resources.unloadIdle({ reason: 'oom-recovery' });
        if (options.requiredBytes !== undefined) this.resources.evictForCapacity({ bytes: options.requiredBytes }, { reason: 'oom-recovery' });
      });
      try {
        const result = await executeWithControlledOomRecovery(
          (attemptContext) => operation({ ...context, ...attemptContext, providerId, operationCategory: category }),
          { id: context.id, signal: context.signal, recover }
        );
        this.circuitBreaker.recordOutcome(providerId, category, result, permit);
        return result;
      } catch (error) {
        this.circuitBreaker.recordFailure(providerId, category, error, permit);
        throw error;
      } finally {
        if (token) token.release();
      }
    };
    return this.scheduler.enqueue(run, admissionOptions);
  }

  getSchedulerStatus() {
    return {
      scheduler: this.scheduler.getStatus(),
      circuits: this.circuitBreaker.getStatus(),
      resources: this.resources.getStatus()
    };
  }

  async _ensureReady(request, context) {
    const started = await this.start({ signal: context.signal });
    if (!started) return errorEnvelope(createSafeError({ code: 'RUNTIME_START_FAILED', message: 'The local runtime could not be started.', retryable: true, recoveryAction: 'Retry start', correlationId: context.correlationId }));
    const epoch = this.stateMachine.operationEpoch;
    const enteredBusy = this._enterBusy(epoch, 'ensure-ready-requested', context.correlationId);
    this._operation = { type: 'ensure-ready', correlationId: context.correlationId, epoch, provider: request.providerId, model: request.modelIdentity };
    try {
      const provider = this.providers.get(request.providerId);
      let result = { success: true, providerId: request.providerId, modelId: request.modelIdentity, state: 'ready', correlationId: context.correlationId };
      if (provider && typeof provider.ensureReady === 'function') {
        result = await this.executeScheduled(request, async (scheduledContext) => {
          return this.providers.invoke(request.providerId, 'ensureReady', [{ id: request.modelIdentity, providerId: request.providerId }], {
            capability: 'readiness', signal: scheduledContext.signal, correlationId: scheduledContext.id
          });
        }, {
          operationCategory: 'model-load', signal: context.signal, id: context.correlationId,
          resource: { ...(request.resource || {}), modelId: request.modelIdentity }
        });
        if (result?.success === false) return result;
      }
      if (!this.stateMachine.isCurrentEpoch(epoch)) {
        return errorEnvelope(createSafeError({
          code: ERROR_CODES.REPLACEMENT,
          message: 'Readiness was superseded by a newer runtime operation.',
          retryable: true,
          recoveryAction: 'Retry readiness',
          correlationId: context.correlationId
        }));
      }
      this._activeProvider = request.providerId;
      this._activeModel = { id: request.modelIdentity, identity: request.modelIdentity };
      this.resources.markLoaded(this._activeModel, request.resource || {} , { selected: true });
      return { ...result, providerId: result.providerId || request.providerId, modelId: result.modelId || request.modelIdentity, state: result.state || 'ready', correlationId: result.correlationId || context.correlationId };
    } finally {
      if (enteredBusy && this.stateMachine.isCurrentEpoch(epoch) && this.stateMachine.state === 'busy') {
        this.stateMachine.transition('ready', { reasonCode: 'ensure-ready-complete', correlationId: context.correlationId, epoch });
      }
      if (this._operation?.epoch === epoch) this._operation = null;
    }
  }

  _enterBusy(epoch, reasonCode, correlationId) {
    if (this.stateMachine.state !== 'ready') return false;
    const result = this.stateMachine.transition('busy', { reasonCode, correlationId, epoch, cancellable: true });
    if (!result.accepted) throw this._transitionError(result);
    return true;
  }

  async _call(name, options) {
    const operation = this.lifecycle[name];
    if (typeof operation !== 'function') throw new TypeError(`Runtime lifecycle operation is not configured: ${name}`);
    return operation(options);
  }

  _transitionError(result) {
    const error = new Error(result.error?.message || 'Runtime transition failed');
    Object.assign(error, result.error || {});
    return error;
  }

  async getCatalogSnapshot(options = {}) {
    if (typeof this._catalogProvider === 'function') this.catalog.merge({ local: { records: await this._catalogProvider(options) } }, options);
    return this.catalog.getSnapshot();
  }
}

function createRuntimeCoordinator(options) { return new RuntimeCoordinator(options); }
module.exports = { RuntimeCoordinator, createRuntimeCoordinator };
