/* eslint-env node */
const REDACTED = '[stored]';
class CredentialStore {
  constructor({ store, safeStorage, allowFallback = false, logger = () => {} } = {}) { if (!store) throw new TypeError('store is required'); this.store = store; this.safeStorage = safeStorage; this.allowFallback = allowFallback; this.logger = logger; }
  available() { return Boolean(this.safeStorage?.isEncryptionAvailable?.()); }
  status() { return { encryptionAvailable: this.available(), fallbackAllowed: this.allowFallback, mode: this.available() ? 'safeStorage' : (this.allowFallback ? 'fallback' : 'unavailable') }; }
  _encode(value) { if (!value) return ''; if (this.available()) return this.safeStorage.encryptString(String(value)).toString('base64'); if (this.allowFallback) return `plain:${Buffer.from(String(value), 'utf8').toString('base64')}`; throw new Error('Secure storage is not available on this system.'); }
  _decode(value) { if (!value) return ''; try { if (String(value).startsWith('plain:')) return this.allowFallback ? Buffer.from(String(value).slice(6), 'base64').toString('utf8') : ''; if (!this.available()) return ''; return this.safeStorage.decryptString(Buffer.from(String(value), 'base64')); } catch (error) { this.logger('credential decryption failed'); return ''; } }
  _user(user) { if (!user?.id) throw new Error('Authentication required. Please log in or register to store provider credentials.'); return user.id; }
  list(user) { const id = this._user(user); const all = this.store.get('providerCredentials', {}); return (all[id] || []).map((item) => ({ ...item, apiKey: item.apiKey ? REDACTED : '', hasApiKey: Boolean(item.apiKey) })); }
  save(user, input) { const id = this._user(user); const all = this.store.get('providerCredentials', {}); const list = all[id] || []; const old = list.find((item) => item.id === input.id); const now = Date.now(); const encoded = this._encode(input.apiKey || ''); const provider = { id: String(input.id), name: String(input.name || ''), baseUrl: String(input.baseUrl || ''), apiKey: encoded, models: Array.isArray(input.models) ? input.models : [], updatedAt: now, createdAt: old?.createdAt || now }; all[id] = old ? list.map((item) => item.id === provider.id ? provider : item) : [...list, provider]; this.store.set('providerCredentials', all); return { ...provider, apiKey: provider.apiKey ? REDACTED : '', hasApiKey: Boolean(provider.apiKey) }; }
  remove(user, id) { const uid = this._user(user); const all = this.store.get('providerCredentials', {}); const list = all[uid] || []; const next = list.filter((item) => item.id !== id); if (next.length === list.length) return false; all[uid] = next; this.store.set('providerCredentials', all); return true; }
  readSecret(user, id) { const uid = this._user(user); const all = this.store.get('providerCredentials', {}); return this._decode((all[uid] || []).find((item) => item.id === id)?.apiKey); }
}
module.exports = { CredentialStore, REDACTED };
