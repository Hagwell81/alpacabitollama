/* eslint-env node */
const assert = require('node:assert/strict');
const { validateArgs, validateEvent, validateEventCallback, validateSender } = require('../../security/bridge-schema');

test('bridge schema enforces per-channel argument shapes', () => {
  assert.deepEqual(validateArgs('get-server-status', []), []);
  assert.throws(() => validateArgs('get-server-status', ['unexpected']), /does not accept/);
  assert.deepEqual(validateArgs('delete-model', ['model.gguf']), ['model.gguf']);
  assert.deepEqual(validateArgs('set-selected-models', [['model.gguf']]), [['model.gguf']]);
  assert.deepEqual(validateArgs('set-lazy-start-enabled', [true]), [true]);
  assert.throws(() => validateArgs('delete-model', [42]), /requires one string/);
  assert.throws(() => validateArgs('set-api-settings', ['not-an-object']), /requires one object/);
  assert.throws(() => validateArgs('filesystem:read', []), /not allowed/);
});

test('bridge schema bounds nested payloads and validates events/callbacks', () => {
  assert.throws(() => validateArgs('set-api-settings', [{ value: 'x'.repeat(256 * 1024 + 1) }]), /string limit/);
  assert.equal(validateEvent('logs:append'), 'logs:append');
  assert.throws(() => validateEvent('unknown:event'), /not allowed/);
  assert.throws(() => validateEventCallback(null), /callback/);
});

test('main validation rejects missing, destroyed, or untrusted renderer senders', () => {
  assert.throws(() => validateSender(null), /sender/);
  assert.throws(() => validateSender({ sender: { isDestroyed: () => true } }), /destroyed/);
  assert.throws(() => validateSender({ sender: {}, senderFrame: { url: 'https://evil.example' } }), /trusted/);
  assert.doesNotThrow(() => validateSender({ sender: {}, senderFrame: { url: 'file:///app/index.html' } }));
  assert.doesNotThrow(() => validateSender({ sender: {}, senderFrame: { url: 'http://localhost:13434/' } }));
  assert.doesNotThrow(() => validateSender({ sender: {}, senderFrame: { url: 'http://127.0.0.1:13434/' } }));
  assert.doesNotThrow(() => validateSender({ sender: {}, senderFrame: { url: 'http://127.0.0.1:13434' } }));
  assert.doesNotThrow(() => validateSender({ sender: {}, senderFrame: { url: 'http://[::1]:13434/' } }));
  assert.throws(() => validateSender({ sender: {}, senderFrame: { url: 'http://192.168.1.5:13434/' } }), /trusted/);
});

test('bridge schema validates compatibility multi-argument channels', () => {
  assert.deepEqual(validateArgs('get-model-fit-plan', ['model.gguf', { usableMemoryBytes: 1 }]), ['model.gguf', { usableMemoryBytes: 1 }]);
  assert.deepEqual(validateArgs('search-huggingface', ['owner/repo', undefined]), ['owner/repo', undefined]);
  assert.deepEqual(validateArgs('download-huggingface-model', ['owner/repo', 'model.gguf', undefined]), ['owner/repo', 'model.gguf', undefined]);
  assert.deepEqual(validateArgs('register-user', ['user', 'password', undefined, undefined]), ['user', 'password', undefined, undefined]);
  assert.deepEqual(validateArgs('login-user', ['user', 'password']), ['user', 'password']);
  assert.deepEqual(validateArgs('web-search', ['query', undefined]), ['query', undefined]);
  assert.deepEqual(validateArgs('jcm-search-symbols', ['repo', 'query', undefined, undefined]), ['repo', 'query', undefined, undefined]);
  assert.deepEqual(validateArgs('jcm-get-symbol-source', ['repo', 'symbol']), ['repo', 'symbol']);
  assert.deepEqual(validateArgs('jcm-get-file-tree', ['repo', undefined]), ['repo', undefined]);
  assert.deepEqual(validateArgs('jcm-get-file-content', ['repo', 'src/index.js']), ['repo', 'src/index.js']);
  assert.deepEqual(validateArgs('jcm-get-file-outline', ['repo', 'src/index.js']), ['repo', 'src/index.js']);
  assert.deepEqual(validateArgs('jcm-get-context-bundle', ['repo', 'symbol', undefined]), ['repo', 'symbol', undefined]);
  assert.deepEqual(validateArgs('api:count-tokens', [[{ role: 'user', content: 'hello' }], undefined]), [[{ role: 'user', content: 'hello' }], undefined]);
  assert.deepEqual(validateArgs('download-backend', [undefined, undefined]), [undefined, undefined]);
  assert.deepEqual(validateArgs('set-provider-credential', ['id', 'name', 'http://localhost', 'secret', ['model']]), ['id', 'name', 'http://localhost', 'secret', ['model']]);
  assert.deepEqual(validateArgs('jcm-list-repos', []), []);
});

test('bridge schema rejects invalid compatibility argument shapes', () => {
  assert.throws(() => validateArgs('get-model-fit-plan', ['model.gguf']), /invalid argument 2/);
  assert.throws(() => validateArgs('search-huggingface', ['repo', 42]), /invalid argument 2/);
  assert.throws(() => validateArgs('download-huggingface-model', ['repo']), /invalid argument 2/);
  assert.throws(() => validateArgs('register-user', ['user']), /invalid argument 2/);
  assert.throws(() => validateArgs('login-user', ['user', 42]), /invalid argument 2/);
  assert.throws(() => validateArgs('web-search', ['query', '5']), /invalid argument 2/);
  assert.throws(() => validateArgs('jcm-search-symbols', ['repo', 'query', '10', 'function']), /invalid argument 3/);
  assert.throws(() => validateArgs('jcm-get-symbol-source', ['repo']), /invalid argument 2/);
  assert.throws(() => validateArgs('jcm-get-file-content', ['repo']), /invalid argument 2/);
  assert.throws(() => validateArgs('jcm-get-context-bundle', ['repo', 'symbol', 'yes']), /invalid argument 3/);
  assert.throws(() => validateArgs('api:count-tokens', [{ role: 'user' }]), /invalid argument 1/);
  assert.throws(() => validateArgs('download-backend', [42, 'latest']), /invalid argument 1/);
  assert.throws(() => validateArgs('set-provider-credential', ['id', 'name', 'url', 'secret', 'model']), /invalid argument 5/);
  assert.throws(() => validateArgs('jcm-list-repos', ['unexpected']), /does not accept/);
});