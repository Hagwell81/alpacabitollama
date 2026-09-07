/* eslint-env node */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const inventory = require('./fixtures/compatibility-inventory.json');
const { CircuitBreaker } = require('../request-manager');
const { LazyStartManager } = require('../lazy-start-manager');
const { mapCapabilitiesToBackend } = require('../binary-manager');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const mainSource = read('main.js');
const preloadSource = read('preload.js');

function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.message}`); process.exitCode = 1; }
}

console.log('compatibility inventory fixtures');
test('fixture tracks every main IPC handler', () => {
  for (const channel of inventory.mainIpcHandlers) assert.match(mainSource, new RegExp(`ipcMain\\.handle\\(['"]${channel.replace(/[:]/g, '\\:')}['"]`));
});
test('fixture tracks every preload invoke and event channel', () => {
  for (const channel of inventory.preloadBridge.invokeChannels) assert.match(preloadSource, new RegExp(`ipcRenderer\\.(invoke|on|removeListener)\\(['"]${channel.replace(/[:]/g, '\\:')}['"]`));
  for (const channel of inventory.preloadBridge.eventChannels) assert.match(preloadSource, new RegExp(`ipcRenderer\\.(on|removeListener)\\(['"]${channel.replace(/[:]/g, '\\:')}['"]`));
});
test('api-server adapter preserves loopback defaults', () => {
  const config = inventory.runtimeModules.apiServer.defaults;
  assert.strictEqual(config.host, inventory.adapterInputs.apiServer[0].expected.host);
  assert.strictEqual(config.port, inventory.adapterInputs.apiServer[0].expected.port);
  assert.deepStrictEqual(config.corsOrigins, inventory.adapterInputs.apiServer[0].expected.corsOrigins);
  assert.match(read('api-server.js'), /const DEFAULT_API_CONFIG/);
});
test('lazy-start adapter preserves defaults and clamps delay', () => {
  const values = {};
  const manager = new LazyStartManager({ get: (key, fallback) => values[key] ?? fallback, set: (key, value) => { values[key] = value; } });
  assert.strictEqual(manager.isEnabled(), inventory.adapterInputs.lazyStart[0].expected.enabled);
  manager.setAutoShutdownDelayMinutes(2000);
  assert.strictEqual(manager.getAutoShutdownDelayMinutes(), inventory.adapterInputs.lazyStart[1].expectedDelay);
});
test('request-manager circuit fixture reaches OPEN at threshold', () => {
  const input = inventory.adapterInputs.requestQueue[1];
  const breaker = new CircuitBreaker(input.threshold, 60000);
  breaker.recordFailure(); breaker.recordFailure();
  assert.strictEqual(breaker.getState().state, input.expectedState);
});
test('binary adapter maps representative backend inputs', () => {
  assert.strictEqual(mapCapabilitiesToBackend(inventory.adapterInputs.binary[1].capabilities), inventory.adapterInputs.binary[1].expectedBackend);
  assert.strictEqual(mapCapabilitiesToBackend(inventory.adapterInputs.binary[0].capabilities), inventory.adapterInputs.binary[0].expectedBackendByPlatform[process.platform]);
});
test('unknown filesystem channel is not part of the preload bridge', () => {
  assert.ok(!preloadSource.includes("'filesystem:read'"));
});
