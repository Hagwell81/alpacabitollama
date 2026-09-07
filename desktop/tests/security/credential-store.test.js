const assert = require('node:assert/strict');
const { CredentialStore, REDACTED } = require('../../security/credential-store');

function fakeStore() {
  const values = {};
  return { get: (key, fallback) => values[key] ?? fallback, set: (key, value) => { values[key] = value; }, values };
}

test('credential store uses safeStorage and never returns the secret to renderer', () => {
  const store = fakeStore();
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`enc:${value}`), decryptString: (value) => value.toString().replace(/^enc:/, '') };
  const credentials = new CredentialStore({ store, safeStorage });
  const saved = credentials.save({ id: 'user-1' }, { id: 'local', name: 'Local', baseUrl: 'loopback', apiKey: 'secret-value', models: [] });
  assert.equal(saved.apiKey, REDACTED);
  assert.equal(credentials.list({ id: 'user-1' })[0].apiKey, REDACTED);
  assert.equal(credentials.readSecret({ id: 'user-1' }, 'local'), 'secret-value');
  assert.equal(credentials.status().mode, 'safeStorage');
});

test('credential store requires explicit fallback acceptance', () => {
  const store = fakeStore();
  const unavailable = new CredentialStore({ store, safeStorage: { isEncryptionAvailable: () => false } });
  assert.throws(() => unavailable.save({ id: 'user-1' }, { id: 'x', apiKey: 'secret' }), /Secure storage/);
  const fallback = new CredentialStore({ store, safeStorage: { isEncryptionAvailable: () => false }, allowFallback: true });
  const saved = fallback.save({ id: 'user-1' }, { id: 'x', apiKey: 'secret', models: [] });
  assert.equal(saved.apiKey, REDACTED);
  assert.equal(fallback.readSecret({ id: 'user-1' }, 'x'), 'secret');
  assert.equal(fallback.status().mode, 'fallback');
});
