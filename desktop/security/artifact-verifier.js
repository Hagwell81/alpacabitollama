/* eslint-env node */
/**
 * Local artifact verification primitives. This module deliberately does not
 * download artifacts or make trust decisions from network responses. Callers
 * must supply a trusted digest/signature record.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_DIGEST_ALGORITHM,
  normalizeAlgorithm,
  normalizeDigest,
  digestStream: catalogDigestStream,
  digestIdentity,
  verifyDigest
} = require('../catalog/model-identity');

const REUSE_POLICIES = Object.freeze({ ALWAYS: 'always', ON_MANIFEST_CHANGE: 'on-manifest-change', NEVER: 'never' });
const RECOVERY_ACTIONS = Object.freeze({ RETRY: 'retry', ALTERNATE_SOURCE: 'use-alternate-source', REMOVE_QUARANTINED: 'remove-quarantined' });
const EXECUTABLE_KINDS = new Set(['backend', 'model', 'archive', 'executable']);

function ownedPath(root, candidate) {
  if (typeof candidate !== 'string' || !candidate) throw new TypeError('Artifact path is required');
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(candidate);
  const relative = path.relative(absoluteRoot, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError('Artifact path must be inside the application data directory');
  }
  return absolute;
}

function safeSegment(value) {
  return String(value || 'artifact').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'artifact';
}

function deterministicIdentity({ digest, kind = 'artifact', source = 'local', reference = '' } = {}) {
  const normalized = normalizeDigest(digest);
  if (normalized?.verified) return digestIdentity(normalized);
  return `artifact:${safeSegment(kind)}:${safeSegment(source)}:${safeSegment(reference)}`;
}

function recoveryFor(status) {
  if (status === 'mismatch' || status === 'invalid' || status === 'unverified') return RECOVERY_ACTIONS.ALTERNATE_SOURCE;
  if (status === 'incomplete' || status === 'error') return RECOVERY_ACTIONS.RETRY;
  return null;
}

function normalizePolicy(policy, kind) {
  const value = policy || REUSE_POLICIES.ALWAYS;
  if (!Object.values(REUSE_POLICIES).includes(value)) throw new TypeError(`Unsupported reuse policy: ${value}`);
  if (value === REUSE_POLICIES.NEVER && EXECUTABLE_KINDS.has(kind)) {
    throw new TypeError('Unchecked reuse is not permitted for executable artifacts');
  }
  return value;
}

function lookupTrust(record, trustedDigests) {
  if (record) return record;
  if (!trustedDigests) return null;
  if (typeof trustedDigests === 'function') return trustedDigests;
  if (Array.isArray(trustedDigests)) return trustedDigests.find((item) => item && item.value);
  return trustedDigests;
}

function normalizeTrustedDigest(record) {
  const normalized = normalizeDigest(record);
  return normalized ? { ...normalized, verified: true } : null;
}

class ArtifactVerifier {
  constructor({
    applicationRoot = process.cwd(),
    quarantineRoot,
    supportedAlgorithms = [DEFAULT_DIGEST_ALGORITHM],
    policy = REUSE_POLICIES.ALWAYS,
    trustedDigests,
    trustedSignatures,
    verifySignature,
    fsImpl = fs,
    cryptoImpl = crypto,
    now = () => Date.now()
  } = {}) {
    this.applicationRoot = path.resolve(applicationRoot);
    this.quarantineRoot = path.resolve(quarantineRoot || path.join(this.applicationRoot, 'quarantine'));
    this.supportedAlgorithms = new Set(supportedAlgorithms.map(normalizeAlgorithm));
    this.policy = policy;
    this.trustedDigests = trustedDigests;
    this.trustedSignatures = trustedSignatures;
    this.verifySignature = verifySignature;
    this.fs = fsImpl;
    this.crypto = cryptoImpl;
    this.now = now;
    normalizePolicy(policy, 'metadata');
  }

  async digestStream(source, { algorithm = DEFAULT_DIGEST_ALGORITHM } = {}) {
    const normalizedAlgorithm = normalizeAlgorithm(algorithm);
    if (!this.supportedAlgorithms.has(normalizedAlgorithm)) throw new TypeError(`Unsupported digest algorithm: ${normalizedAlgorithm}`);
    return catalogDigestStream(source, { algorithm: normalizedAlgorithm });
  }

  async digestFile(filePath, options = {}) {
    const safePath = ownedPath(this.applicationRoot, filePath);
    return this.digestStream(this.fs.createReadStream(safePath), options);
  }

  canReuse({ recordedDigest, trustedDigest, manifestVersion, recordedManifestVersion, policy = this.policy, kind = 'artifact' } = {}) {
    const selectedPolicy = normalizePolicy(policy, kind);
    const recorded = normalizeDigest(recordedDigest);
    const trusted = normalizeTrustedDigest(trustedDigest);
    if (!recorded?.verified || !trusted?.verified || !verifyDigest(recorded, trusted)) {
      return { reuse: false, reason: 'missing-or-untrusted-digest' };
    }
    if (selectedPolicy === REUSE_POLICIES.ALWAYS) return { reuse: false, reason: 'rehash-required' };
    if (selectedPolicy === REUSE_POLICIES.ON_MANIFEST_CHANGE && manifestVersion !== recordedManifestVersion) {
      return { reuse: false, reason: 'manifest-changed' };
    }
    if (selectedPolicy === REUSE_POLICIES.NEVER) return { reuse: true, reason: 'non-executable-metadata' };
    return { reuse: true, reason: 'trusted-record-matches' };
  }

  async verifyArtifact({
    filePath,
    path: requestedPath,
    kind = 'artifact',
    source = 'local',
    reference = requestedPath || filePath || '',
    expectedDigest,
    trustedDigest,
    signature,
    recordedDigest,
    manifestVersion,
    recordedManifestVersion,
    policy = this.policy,
    force = false,
    quarantineOnFailure = true
  } = {}) {
    const artifactPath = ownedPath(this.applicationRoot, filePath || requestedPath);
    const trusted = normalizeTrustedDigest(lookupTrust(expectedDigest || trustedDigest, this.trustedDigests));
    const reuse = !force && this.canReuse({ recordedDigest, trustedDigest: trusted, manifestVersion, recordedManifestVersion, policy, kind });
    if (reuse.reuse) {
      return this._result({ ok: true, status: 'reused', path: artifactPath, digest: trusted, kind, source, reference, reused: true });
    }
    if (!trusted) return this._failure({ status: 'unverified', path: artifactPath, kind, source, reference, quarantineOnFailure, reason: 'No trusted digest was supplied' });
    if (!this.fs.existsSync(artifactPath)) return this._failure({ status: 'incomplete', path: artifactPath, kind, source, reference, quarantineOnFailure: false, reason: 'Artifact does not exist' });
    let actual;
    try {
      actual = await this.digestFile(artifactPath, { algorithm: trusted.algorithm });
    } catch (error) {
      return this._failure({ status: 'error', path: artifactPath, kind, source, reference, quarantineOnFailure: false, reason: 'Artifact could not be read', error });
    }
    if (!verifyDigest(actual, trusted)) {
      return this._failure({ status: 'mismatch', path: artifactPath, digest: actual, kind, source, reference, quarantineOnFailure, reason: 'Artifact digest does not match the trusted digest' });
    }
    const signatureResult = await this._verifySignature({ artifactPath, digest: actual, signature });
    if (!signatureResult.ok) {
      return this._failure({ status: 'invalid', path: artifactPath, digest: actual, kind, source, reference, quarantineOnFailure, reason: signatureResult.reason });
    }
    return this._result({ ok: true, status: 'verified', path: artifactPath, digest: { ...actual, verified: true }, kind, source, reference, signature: signatureResult });
  }

  async _verifySignature({ artifactPath, digest, signature }) {
    if (!signature && !this.trustedSignatures) return { ok: true, checked: false };
    const record = signature || (typeof this.trustedSignatures === 'function' ? await this.trustedSignatures({ artifactPath, digest }) : this.trustedSignatures);
    if (!record || record.trusted !== true) return { ok: false, checked: true, reason: 'Signature is not trusted' };
    if (typeof this.verifySignature === 'function') {
      const valid = await this.verifySignature({ artifactPath, digest, signature: record });
      return valid ? { ok: true, checked: true } : { ok: false, checked: true, reason: 'Signature verification failed' };
    }
    if (!record.publicKey || !record.value) return { ok: false, checked: true, reason: 'Trusted signature record is incomplete' };
    try {
      const verifier = this.crypto.createVerify(record.algorithm || 'RSA-SHA256');
      verifier.update(Buffer.from(digest.value, 'hex'));
      verifier.end();
      const valid = verifier.verify(record.publicKey, Buffer.from(record.value, 'base64'));
      return valid ? { ok: true, checked: true } : { ok: false, checked: true, reason: 'Signature verification failed' };
    } catch (_) {
      return { ok: false, checked: true, reason: 'Signature verification failed' };
    }
  }

  _result({ ok, status, path: artifactPath, digest, kind, source, reference, reused = false, signature, quarantine } = {}) {
    return {
      ok, status, path: artifactPath, kind,
      digest: digest || null,
      identity: deterministicIdentity({ digest, kind, source, reference }),
      reused,
      executable: ok && Boolean(digest?.verified) && status !== 'unverified',
      recoveryAction: null,
      ...(signature ? { signature } : {}),
      ...(quarantine ? { quarantine } : {})
    };
  }

  _failure({ status, path: artifactPath, digest, kind, source, reference, quarantineOnFailure, reason, error } = {}) {
    let quarantine;
    if (quarantineOnFailure && this.fs.existsSync(artifactPath)) {
      try { quarantine = this.quarantine(artifactPath, { artifactId: deterministicIdentity({ digest, kind, source, reference }), reason, kind }); } catch (_) { /* preserve the verification failure */ }
    }
    return {
      ...this._result({ ok: false, status, path: artifactPath, digest, kind, source, reference, quarantine }),
      executable: false,
      recoveryAction: recoveryFor(status),
      error: { code: `ARTIFACT_${status.toUpperCase()}`, message: reason }
    };
  }

  quarantine(filePath, { artifactId = 'artifact', reason = 'verification-failed', kind = 'artifact' } = {}) {
    const sourcePath = ownedPath(this.applicationRoot, filePath);
    const root = ownedPath(this.applicationRoot, this.quarantineRoot);
    if (!this.fs.existsSync(sourcePath)) return { removed: false, path: null, reason: 'not-found' };
    this.fs.mkdirSync(root, { recursive: true });
    const base = `${safeSegment(kind)}-${safeSegment(artifactId)}-${safeSegment(path.basename(sourcePath))}`;
    let destination = path.join(root, base);
    let suffix = 1;
    while (this.fs.existsSync(destination)) destination = path.join(root, `${base}-${suffix++}`);
    this.fs.renameSync(sourcePath, destination);
    return { removed: true, path: destination, reason: safeSegment(reason), recoveryAction: RECOVERY_ACTIONS.ALTERNATE_SOURCE };
  }

  removeIncomplete(filePath) {
    const safePath = ownedPath(this.applicationRoot, filePath);
    if (!this.fs.existsSync(safePath)) return { removed: false, path: safePath };
    this.fs.rmSync(safePath, { recursive: false, force: true });
    return { removed: true, path: safePath, recoveryAction: RECOVERY_ACTIONS.RETRY };
  }

  recover(result, action) {
    if (!result || typeof result !== 'object' || !Object.values(RECOVERY_ACTIONS).includes(action)) {
      throw new TypeError('Unsupported artifact recovery action');
    }
    if (action === RECOVERY_ACTIONS.REMOVE_QUARANTINED && result.quarantine?.path) {
      const quarantinePath = ownedPath(this.applicationRoot, result.quarantine.path);
      this.fs.rmSync(quarantinePath, { recursive: false, force: true });
      return { action, removed: true };
    }
    if (action === RECOVERY_ACTIONS.RETRY || action === RECOVERY_ACTIONS.ALTERNATE_SOURCE) return { action, removed: false };
    throw new TypeError('Artifact recovery action is not available for this result');
  }
}

module.exports = {
  ArtifactVerifier,
  REUSE_POLICIES,
  RECOVERY_ACTIONS,
  deterministicIdentity,
  ownedPath,
  normalizePolicy
};
