const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ArtifactVerifier } = require('../../security/artifact-verifier');

test('download artifact trust is fail-closed and quarantines tampered archives', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpacabitollama-artifact-'));
  const file = path.join(root, 'backend.zip');
  fs.writeFileSync(file, 'tampered');
  const verifier = new ArtifactVerifier({ applicationRoot: root, quarantineRoot: path.join(root, 'quarantine') });
  const digest = crypto.createHash('sha256').update('trusted').digest('hex');
  const result = await verifier.verifyArtifact({ filePath: file, kind: 'archive', expectedDigest: { algorithm: 'sha256', value: digest } });
  assert.equal(result.executable, false);
  assert.equal(result.status, 'mismatch');
  assert.equal(result.quarantine.removed, true);
  assert.equal(fs.existsSync(file), false);
});

test('missing trusted metadata never marks an archive executable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpacabitollama-artifact-'));
  const file = path.join(root, 'backend.zip');
  fs.writeFileSync(file, 'archive');
  const verifier = new ArtifactVerifier({ applicationRoot: root });
  const result = await verifier.verifyArtifact({ filePath: file, kind: 'archive' });
  assert.equal(result.status, 'unverified');
  assert.equal(result.executable, false);
});
