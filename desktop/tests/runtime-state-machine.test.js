/* eslint-env node */
const assert = require('assert');
const {
  RUNTIME_STATE_ADJACENCY,
  RuntimeStateMachine
} = require('../runtime/runtime-state-machine');

function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.message}`); process.exitCode = 1; }
}

console.log('runtime state machine tests');

test('uses the explicit public adjacency table', () => {
  assert.deepStrictEqual(RUNTIME_STATE_ADJACENCY, {
    idle: ['acquiring'], acquiring: ['starting', 'failed'], starting: ['ready', 'failed'],
    ready: ['busy', 'stopping'], busy: ['ready', 'cancelling'], stopping: ['idle', 'failed'],
    failed: ['acquiring', 'idle'], cancelling: ['ready']
  });
});

test('commits structured reasons with correlation, progress, and cancellable metadata', () => {
  const machine = new RuntimeStateMachine();
  const result = machine.transition({ to: 'acquiring', reasonCode: 'ensure-ready', correlationId: 'corr-1', at: 123, progress: 15, cancellable: true });
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.state, 'acquiring');
  assert.deepStrictEqual(result.reason, { from: 'idle', to: 'acquiring', reasonCode: 'ensure-ready', correlationId: 'corr-1', at: 123, progress: 15, cancellable: true });
});

test('rejects invalid transitions without mutating state and emits one diagnostic', () => {
  const diagnostics = [];
  const machine = new RuntimeStateMachine({ onDiagnostic: (event) => diagnostics.push(event) });
  const result = machine.transition('ready', { reasonCode: 'premature-ready', correlationId: 'corr-invalid' });
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(machine.state, 'idle');
  assert.deepStrictEqual(machine.getHistory(), []);
  assert.strictEqual(diagnostics.length, 1);
  assert.deepStrictEqual(diagnostics[0].attemptedTransition, { from: 'idle', to: 'ready' });
  assert.strictEqual(diagnostics[0].reasonCode, 'premature-ready');
  assert.strictEqual(diagnostics[0].error.code, 'INVALID_TRANSITION');
});

test('bounds transition history to the configured limit', () => {
  const machine = new RuntimeStateMachine({ historyLimit: 2 });
  machine.transition('acquiring'); machine.transition('starting'); machine.transition('ready');
  assert.deepStrictEqual(machine.getHistory().map((entry) => entry.to), ['starting', 'ready']);
});

test('rejects stale operation completions after a newer epoch begins', () => {
  const diagnostics = [];
  const machine = new RuntimeStateMachine({ onDiagnostic: (event) => diagnostics.push(event) });
  const oldEpoch = machine.beginOperation(); machine.beginOperation();
  const result = machine.transition('acquiring', { epoch: oldEpoch, reasonCode: 'late-acquisition', correlationId: 'corr-stale' });
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(machine.state, 'idle');
  assert.strictEqual(result.reason, undefined);
  assert.strictEqual(result.diagnostic.reasonCode, 'stale-operation-epoch');
  assert.strictEqual(diagnostics.length, 1);
});

test('accepts a transition from the current operation epoch', () => {
  const machine = new RuntimeStateMachine();
  const epoch = machine.beginOperation();
  const result = machine.transition('acquiring', { epoch, reasonCode: 'acquire' });
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(machine.operationEpoch, epoch);
});

console.log('All runtime state machine tests completed.');
