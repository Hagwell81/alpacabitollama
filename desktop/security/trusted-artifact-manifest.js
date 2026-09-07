/* eslint-env node */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_ENTRIES = 10000;
const MINISIGN_PUBLIC_KEY_BYTES = 42;
const MINISIGN_SIGNATURE_BYTES = 74;
const MINISIGN_GLOBAL_SIGNATURE_BYTES = 64;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function manifestPayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (Object.prototype.hasOwnProperty.call(parsed, 'signature') || Object.prototype.hasOwnProperty.call(parsed, 'publicKey')) return null;
  return canonicalize(parsed);
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.toString('base64') === value ? decoded : null;
  } catch (_) {
    return null;
  }
}

function parseMinisignPublicKey(publicKey) {
  const lines = String(publicKey || '').trim().split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: minisign public key ')) return null;
  const encoded = decodeBase64(lines[1].trim());
  if (!encoded || encoded.length !== MINISIGN_PUBLIC_KEY_BYTES || encoded.subarray(0, 2).toString() !== 'Ed') return null;
  return { keyId: encoded.subarray(2, 10), publicKey: encoded.subarray(10) };
}

function parseMinisignSignature(signatureText) {
  const lines = String(signatureText || '').trim().split(/\r?\n/);
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ') || !lines[2].startsWith('trusted comment: ')) return null;
  const encoded = decodeBase64(lines[1].trim());
  const globalSignature = decodeBase64(lines[3].trim());
  if (!encoded || encoded.length !== MINISIGN_SIGNATURE_BYTES || encoded.subarray(0, 2).toString() !== 'ED') return null;
  if (!globalSignature || globalSignature.length !== MINISIGN_GLOBAL_SIGNATURE_BYTES) return null;
  const trustedComment = lines[2].slice('trusted comment: '.length);
  if (!trustedComment || /[\r\n]/.test(trustedComment)) return null;
  return {
    keyId: encoded.subarray(2, 10),
    signature: encoded.subarray(10),
    globalSignature,
    trustedComment
  };
}

function verifyMinisignSignature(data, signatureText, publicKeyText) {
  try {
    const publicKey = parseMinisignPublicKey(publicKeyText);
    const signature = parseMinisignSignature(signatureText);
    if (!publicKey || !signature || !crypto.timingSafeEqual(publicKey.keyId, signature.keyId)) return false;
    const keyObject = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey.publicKey]), format: 'der', type: 'spki' });
    const hashedMessage = crypto.createHash('blake2b512').update(data).digest();
    if (!crypto.verify(null, hashedMessage, keyObject, signature.signature)) return false;
    const commentPayload = Buffer.concat([signature.signature, Buffer.from(signature.trustedComment, 'utf8')]);
    return crypto.verify(null, commentPayload, keyObject, signature.globalSignature);
  } catch (_) {
    return false;
  }
}

function normalizeEntry(entry, trusted = false) {
  if (!entry || typeof entry !== 'object' || !entry.digest) return null;
  return Object.freeze({
    digest: Object.freeze({ ...entry.digest, verified: trusted }),
    ...(entry.signature ? { signature: Object.freeze({ ...entry.signature }) } : {}),
    ...(entry.version ? { version: String(entry.version).slice(0, 128) } : {})
  });
}

class TrustedArtifactManifest {
  constructor(entries = {}, metadata = {}, trusted = false) {
    const source = Array.isArray(entries) ? Object.fromEntries(entries.map((entry) => [entry.id, entry])) : entries;
    const normalized = Object.entries(source || {}).slice(0, MAX_ENTRIES).reduce((result, [key, value]) => {
      const entry = normalizeEntry(value, trusted);
      if (entry && typeof key === 'string' && key.length <= 256) result[key] = entry;
      return result;
    }, {});
    this.entries = Object.freeze(normalized);
    this.trusted = trusted === true;
    this.metadata = Object.freeze({ source: 'bundled-trusted-manifest', trusted: this.trusted, ...metadata });
    Object.freeze(this);
  }

  lookup(kind, reference) {
    const key = `${String(kind)}:${String(reference)}`;
    return this.entries[key] || this.entries[String(reference)] || null;
  }

  has(kind, reference) { return Boolean(this.lookup(kind, reference)); }
  snapshot() { return Object.freeze({ source: this.metadata.source, trusted: this.trusted, entryCount: Object.keys(this.entries).length }); }
}

function loadTrustedArtifactManifest(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  const signaturePath = path.resolve(options.signaturePath || `${resolved}.minisig`);
  if (!fs.existsSync(resolved) || !fs.existsSync(signaturePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const payload = manifestPayload(parsed);
    const publicKeyPath = options.publicKeyPath;
    if (!payload || typeof publicKeyPath !== 'string' || !fs.existsSync(publicKeyPath)) return null;
    const trusted = verifyMinisignSignature(
      Buffer.from(payload, 'utf8'),
      fs.readFileSync(signaturePath, 'utf8'),
      fs.readFileSync(publicKeyPath, 'utf8')
    );
    if (!trusted) return null;
    return new TrustedArtifactManifest(parsed.entries || {}, { path: resolved, signaturePath, version: parsed.version }, true);
  } catch (_) {
    return null;
  }
}

module.exports = {
  TrustedArtifactManifest,
  loadTrustedArtifactManifest,
  normalizeEntry,
  canonicalize,
  manifestPayload,
  parseMinisignPublicKey,
  parseMinisignSignature,
  verifyMinisignSignature,
  MAX_ENTRIES
};
