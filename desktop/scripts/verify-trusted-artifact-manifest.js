#!/usr/bin/env node
/* eslint-env node */
const fs = require('node:fs');
const path = require('node:path');
const { loadTrustedArtifactManifest } = require('../security/trusted-artifact-manifest');

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error('Usage: node verify-trusted-artifact-manifest.js --manifest FILE --public-key FILE [--signature FILE]');
  process.exit(2);
}

function value(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function main() {
  const args = process.argv.slice(2);
  const manifestPath = value(args, '--manifest');
  const publicKeyPath = value(args, '--public-key');
  const signaturePath = value(args, '--signature');
  if (!manifestPath || !publicKeyPath) usage('Both --manifest and --public-key are required');
  const resolvedManifest = path.resolve(manifestPath);
  const resolvedKey = path.resolve(publicKeyPath);
  if (!fs.existsSync(resolvedKey)) usage(`Public key does not exist: ${resolvedKey}`);
  const manifest = loadTrustedArtifactManifest(resolvedManifest, {
    publicKeyPath: resolvedKey,
    ...(signaturePath ? { signaturePath: path.resolve(signaturePath) } : {})
  });
  if (!manifest?.trusted) {
    console.error('Minisign manifest verification failed; release blocked.');
    process.exit(1);
  }
  for (const [reference, entry] of Object.entries(manifest.entries)) {
    if (!/^sha256:[a-f0-9]{64}$/i.test(`sha256:${entry.digest.value}`) || entry.digest.algorithm !== 'sha256') {
      console.error(`Invalid SHA-256 entry: ${reference}`);
      process.exit(1);
    }
  }
  console.log(JSON.stringify({ trusted: true, ...manifest.snapshot() }));
}

main();
