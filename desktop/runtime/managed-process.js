/* eslint-env node */
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const { createCorrelationId, createSafeError } = require('./error-contract');

const DEFAULTS = Object.freeze({
  healthIntervalMs: 250,
  healthTimeoutMs: 10_000,
  terminationTimeoutMs: 2_000,
  maxOutputBytes: 64 * 1024
});

function token() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function appendBounded(current, value, limit) {
  const next = current + String(value);
  return next.length <= limit ? next : next.slice(next.length - limit);
}

/**
 * Classify an exit without exposing child-process internals to the renderer.
 * `expected` is set before a deliberate graceful stop; `forced` is set when
 * the escalation timer has to kill the child.
 */
function classifyExit({ code = null, signal = null, expected = false, forced = false, spawnError = false } = {}) {
  if (spawnError) return 'spawn-error';
  if (forced) return 'forced';
  if (expected) return 'expected';
  if (signal) return 'signal';
  if (code === 0) return 'clean';
  return 'crash';
}

function isCuratedSelection(selection) {
  if (!selection || typeof selection !== 'object') return false;
  if (typeof selection.exePath !== 'string' || typeof selection.backendDir !== 'string') return false;
  if (typeof selection.backend !== 'string' || typeof selection.tag !== 'string') return false;
  const executable = path.basename(selection.exePath);
  return executable === (process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
}

function validateCuratedSelection(selection) {
  if (!isCuratedSelection(selection)) {
    throw new TypeError('ManagedProcess requires a curated binary-manager selection');
  }
  const executable = path.resolve(selection.exePath);
  const directory = path.resolve(selection.backendDir);
  const relative = path.relative(directory, executable);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new TypeError('Curated executable must be inside its backend directory');
  }
  return Object.freeze({ ...selection, exePath: executable, backendDir: directory });
}

async function defaultHealthCheck(url, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation is available for health polling');
  const response = await fetchImpl(url, { method: 'GET', signal });
  if (!response || response.ok === false) {
    throw new Error(`Health check returned HTTP ${response?.status || 'unknown'}`);
  }
  return response;
}

class ManagedProcess {
  constructor({
    binaryManager,
    app,
    capabilities,
    spawnImpl = childProcess.spawn,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    options = {},
    onOutput,
    onExit
  } = {}) {
    this.binaryManager = binaryManager;
    this.app = app;
    this.capabilities = capabilities;
    this.spawnImpl = spawnImpl;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.setTimeout = setTimeoutImpl;
    this.clearTimeout = clearTimeoutImpl;
    this.options = { ...DEFAULTS, ...options };
    this.onOutput = onOutput;
    this.onExit = onExit;
    this._record = null;
  }

  async selectExecutable({ app = this.app, capabilities = this.capabilities } = {}) {
    if (!this.binaryManager || typeof this.binaryManager.ensureBackend !== 'function') {
      throw new TypeError('A binary manager is required for curated executable selection');
    }
    const selection = await this.binaryManager.ensureBackend(app, capabilities);
    return validateCuratedSelection(selection);
  }

  get running() { return Boolean(this._record && this._record.child); }

  status() {
    if (!this._record) return { running: false };
    const { child, ...record } = this._record;
    return {
      running: Boolean(child && !child.exitCode && !record.exit),
      pid: child?.pid,
      token: record.token,
      backend: record.selection.backend,
      tag: record.selection.tag,
      stdout: record.stdout,
      stderr: record.stderr,
      exit: record.exit
    };
  }

