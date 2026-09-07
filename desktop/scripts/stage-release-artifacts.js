#!/usr/bin/env node
/* eslint-env node */
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_REDIRECTS = 5;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024 * 1024;

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error('Usage: node stage-release-artifacts.js --input release-artifacts.json');
  process.exit(2);
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function validateDeclaration(item) {
  if (!item || typeof item !== 'object') throw new Error('Each artifact declaration must be an object');
  if (typeof item.reference !== 'string' || !item.reference.trim()) throw new Error('Each artifact declaration requires reference');
  if (typeof item.url !== 'string' || !item.url.trim()) throw new Error(`Artifact ${item.reference || '(unknown)'} requires url`);
  if (typeof item.path !== 'string' || !item.path.trim()) throw new Error(`Artifact ${item.reference} requires path`);
  const url = new URL(item.url);
  if (url.protocol !== 'https:') throw new Error(`Artifact ${item.reference} must use an HTTPS URL`);
  if (path.isAbsolute(item.path) || item.path.split(/[\\/]+/).includes('..')) {
    throw new Error(`Artifact ${item.reference} path must be relative and must not traverse parent directories`);
  }
  const colon = item.reference.indexOf(':');
  if (colon <= 0) throw new Error(`Artifact reference must use KIND:REFERENCE: ${item.reference}`);
  return { ...item, url: url.toString() };
}

function requestHttps(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = (options.request || https.get)(url, { headers: { 'User-Agent': 'alpacabitollama-release-stager' } }, (response) => {
      resolve(response);
    });
    request.on('error', reject);
  });
}

async function downloadHttps(url, destination, options = {}, redirects = 0) {
  const response = await requestHttps(url, options);
  const status = response.statusCode || 0;
  if (status >= 300 && status < 400 && response.headers.location) {
    response.resume();
    if (redirects >= MAX_REDIRECTS) throw new Error(`Too many HTTPS redirects while downloading ${url}`);
    const redirected = new URL(response.headers.location, url);
    if (redirected.protocol !== 'https:') throw new Error(`Refusing non-HTTPS redirect for ${url}`);
    return downloadHttps(redirected.toString(), destination, options, redirects + 1);
  }
  if (status !== 200) {
    response.resume();
    throw new Error(`Artifact download returned HTTP ${status} for ${url}`);
  }
  const declaredLength = Number(response.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTIFACT_BYTES) {
    response.resume();
    throw new Error(`Artifact exceeds the ${MAX_ARTIFACT_BYTES} byte limit: ${url}`);
  }

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination, { flags: 'wx' });
    let bytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      reject(error);
    };
    response.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_ARTIFACT_BYTES) {
        response.destroy(new Error(`Artifact exceeds the ${MAX_ARTIFACT_BYTES} byte limit: ${url}`));
      }
    });
    response.on('error', fail);
    output.on('error', fail);
    output.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    response.pipe(output);
  });
}

async function stageArtifacts(inputPath, options = {}) {
  const resolvedInput = path.resolve(inputPath);
  const declarations = JSON.parse(fs.readFileSync(resolvedInput, 'utf8'));
  if (!Array.isArray(declarations) || declarations.length === 0) throw new Error('Artifact declarations must be a non-empty JSON array');
  const root = options.root || process.cwd();
  for (const raw of declarations) {
    const item = validateDeclaration(raw);
    const destination = path.resolve(root, item.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      await downloadHttps(item.url, temporary, options);
      fs.renameSync(temporary, destination);
      console.log(`Staged ${item.reference} at ${item.path}`);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
      throw error;
    }
  }
}

async function main() {
  const input = argumentValue(process.argv.slice(2), '--input');
  if (!input) usage('--input is required');
  try {
    await stageArtifacts(input);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { MAX_ARTIFACT_BYTES, MAX_REDIRECTS, downloadHttps, stageArtifacts, validateDeclaration };
