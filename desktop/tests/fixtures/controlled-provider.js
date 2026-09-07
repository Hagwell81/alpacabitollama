class ControlledProvider {
  constructor(overrides = {}) {
    this.calls = [];
    this.overrides = overrides;
  }

  descriptor() {
    return this.overrides.descriptor || { id: 'fixture-provider', name: 'Fixture Provider' };
  }

  call(operation, value) {
    this.calls.push({ operation, value });
    const result = this.overrides[operation];
    return typeof result === 'function' ? result(value) : Promise.resolve(result ?? { ok: true, operation, value });
  }

  listModels(value) { return this.call('listModels', value); }
  ensureReady(value) { return this.call('ensureReady', value); }
  health(value) { return this.call('health', value); }
  chat(value) { return this.call('chat', value); }
  stream(value) { return this.call('stream', value); }
  cancel(value) { return this.call('cancel', value); }
}

module.exports = { ControlledProvider };
