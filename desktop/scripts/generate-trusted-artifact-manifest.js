#!/usr/bin/env node
/* eslint-env node */
const crypto = require('node:crypto');
const path = require('node:path');
const fileSystem = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const MINISIGN_SECRET_KEY_BYTES = 158;

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error('Usage: node generate-trusted-artifact-manifest.js --out FILE --private-key-env ENV --artifact KIND:REFERENCE=FILE [...]');
  process.exit(2);
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseArtifacts(args) {
  const artifacts = [];
  const artifactList = argumentValue(args, '--artifact-list');
  if (artifactList) {
    const listPath = path.resolve(artifactList);
    if (!fileSystem.existsSync(listPath)) usage(`Artifact list does not exist: ${listPath}`);
    let parsed;
    try { parsed = JSON.parse(fileSystem.readFileSync(listPath, 'utf8')); } catch (_) { usage(`Artifact list is not valid JSON: ${listPath}`); }
    if (!Array.isArray(parsed)) usage('Artifact list must be a JSON array');
    for (const item of parsed) {
      if (!item || typeof item.reference !== 'string' || typeof item.path !== 'string') usage('Each artifact list item requires reference and path');
      const filePath = path.resolve(item.path);
      const colon = item.reference.indexOf(':');
      if (colon <= 0 || !fileSystem.existsSync(filePath) || !fileSystem.statSync(filePath).isFile()) usage(`Artifact must use KIND:REFERENCE and point to an existing file: ${item.reference}`);
      artifacts.push({ key: item.reference, filePath, kind: item.reference.slice(0, colon) });
    }
  }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--artifact') continue;
    const value = args[++index];
    const separator = value?.lastIndexOf('=');
    if (!value || separator <= 0) usage(`Invalid artifact declaration: ${value || '(missing)'}`);
    const reference = value.slice(0, separator);
    const filePath = path.resolve(value.slice(separator + 1));
    const colon = reference.indexOf(':');
    if (colon <= 0 || !fileSystem.existsSync(filePath) || !fileSystem.statSync(filePath).isFile()) {
      usage(`Artifact must use KIND:REFERENCE=existing-file: ${value}`);
    }
    artifacts.push({ key: reference, filePath, kind: reference.slice(0, colon) });
  }
  if (artifacts.length === 0) usage('At least one --artifact or --artifact-list is required');
  return artifacts;
}

function digest(filePath) {
  return crypto.createHash('sha256').update(fileSystem.readFileSync(filePath)).digest('hex');
}

function decodeBase64(value) {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error('Invalid Minisign private-key encoding');
  return decoded;
}

function parseUnencryptedMinisignSecret(secretText) {
  const lines = String(secretText || '').trim().split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ')) throw new Error('Invalid Minisign private-key format');
  const encoded = decodeBase64(lines[1].trim());
  if (encoded.length !== MINISIGN_SECRET_KEY_BYTES || encoded.subarray(0, 2).toString() !== 'Ed' || encoded.subarray(2, 4).some((value) => value !== 0) || encoded.subarray(4, 6).toString() !== 'B2') {
    if (encoded.subarray(2, 4).some((value) => value !== 0)) throw new Error('Encrypted Minisign keys cannot be used non-interactively; provide an unencrypted CI signing key');
    throw new Error('Invalid or unsupported Minisign private-key format');
  }
  const keyId = encoded.subarray(54, 62);
  const secret = encoded.subarray(62, 126);
  const checksum = encoded.subarray(126, 158);
  const expected = crypto.createHash('blake2b512').update(Buffer.concat([Buffer.from('Ed'), keyId, secret])).digest().subarray(0, 32);
  if (checksum.length !== 32 || !crypto.timingSafeEqual(checksum, expected)) throw new Error('Minisign private-key checksum failed');
  return { keyId, seed: secret.subarray(0, 32) };
}

function signMinisign(data, secretText, fileName) {
  const parsed = parseUnencryptedMinisignSecret(secretText);
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, parsed.seed]), format: 'der', type: 'pkcs8' });
  const hashedMessage = crypto.createHash('blake2b512').update(data).digest();
  const primarySignature = crypto.sign(null, hashedMessage, privateKey);
  const primary = Buffer.concat([Buffer.from('ED'), parsed.keyId, primarySignature]);
  const trustedComment = `timestamp:${Math.floor(Date.now() / 1000)}\tfile:${path.basename(fileName)}\thashed`;
  const globalSignature = crypto.sign(null, Buffer.concat([primarySignature, Buffer.from(trustedComment, 'utf8')]), privateKey);
  return `untrusted comment: signature from minisign secret key\n${primary.toString('base64')}\ntrusted comment: ${trustedComment}\n${globalSignature.toString('base64')}\n`;
}

