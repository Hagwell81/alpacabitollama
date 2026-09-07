/* eslint-env node */
const { createCorrelationId, createSafeError, ERROR_CODES } = require('./error-contract');

const DEFAULT_LOCAL_PROVIDER_IDS = Object.freeze(['local', 'llama-server', 'llama_server']);

function valueOf(input, names) {
  for (const name of names) {
    if (input?.[name] !== undefined && input[name] !== null && input[name] !== '') return input[name];
  }
  return undefined;
}

function normalizeIdentity(request) {
  const model = request?.model && typeof request.model === 'object' ? request.model : {};
  const providerId = valueOf(request, ['providerId', 'provider']) ?? valueOf(model, ['providerId']);
  const modelIdentity = valueOf(request, ['modelIdentity', 'modelId', 'digest', 'modelDigest', 'reference'])
    ?? valueOf(model, ['identity', 'id', 'digest', 'reference']);
  if (!providerId) throw new TypeError('EnsureReady requires a provider identity');
  if (!modelIdentity) throw new TypeError('EnsureReady requires a model identity');
  return { providerId: String(providerId), modelIdentity: String(modelIdentity) };
}

function readinessKey({ providerId, modelIdentity }) {
  return `${JSON.stringify(String(providerId))}:${JSON.stringify(String(modelIdentity))}`;
}

function localServerKey(request, providerId) {
  const explicit = valueOf(request, ['localServerId', 'serverId']);
  return explicit === undefined ? String(providerId) : String(explicit);
}

