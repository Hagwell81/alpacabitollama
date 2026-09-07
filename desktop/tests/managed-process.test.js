import assert from 'node:assert';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ManagedProcess,
  classifyExit,
  validateCuratedSelection
} = require('../runtime/managed-process');

function fakeChild({ pid = 42 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kills = [];
  child.kill = (signal) => child.kills.push(signal);
  return child;
}

const executableName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const selection = {
  exePath: `/app/backends/v1/cpu/${executableName}`,
  backendDir: '/app/backends/v1/cpu',
  backend: 'ubuntu-x64',
  tag: 'v1'
};

describe('ManagedProcess', () => {
  it('accepts only a curated llama-server selection and rejects arbitrary executable inputs', async () => {
    const normalized = validateCuratedSelection(selection);
    assert.strictEqual(normalized.exePath, path.resolve(selection.exePath));
    assert.strictEqual(normalized.backendDir, path.resolve(selection.backendDir));
    assert.strictEqual(normalized.backend, selection.backend);
    assert.throws(() => validateCuratedSelection({ ...selection, exePath: '/tmp/other' }), /curated|backend/i);

    const child = fakeChild();
    const manager = new ManagedProcess({ spawnImpl: () => child });
    await assert.rejects(
      manager.start({ selection, launchOptions: { args: ['--model', '/private/model.gguf'] } }),
      /arguments/i
    );
  });

  it('uses the binary manager seam, captures bounded output, and returns an owned token', async () => {
    const child = fakeChild({ pid: 77 });
    const outputs = [];
    const manager = new ManagedProcess({
      app: { id: 'app' },
      capabilities: { cpu: true },
      binaryManager: { ensureBackend: async () => selection },
      spawnImpl: (exe, args, options) => {
        assert.strictEqual(exe, path.resolve(selection.exePath));
        assert.deepStrictEqual(args, []);
        assert.strictEqual(options.cwd, path.resolve(selection.backendDir));
        return child;
      },
      options: { maxOutputBytes: 5 },
      onOutput: (event) => outputs.push(event)
    });

    const started = await manager.start();
    child.stdout.emit('data', 'hello world');
    child.stderr.emit('data', 'error');
    assert.strictEqual(started.pid, 77);
    assert.strictEqual(manager.status().stdout, 'world');
    assert.strictEqual(manager.status().stderr, 'error');
    assert.deepStrictEqual(outputs.map((event) => event.kind), ['stdout', 'stderr']);
    await assert.rejects(
      manager.stop({ token: 'wrong' }),
      (error) => error && error.code === 'PROCESS_OWNERSHIP'
    );
  });

  it('polls health through an injected check until it succeeds', async () => {
    const child = fakeChild();
    let attempts = 0;
    const manager = new ManagedProcess({ spawnImpl: () => child, options: { healthIntervalMs: 0 } });
    const started = await manager.start({ selection });
    const result = await manager.waitForHealth({
      token: started.token,
      check: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('not ready');
        return { status: 'ok' };
      }
    });
    assert.strictEqual(result.ready, true);
    assert.strictEqual(attempts, 3);
  });

  it('gracefully terminates, escalates when needed, and classifies exits safely', async () => {
    const child = fakeChild();
    const manager = new ManagedProcess({ spawnImpl: () => child, options: { terminationTimeoutMs: 1 } });
    const started = await manager.start({ selection });
    const stopping = manager.stop({ token: started.token });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(child.kills, ['SIGTERM']);
    child.emit('close', 0, null);
    const exit = await stopping;
    assert.strictEqual(exit.classification, 'expected');

    assert.strictEqual(classifyExit({ code: 1 }), 'crash');
    assert.strictEqual(classifyExit({ signal: 'SIGTERM' }), 'signal');
    assert.strictEqual(classifyExit({ code: 1, forced: true }), 'forced');
    assert.strictEqual(classifyExit({ spawnError: true }), 'spawn-error');
  });
});