/**
 * Signs data using the external `minisign` CLI. This is used as a fallback when
 * the private key is encrypted (the in-process signer cannot decrypt keys
 * protected by a passphrase without libsodium). The passphrase is read from the
 * MINISIGN_PRIVATE_KEY_PASSWORD env var and piped to minisign via stdin.
 *
 * @param {Buffer} data - The canonical payload to sign.
 * @param {string} secretText - The minisign secret key file contents.
 * @param {string} fileName - Base name of the manifest file (for trusted comment).
 * @returns {string} The minisign signature file contents.
 */
function signMinisignExternal(data, secretText, fileName) {
  const tempDir = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'minisign-ext-'));
  try {
    const keyPath = path.join(tempDir, 'secret.key');
    const payloadPath = path.join(tempDir, 'payload.json');
    const sigPath = path.join(tempDir, 'payload.json.minisig');
    fileSystem.writeFileSync(keyPath, secretText, { mode: 0o600 });
    fileSystem.writeFileSync(payloadPath, data);
    const passphrase = process.env.MINISIGN_PRIVATE_KEY_PASSWORD || '';
    const minisignArgs = ['-S', '-s', keyPath, '-m', payloadPath, '-x', sigPath];
    const result = spawnSync('minisign', minisignArgs, {
      input: passphrase + '\n',
      encoding: 'utf8',
      timeout: 30000,
    });
    if (result.error) {
      throw new Error(`minisign CLI not found or failed: ${result.error.message}. Install minisign or provide an unencrypted key.`);
    }
    if (result.status !== 0) {
      throw new Error(`minisign CLI exited with code ${result.status}: ${result.stderr || result.stdout}`);
    }
    return fileSystem.readFileSync(sigPath, 'utf8');
  } finally {
    fileSystem.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Signs data, automatically choosing between in-process and external CLI
 * signing based on whether the key is encrypted.
 */
function signManifest(data, secretText, fileName) {
  try {
    return signMinisign(data, secretText, fileName);
  } catch (error) {
    if (error.message && error.message.includes('Encrypted Minisign keys')) {
      console.log('Private key is encrypted; falling back to external minisign CLI for signing.');
      return signMinisignExternal(data, secretText, fileName);
    }
    throw error;
  }
}

function writeAtomic(filePath, content) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fileSystem.writeFileSync(temporary, content, { mode: 0o644 });
  fileSystem.renameSync(temporary, filePath);
}

function main() {
  const args = process.argv.slice(2);
  const outputPath = argumentValue(args, '--out');
  const privateKeyEnv = argumentValue(args, '--private-key-env') || 'MINISIGN_PRIVATE_KEY';
  const privateKey = process.env[privateKeyEnv];
  if (!outputPath) usage('--out is required');
  if (!privateKey) usage(`Minisign private key is missing from environment variable ${privateKeyEnv}`);

  const resolvedOutput = path.resolve(outputPath);
  const signaturePath = path.resolve(argumentValue(args, '--signature') || `${resolvedOutput}.minisig`);
  const temporaryDirectory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'alpacabitollama-minisign-'));
  try {
    const entries = {};
    for (const artifact of parseArtifacts(args)) {
      entries[artifact.key] = {
        digest: { algorithm: 'sha256', value: digest(artifact.filePath) },
        type: artifact.kind
      };
    }
    const payload = { version: process.env.RELEASE_VERSION || 'unreleased', entries };
    const canonicalPayload = canonicalize(payload);
    const signature = signManifest(Buffer.from(canonicalPayload, 'utf8'), privateKey, path.basename(resolvedOutput));
    fileSystem.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fileSystem.mkdirSync(path.dirname(signaturePath), { recursive: true });
    writeAtomic(resolvedOutput, `${JSON.stringify(payload, null, 2)}\n`);
    writeAtomic(signaturePath, signature);
    console.log(`Wrote Minisign-signed artifact manifest with ${Object.keys(entries).length} entries to ${resolvedOutput}`);
    console.log(`Wrote detached Minisign signature to ${signaturePath}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    fileSystem.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main();
