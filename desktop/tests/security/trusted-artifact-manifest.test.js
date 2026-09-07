const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TrustedArtifactManifest, loadTrustedArtifactManifest, canonicalize } = require('../../security/trusted-artifact-manifest');
const { createMinisignTestKeyPair, signMinisignData } = require('./minisign-test-key');

test('trusted manifest resolves only caller-supplied local metadata', () => {
  const manifest = new TrustedArtifactManifest({
    'archive:v1/backend.zip': { digest: { algorithm: 'sha256', value: 'a'.repeat(64) }, signature: { trusted: true } }
  });
  assert.equal(manifest.has('archive', 'v1/backend.zip'), true);
  assert.equal(manifest.lookup('archive', 'v1/backend.zip').digest.verified, false);
  assert.equal(manifest.has('archive', 'remote-response-checksum'), false);
});

test('trusted manifest loader fails closed for missing, malformed, or legacy inline signatures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-manifest-'));
  try {
    assert.equal(loadTrustedArtifactManifest(path.join(root, 'missing.json')), null);
    const file = path.join(root, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify({ entries: { 'archive:v1/backend.zip': { digest: { algorithm: 'sha256', value: 'a'.repeat(64) } } } }));
    assert.equal(loadTrustedArtifactManifest(file), null);
    fs.writeFileSync(file, '{not-json');
    assert.equal(loadTrustedArtifactManifest(file), null);
    fs.writeFileSync(file, JSON.stringify({ version: 'legacy', entries: {}, signature: { algorithm: 'RSA-SHA256', value: 'legacy' } }));
    assert.equal(loadTrustedArtifactManifest(file), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('trusted manifest requires a valid detached Minisign signature and canonical payload', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-manifest-signed-'));
  try {
    const { publicPath: publicKeyPath, privatePath: privateKeyPath } = createMinisignTestKeyPair(root);
    const manifestPath = path.join(root, 'manifest.json');
    const signaturePath = `${manifestPath}.minisig`;
    const payload = { version: 'release-1', entries: { 'archive:v1/backend.zip': { digest: { algorithm: 'sha256', value: 'a'.repeat(64) } } } };
    fs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`);
    signMinisignData(Buffer.from(canonicalize(payload), 'utf8'), path.basename(manifestPath), privateKeyPath, signaturePath);
    const manifest = loadTrustedArtifactManifest(manifestPath, { publicKeyPath });
    assert.equal(manifest?.trusted, true);
    assert.equal(manifest.lookup('archive', 'v1/backend.zip').digest.verified, true);
    fs.writeFileSync(manifestPath, JSON.stringify({ ...payload, version: 'tampered' }));
    assert.equal(loadTrustedArtifactManifest(manifestPath, { publicKeyPath }), null);
    fs.writeFileSync(manifestPath, JSON.stringify(payload));
    fs.writeFileSync(signaturePath, 'invalid');
    assert.equal(loadTrustedArtifactManifest(manifestPath, { publicKeyPath }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
