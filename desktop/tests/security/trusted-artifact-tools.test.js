const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createMinisignTestKeyPair } = require('./minisign-test-key');
const { canonicalize } = require('../../security/trusted-artifact-manifest');

const root = path.resolve(__dirname, '../..');
const generator = path.join(root, 'scripts/generate-trusted-artifact-manifest.js');
const verifier = path.join(root, 'scripts/verify-trusted-artifact-manifest.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true, ...options });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result;
}

test('release tooling generates and verifies a detached Minisign manifest without exposing the private key', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-release-tools-'));
  try {
    const { publicPath: publicKeyPath, privatePath: privateKeyPath } = createMinisignTestKeyPair(directory);
    const artifactPath = path.join(directory, 'backend.tar.gz');
    const declarationsPath = path.join(directory, 'artifacts.json');
    const manifestPath = path.join(directory, 'trusted-artifacts.json');
    const signaturePath = `${manifestPath}.minisig`;
    fs.writeFileSync(artifactPath, 'release artifact');
    fs.writeFileSync(declarationsPath, JSON.stringify([{ reference: 'archive:v1/backend.tar.gz', path: artifactPath }]));
    const generated = run(process.execPath, [generator, '--out', manifestPath, '--signature', signaturePath, '--private-key-env', 'TEST_MINISIGN_KEY', '--artifact-list', declarationsPath], {
      env: { ...process.env, TEST_MINISIGN_KEY: fs.readFileSync(privateKeyPath, 'utf8') }
    });
    assert.equal(generated.stdout.includes('PRIVATE KEY'), false);
    assert.equal(fs.existsSync(signaturePath), true);
    const checked = run(process.execPath, [verifier, '--manifest', manifestPath, '--public-key', publicKeyPath, '--signature', signaturePath]);
    assert.match(checked.stdout, /"trusted":true/);
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const canonicalPath = path.join(directory, 'canonical-payload');
    fs.writeFileSync(canonicalPath, canonicalize(parsed));
    run('minisign', ['-V', '-p', publicKeyPath, '-m', canonicalPath, '-x', signaturePath], { cwd: directory });
    assert.equal(parsed.entries['archive:v1/backend.tar.gz'].digest.algorithm, 'sha256');
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'signature'), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
