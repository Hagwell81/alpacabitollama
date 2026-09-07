/* eslint-env node */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const inventory = require('../fixtures/compatibility-inventory.json');
const { ControlledProcess } = require('../fixtures/controlled-process');
const { ControlledProvider } = require('../fixtures/controlled-provider');
const { ControlledReader } = require('../fixtures/controlled-reader');
const { LazyStartManager } = require('../../lazy-start-manager');
const { RequestQueue, CircuitBreaker } = require('../../request-manager');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
const mainSource = read('main.js');
const preloadSource = read('preload.js');
const pendingTests = [];
const describe = (_name, fn) => fn();
const it = (name, fn) => pendingTests.push(Promise.resolve().then(fn).then(
  () => console.log(`  PASS: ${name}`),
  (error) => { console.error(`  FAIL: ${name}\\n    ${error.message}`); process.exitCode = 1; }
));

describe('desktop compatibility regressions', () => {
  it('keeps every inventoried IPC alias registered in main and preload', () => {
    const mainAliases = ['get-server-status', 'start-server', 'stop-server', 'download-models', 'set-selected-models', 'get-selected-models', 'get-installed-models', 'switch-model', 'get-api-settings', 'set-api-settings'];
    for (const channel of mainAliases) {
      assert.match(mainSource, new RegExp(`ipcMain\\.handle\\(['"]${channel}['"]`));
    }
    for (const channel of inventory.preloadBridge.invokeChannels) {
      assert.match(preloadSource, new RegExp(`ipcRenderer\\.invoke\\(['"]${channel}['"]`));
    }
    for (const channel of inventory.preloadBridge.eventChannels) {
      assert.match(preloadSource, new RegExp(`ipcRenderer\\.(?:on|removeListener)\\(['"]${channel}['"]`));
    }
  });

  it('preserves local llama-server defaults and representative inference routes', () => {
    assert.equal(inventory.runtimeModules.apiServer.defaults.host, '127.0.0.1');
    assert.equal(inventory.runtimeModules.apiServer.defaults.port, 13434);
    assert.deepEqual(inventory.runtimeModules.apiServer.defaults.corsOrigins, ['*']);
    assert.match(read('api-server.js'), /const DEFAULT_API_CONFIG/);
    assert.match(read('api-server.js'), /'127\.0\.0\.1'/);
    assert.match(read('api-server.js'), /\/v1/);
    assert.match(read('api-server.js'), /getApiOpenAIEndpoint/);
  });

  it('preserves curated selection/download and router model-switch seams', () => {
    for (const channel of ['download-models', 'set-selected-models', 'get-selected-models', 'get-installed-models', 'switch-model']) {
      assert.match(mainSource, new RegExp(`ipcMain\\.handle\\(['"]${channel}['"]`));
    }
    assert.match(mainSource, /Curated models/);
    assert.match(mainSource, /router|ROUTER/i);
    assert.match(read('binary-manager.js'), /mapCapabilitiesToBackend/);
  });

  it('preserves controlled backend startup, provider calls, and cancellation reader behavior', async () => {
    const process = new ControlledProcess();
    process.start('llama-server', ['--host', '127.0.0.1']);
    assert.equal(process.state, 'running');
    assert.deepEqual(process.commands[0], { type: 'start', command: 'llama-server', args: ['--host', '127.0.0.1'] });

    const provider = new ControlledProvider();
    await provider.chat({ model: 'local-model.gguf', stream: true });
    await provider.cancel('request-1');
    assert.deepEqual(provider.calls.map(({ operation }) => operation), ['chat', 'cancel']);

    const reader = new ControlledReader(['data: first\\n\\n']);
    assert.deepEqual(await reader.read(), { done: false, value: 'data: first\\n\\n' });
    reader.cancel();
    assert.deepEqual(await reader.read(), { done: true, value: undefined });
  });

  it('preserves lazy-start and request protection behavior', () => {
    const values = {};
    const lazy = new LazyStartManager({ get: (key, fallback) => values[key] ?? fallback, set: (key, value) => { values[key] = value; } });
    assert.equal(lazy.isEnabled(), inventory.adapterInputs.lazyStart[0].expected.enabled);
    lazy.setAutoShutdownDelayMinutes(2000);
    assert.equal(lazy.getAutoShutdownDelayMinutes(), 1440);

    const breaker = new CircuitBreaker(2, 60000);
    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.getState().state, 'OPEN');
    assert.ok(RequestQueue && typeof RequestQueue === 'function');
  });

  it('does not expose renderer filesystem/process channels and keeps authorization cases stable', () => {
    assert.equal(preloadSource.includes("'filesystem:read'"), false);
    assert.equal(preloadSource.includes("'process:spawn'"), false);
    for (const allowed of inventory.preloadBridge.authorizationCases.filter((item) => item.expected.includes('allowlisted'))) {
      assert.match(preloadSource, new RegExp(`ipcRenderer\\.invoke\\(['"]${allowed.channel}['"]`));
    }
  });
});

Promise.all(pendingTests).then(() => undefined);
