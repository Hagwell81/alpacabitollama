#!/usr/bin/env node
/* eslint-env node */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const evidenceDirectory = path.join(root, 'artifacts', 'phase1-evidence');
const evidencePath = path.join(evidenceDirectory, 'release-results.json');

function run(name, cwd, command, args) {
  // On Windows, .cmd files (like npm.cmd) require shell: true to be found
  // and executed. On other platforms, shell: false is fine for direct binaries.
  const requiresShell = process.platform === 'win32' && /\.cmd$/i.test(command);
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: requiresShell });
  const record = {
    name,
    command: [command, ...args].join(' '),
    passed: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout || '').slice(-20000),
    stderr: String(result.stderr || '').slice(-20000)
  };
  fs.writeFileSync(path.join(evidenceDirectory, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function main() {
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const desktop = path.join(root, 'desktop');
  const webui = path.join(root, 'webui');
  const manifest = path.join(desktop, 'resources', 'trusted-artifacts.json');
  const publicKey = path.join(desktop, 'resources', 'trusted-artifacts-public-key.pem');
  const checks = {
    artifactTrust: run('artifact-trust', desktop, process.execPath, ['scripts/verify-trusted-artifact-manifest.js', '--manifest', manifest, '--public-key', publicKey]),
    migrationRecovery: run('migration-recovery', desktop, npmCommand, ['test', '--', '--run', 'tests/config/versioned-config-store.test.js']),
    cancellationPrivacy: run('cancellation-privacy', desktop, npmCommand, ['test', '--', '--run', 'tests/security/artifact-verifier.test.js', 'tests/integration/phase1-runtime.integration.test.js']),
    resourceLimits: run('resource-limits', desktop, npmCommand, ['test', '--', '--run', 'tests/limits/phase1-resource-limits.test.js']),
    regressionSuite: {
      name: 'regression-suite',
      passed: false,
      checks: [
        run('regression-desktop', desktop, npmCommand, ['test', '--', '--run']),
        run('regression-webui-check', webui, npmCommand, ['run', 'check']),
        run('regression-webui-lint', webui, npmCommand, ['run', 'lint']),
        run('regression-webui-unit', webui, npmCommand, ['run', 'test:unit', '--', '--run'])
      ]
    }
  };
  checks.regressionSuite.passed = checks.regressionSuite.checks.every((check) => check.passed);
  const releaseResults = Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, check.passed]));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseResults,
    checks
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ evidencePath, releaseResults }, null, 2));
  process.exit(releaseResults.artifactTrust && releaseResults.migrationRecovery && releaseResults.cancellationPrivacy && releaseResults.resourceLimits && releaseResults.regressionSuite ? 0 : 1);
}

main();
