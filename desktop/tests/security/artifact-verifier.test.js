/* eslint-env node */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const {
  ArtifactVerifier,
  REUSE_POLICIES,
  RECOVERY_ACTIONS,
  deterministicIdentity
} = require('../../security/artifact-verifier');

function test(name, fn) {
  Promise.resolve().then(fn).then(() => console.log(`  PASS: ${name}`)).catch((error) => {
    console.error(`  FAIL: ${name}\n    ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-verifier-'));
  const filePath = path.join(root, 'downloads', 'model.gguf');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'trusted artifact');
  return { root, filePath, trusted: { algorithm: 'SHA256', value: digest('trusted artifact') } };
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

console.log('artifact verifier tests');

test('streams configured digest algorithms and produces deterministic identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-stream-'));
  try {
    const verifier = new ArtifactVerifier({ applicationRoot: root, supportedAlgorithms: ['sha256'] });
    const result = await verifier.digestStream(Readable.from(['hello ', Buffer.from('world')]));
    assert.deepStrictEqual(result, { algorithm: 'sha256', value: digest('hello world'), verified: true });
    assert.strictEqual(deterministicIdentity({ digest: result }), `digest:sha256:${result.value}`);
    await assert.rejects(() => verifier.digestStream(Readable.from(['x']), { algorithm: 'md5' }), /Unsupported digest algorithm/);
  } finally { cleanup(root); }
});

test('accepts trusted digest and returns executable verified result', async () => {
  const { root, filePath, trusted } = fixture();
  try {
    const result = await new ArtifactVerifier({ applicationRoot: root }).verifyArtifact({ filePath, kind: 'model', expectedDigest: trusted });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 'verified');
    assert.strictEqual(result.executable, true);
    assert.strictEqual(result.identity, `digest:sha256:${trusted.value}`);
  } finally { cleanup(root); }
});

test('quarantines changed bytes and returns safe alternate-source recovery', async () => {
  const { root, filePath, trusted } = fixture();
  try {
    fs.writeFileSync(filePath, 'tampered artifact');
    const result = await new ArtifactVerifier({ applicationRoot: root }).verifyArtifact({ filePath, kind: 'backend', expectedDigest: trusted });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 'mismatch');
    assert.strictEqual(result.executable, false);
    assert.strictEqual(result.recoveryAction, RECOVERY_ACTIONS.ALTERNATE_SOURCE);
    assert.strictEqual(fs.existsSync(filePath), false);
    assert.strictEqual(fs.existsSync(result.quarantine.path), true);
    assert.strictEqual(path.dirname(result.quarantine.path), path.join(root, 'quarantine'));
  } finally { cleanup(root); }
});

test('checks injected trusted signatures after digest verification', async () => {
  const { root, filePath, trusted } = fixture();
  try {
    const verifier = new ArtifactVerifier({ applicationRoot: root, verifySignature: ({ digest: actual, signature }) => signature.value === actual.value });
    const accepted = await verifier.verifyArtifact({ filePath, kind: 'model', expectedDigest: trusted, signature: { trusted: true, value: trusted.value } });
    assert.strictEqual(accepted.status, 'verified');
    const rejected = await verifier.verifyArtifact({ filePath, kind: 'model', expectedDigest: trusted, signature: { trusted: true, value: 'wrong' }, quarantineOnFailure: false });
    assert.strictEqual(rejected.status, 'invalid');
    assert.strictEqual(rejected.executable, false);
  } finally { cleanup(root); }
});

test('only reuses trusted records under manifest policy and never unchecked executable metadata', async () => {
  const { root, filePath, trusted } = fixture();
  try {
    const verifier = new ArtifactVerifier({ applicationRoot: root, policy: REUSE_POLICIES.ON_MANIFEST_CHANGE });
    const reused = await verifier.verifyArtifact({ filePath, kind: 'model', expectedDigest: trusted, recordedDigest: { ...trusted, verified: true }, manifestVersion: 'v1', recordedManifestVersion: 'v1' });
    assert.strictEqual(reused.status, 'reused');
    assert.strictEqual(reused.executable, true);
    const changed = verifier.canReuse({ kind: 'model', trustedDigest: trusted, recordedDigest: { ...trusted, verified: true }, manifestVersion: 'v2', recordedManifestVersion: 'v1', policy: REUSE_POLICIES.ON_MANIFEST_CHANGE });
    assert.deepStrictEqual(changed, { reuse: false, reason: 'manifest-changed' });
    assert.throws(() => verifier.canReuse({ kind: 'model', policy: REUSE_POLICIES.NEVER, trustedDigest: trusted, recordedDigest: { ...trusted, verified: true } }), /Unchecked reuse/);
  } finally { cleanup(root); }
});

test('rejects outside paths and supports idempotent incomplete removal', async () => {
  const { root, trusted } = fixture();
  const outside = path.join(path.dirname(root), `outside-${path.basename(root)}`);
  fs.writeFileSync(outside, 'do not remove');
  try {
    const verifier = new ArtifactVerifier({ applicationRoot: root });
    await assert.rejects(() => verifier.verifyArtifact({ filePath: outside, expectedDigest: trusted }), /inside the application data directory/);
    assert.throws(() => verifier.removeIncomplete(outside), /inside the application data directory/);
    const missing = verifier.removeIncomplete(path.join(root, 'missing.part'));
    assert.strictEqual(missing.removed, false);
    assert.deepStrictEqual(verifier.recover({ status: 'mismatch' }, RECOVERY_ACTIONS.RETRY), { action: 'retry', removed: false });
    assert.throws(() => verifier.recover({}, 'delete-anywhere'), /Unsupported artifact recovery action/);
  } finally { cleanup(root); cleanup(outside); }
});