function isAbortError(error) {
  return Boolean(error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'));
}

function callerCancelled(correlationId) {
  return createSafeError({
    code: ERROR_CODES.CALLER_CANCELLED,
    message: 'The readiness request was cancelled.',
    retryable: true,
    recoveryAction: 'Retry readiness',
    correlationId
  });
}

/**
 * Coalesces readiness requests and serializes model-load mutations.
 *
 * The registry deliberately owns no process or provider details. The executor
 * receives the request and a context containing the shared AbortSignal. This
 * keeps cancellation scoped to a caller while allowing the shared operation to
 * be cancelled once its last caller detaches.
 */
class EnsureReadyRegistry {
  constructor({
    executor,
    ensureReady,
    readiness,
    onDiagnostic,
    diagnostics,
    isCancellable,
    localProviderIds = DEFAULT_LOCAL_PROVIDER_IDS,
    maxPending = Infinity,
    now = () => Date.now()
  } = {}) {
    this.executor = executor || ensureReady || readiness;
    this.onDiagnostic = onDiagnostic || diagnostics;
    this.isCancellable = isCancellable;
    this.localProviderIds = new Set(localProviderIds.map(String));
    this.maxPending = Number.isFinite(Number(maxPending)) ? Math.max(0, Math.floor(Number(maxPending))) : Infinity;
    this.now = now;
    this._operations = new Map();
    this._queue = [];
    this._active = null;
    this._sequence = 0;
    this._draining = false;
  }

  get size() { return this._operations.size; }
  get active() { return this._active ? this._publicOperation(this._active) : null; }
  get pendingCount() { return this._queue.length; }
  get queuedCount() { return this._queue.length; }
  get activeOperation() { return this.active; }

  /** Join or create a shared readiness operation for one provider/model pair. */
  ensureReady(request, executor, options = {}) {
    const input = request && typeof request === 'object' ? request : {};
    const identity = normalizeIdentity(input);
    const key = readinessKey(identity);
    const operation = this._operations.get(key);
    const run = executor || input.executor || input.operation || input.run || this.executor;
    if (typeof run !== 'function') throw new TypeError('EnsureReady requires an executor');

    if (operation) return this._attachCaller(operation, input.signal, options);
    if (this._queue.length >= this.maxPending) {
      return Promise.reject(createSafeError({
        code: ERROR_CODES.CAPACITY,
        message: 'The readiness queue is full.',
        retryable: true,
        recoveryAction: 'Retry readiness',
        details: { pending: this._queue.length }
      }));
    }
    if (input.signal?.aborted) return Promise.reject(callerCancelled(createCorrelationId('ensure-ready')));

    const correlationId = valueOf(input, ['correlationId']) || createCorrelationId('ensure-ready');
    const sharedController = new AbortController();
    const operationRecord = {
      id: correlationId,
      key,
      providerId: identity.providerId,
      modelIdentity: identity.modelIdentity,
      request: { ...input, providerId: identity.providerId, modelIdentity: identity.modelIdentity },
      run,
      controller: sharedController,
      callers: new Map(),
      sequence: ++this._sequence,
      enqueuedAt: this.now(),
      state: 'queued',
      cancellable: options.cancellable !== false && input.cancellable !== false,
      serverKey: this._serverKey(input, identity.providerId),
      promise: null,
      result: undefined,
      error: undefined
    };
    operationRecord.promise = this._execute(operationRecord);
    // A fully detached operation still has to drain and settle without an
    // unhandled rejection. Individual callers receive the original outcome.
    operationRecord.promise.catch(() => {});
    this._operations.set(key, operationRecord);
    this._queue.push(operationRecord);
    this._drain();
    return this._attachCaller(operationRecord, input.signal, options);
  }

  request(request, executor, options) { return this.ensureReady(request, executor, options); }
  join(request, executor, options) { return this.ensureReady(request, executor, options); }

  /** Detach one caller by its caller id, if the caller supplied one. */
  cancel(requestId, callerId) {
    const identity = normalizeIdentity(requestId);
    const operation = this._operations.get(readinessKey(identity));
    if (!operation) return false;
    const caller = callerId ? operation.callers.get(String(callerId)) : operation.callers.values().next().value;
    if (!caller) return false;
    this._detachCaller(operation, caller, callerCancelled(caller.correlationId));
    return true;
  }

  /** Cancel all callers without cancelling shared work until it is safe. */
  cancelAll({ reason = 'registry-shutdown' } = {}) {
    for (const operation of this._operations.values()) {
      for (const caller of [...operation.callers.values()]) {
        this._detachCaller(operation, caller, createSafeError({
          code: ERROR_CODES.SHUTDOWN,
          message: 'The readiness request was cancelled because runtime work stopped.',
          retryable: true,
          recoveryAction: 'Retry readiness',
          details: { reason },
          correlationId: caller.correlationId
        }));
      }
    }
  }

  /** Public seam for callers that need to serialize another model mutation. */
  runMutation(request, task, options = {}) {
    if (!request || typeof request !== 'object') throw new TypeError('Mutation request is required');
    if (typeof task !== 'function') throw new TypeError('Mutation task is required');
    const identity = normalizeIdentity(request);
    const operation = {
      id: valueOf(request, ['correlationId']) || createCorrelationId('mutation'),
      key: `mutation:${readinessKey(identity)}:${++this._sequence}`,
      providerId: identity.providerId,
      modelIdentity: identity.modelIdentity,
      request,
      run: (_request, context) => task(context),
      controller: new AbortController(),
      callers: new Map(),
      sequence: this._sequence,
      enqueuedAt: this.now(),
      state: 'queued',
      cancellable: options.cancellable !== false,
      serverKey: this._serverKey(request, identity.providerId),
      promise: null,
      result: undefined,
      error: undefined,
      internal: true
    };
    operation.promise = this._execute(operation);
    operation.promise.catch(() => {});
    this._queue.push(operation);
    this._drain();
    return operation.promise;
  }

  _serverKey(request, providerId) {
    const explicitLocal = request.local === true || request.isLocal === true || request.providerType === 'local';
    if (!explicitLocal && !this.localProviderIds.has(String(providerId)) && request.localServerId === undefined && request.serverId === undefined) return null;
    return localServerKey(request, providerId);
  }

  _attachCaller(operation, signal, options) {
    if (operation.internal) return operation.promise;
    const callerId = String(options.callerId || createCorrelationId('caller'));
    const correlationId = String(options.correlationId || callerId);
    return new Promise((resolve, reject) => {
      const caller = { id: callerId, correlationId, resolve, reject, signal, listener: null };
      operation.callers.set(callerId, caller);
      caller.listener = () => this._detachCaller(operation, caller, callerCancelled(correlationId));
      if (signal) {
        if (signal.aborted) return caller.listener();
        signal.addEventListener('abort', caller.listener, { once: true });
      }
      operation.promise.then(
        (result) => {
          if (!operation.callers.has(callerId)) return;
          this._removeCaller(operation, caller);
          resolve(result);
        },
        (error) => {
          if (!operation.callers.has(callerId)) return;
          this._removeCaller(operation, caller);
          reject(error);
        }
      );
    });
  }

  _detachCaller(operation, caller, error) {
    if (!operation.callers.has(caller.id)) return;
    this._removeCaller(operation, caller);
    caller.reject(error);
    if (operation.callers.size === 0 && operation.state !== 'settled' && this._canCancel(operation)) {
      operation.controller.abort();
      operation.cancelledAt = this.now();
    }
  }

  _removeCaller(operation, caller) {
    operation.callers.delete(caller.id);
    if (caller.signal && caller.listener) caller.signal.removeEventListener('abort', caller.listener);
  }

  _canCancel(operation) {
    if (!operation.cancellable) return false;
    if (typeof this.isCancellable === 'function') return Boolean(this.isCancellable(this._publicOperation(operation)));
    return true;
  }

  _publicOperation(operation) {
    return {
      id: operation.id,
      key: operation.key,
      providerId: operation.providerId,
      modelIdentity: operation.modelIdentity,
      state: operation.state,
      sequence: operation.sequence,
      cancellable: operation.cancellable,
      callerCount: operation.callers.size,
      serverKey: operation.serverKey
    };
  }

  async _execute(operation) {
    await new Promise((resolve) => queueMicrotask(resolve));
    while (this._active !== operation || this._queue[0] !== operation) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (operation.callers && operation.callers.size === 0 && !operation.internal) {
      operation.state = 'settled';
      operation.result = undefined;
      this._finish(operation);
      return undefined;
    }
    operation.state = 'running';
    try {
      const context = {
        signal: operation.controller.signal,
        operationId: operation.id,
        correlationId: operation.id,
        providerId: operation.providerId,
        modelIdentity: operation.modelIdentity,
        serverKey: operation.serverKey,
        get cancellable() { return operation.cancellable; },
        setCancellable: (value) => { operation.cancellable = Boolean(value); }
      };
      operation.result = await operation.run(operation.request, context);
      operation.state = 'settled';
      return operation.result;
    } catch (error) {
      operation.error = error;
      operation.state = 'settled';
      if (operation.controller.signal.aborted && isAbortError(error)) {
        operation.error = createSafeError({
          code: ERROR_CODES.CALLER_CANCELLED,
          message: 'The shared readiness operation was cancelled after its callers detached.',
          retryable: true,
          recoveryAction: 'Retry readiness',
          correlationId: operation.id
        });
      }
      throw operation.error;
    } finally {
      this._finish(operation);
    }
  }

  _finish(operation) {
    if (this._operations.get(operation.key) === operation) this._operations.delete(operation.key);
    if (this._active === operation) this._active = null;
    if (this._queue[0] === operation) this._queue.shift();
    else {
      const index = this._queue.indexOf(operation);
      if (index >= 0) this._queue.splice(index, 1);
    }
    this._drain();
  }

  _drain() {
    if (this._draining || this._active || this._queue.length === 0) return;
    this._draining = true;
    try {
      this._active = this._queue[0];
      this._active.state = 'starting';
    } finally {
      this._draining = false;
    }
  }
}

module.exports = {
  DEFAULT_LOCAL_PROVIDER_IDS,
  EnsureReadyRegistry,
  normalizeIdentity,
  readinessKey
};