  /** Start only from a selection returned by selectExecutable/ensureBackend. */
  async start({ selection, healthUrl, healthCheck, launchOptions = {} } = {}) {
    if (this._record?.child) throw new Error('Managed process is already running');
    const curated = validateCuratedSelection(selection || await this.selectExecutable());
    if (launchOptions.args || launchOptions.executable || launchOptions.executablePath || launchOptions.command) {
      throw new TypeError('Renderer-controlled executable paths and arguments are not accepted');
    }
    const ownerToken = token();
    const correlationId = createCorrelationId('process');
    const child = this.spawnImpl(curated.exePath, [], {
      cwd: curated.backendDir,
      env: { ...process.env, ...(launchOptions.env || {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (!child || !child.stdout || !child.stderr || typeof child.once !== 'function') {
      throw new TypeError('spawn implementation did not return a compatible child process');
    }
    const record = this._record = {
      child,
      token: ownerToken,
      correlationId,
      selection: curated,
      startedAt: this.now(),
      stdout: '',
      stderr: '',
      expected: false,
      forced: false,
      exit: null
    };
    const capture = (stream, field, kind) => stream.on('data', (chunk) => {
      record[field] = appendBounded(record[field], chunk, this.options.maxOutputBytes);
      if (typeof this.onOutput === 'function') this.onOutput({ kind, text: String(chunk), correlationId });
    });
    capture(child.stdout, 'stdout', 'stdout');
    capture(child.stderr, 'stderr', 'stderr');
    child.once('error', (error) => this._finish({ error, spawnError: true }));
    child.once('close', (code, signal) => this._finish({ code, signal }));
    return { token: ownerToken, correlationId, pid: child.pid, selection: curated };
  }

  async waitForHealth({ token: ownerToken, url, check = healthCheck, signal, intervalMs, timeoutMs } = {}) {
    this._assertOwner(ownerToken);
    if (typeof check !== 'function' && typeof url !== 'string') throw new TypeError('Health polling requires a URL or check function');
    const started = this.now();
    const interval = intervalMs ?? this.options.healthIntervalMs;
    const timeout = timeoutMs ?? this.options.healthTimeoutMs;
    while (this.running && this.now() - started <= timeout) {
      try {
        const result = typeof check === 'function'
          ? await check({ signal, token: ownerToken })
          : await defaultHealthCheck(url, { signal, fetchImpl: this.fetchImpl });
        return { ready: true, result, elapsedMs: this.now() - started };
      } catch (error) {
        if (signal?.aborted) throw createSafeError({ code: 'PROCESS_HEALTH_CANCELLED', message: 'Health polling was cancelled.', retryable: true });
        if (!this.running) break;
        await new Promise((resolve) => this.setTimeout(resolve, interval));
      }
    }
    throw createSafeError({ code: 'PROCESS_HEALTH_TIMEOUT', message: 'The backend did not become healthy in time.', retryable: true, recoveryAction: 'Retry startup' });
  }

  async stop({ token: ownerToken, timeoutMs } = {}) {
    this._assertOwner(ownerToken);
    if (!this.running) return this._record?.exit || { classification: 'expected' };
    const record = this._record;
    record.expected = true;
    try { record.child.kill('SIGTERM'); } catch (_) { /* process may have exited between checks */ }
    const timeout = timeoutMs ?? this.options.terminationTimeoutMs;
    await new Promise((resolve) => {
      if (!this.running) return resolve();
      const timer = this.setTimeout(() => {
        if (!this.running) return resolve();
        record.forced = true;
        try { record.child.kill('SIGKILL'); } catch (_) { /* already exited */ }
        resolve();
      }, timeout);
      record.child.once('close', () => { this.clearTimeout(timer); resolve(); });
    });
    return record.exit || { classification: record.forced ? 'forced' : 'expected' };
  }

  _assertOwner(ownerToken) {
    if (!this._record || !this._record.child || ownerToken !== this._record.token) {
      throw createSafeError({ code: 'PROCESS_OWNERSHIP', message: 'The process ownership token is invalid or expired.', retryable: false });
    }
  }

  _finish({ code = null, signal = null, error = null, spawnError = false }) {
    const record = this._record;
    if (!record || record.exit) return;
    record.exit = {
      code,
      signal,
      classification: classifyExit({ code, signal, expected: record.expected, forced: record.forced, spawnError }),
      at: this.now(),
      ...(error ? { error: createSafeError({ code: 'PROCESS_SPAWN', message: 'The backend process could not be started.', retryable: true, details: { reason: error.message } }) } : {})
    };
    record.child = null;
    if (typeof this.onExit === 'function') this.onExit({ ...record.exit, correlationId: record.correlationId });
  }
}

module.exports = {
  DEFAULTS,
  ManagedProcess,
  classifyExit,
  isCuratedSelection,
  validateCuratedSelection,
  appendBounded
};
