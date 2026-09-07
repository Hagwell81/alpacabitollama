/* eslint-env node */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
let AdmZip;
try { AdmZip = require('adm-zip'); } catch (_) { AdmZip = null; }

const DEFAULT_LIMITS = Object.freeze({ maxEntries: 10000, maxUncompressedBytes: 4 * 1024 ** 3, maxEntryBytes: 2 * 1024 ** 3 });

function assertInside(root, candidate) {
  const rootPath = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) throw new Error('Archive path escapes the application data directory');
  return resolved;
}
function validateEntry(name) {
  if (typeof name !== 'string' || !name || name.includes('\0') || path.posix.isAbsolute(name) || path.win32.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name)) throw new Error(`Unsafe archive entry: ${String(name)}`);
  const normalized = name.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) throw new Error(`Unsafe archive entry: ${name}`);
  return normalized;
}
function run(command, args, cwd) {
  return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; let err = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; }); child.on('error', reject); child.on('close', (code) => code === 0 ? resolve({ out, err }) : reject(new Error(`${command} failed (${code}): ${err.slice(0, 1000)}`))); });
}
async function inspectTar(archive, limits) {
  const { out } = await run('tar', ['-tzvf', archive]);
  const entries = out.split(/\r?\n/).filter(Boolean);
  if (entries.length > limits.maxEntries) throw new Error('Archive contains too many entries');
  let total = 0;
  for (const line of entries) { const match = line.match(/^\S+\s+\S+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/); const size = match ? Number(match[1]) : 0; const name = match ? match[2] : line; validateEntry(name); if (size > limits.maxEntryBytes || (total += size) > limits.maxUncompressedBytes) throw new Error('Archive exceeds extraction limits'); if (line.startsWith('l') || line.startsWith('h')) throw new Error('Symlink and hardlink archive entries are not allowed'); }
}
async function inspectZip(archive, limits) {
  if (!AdmZip) throw new Error('ZIP extraction support is unavailable');
  const entries = new AdmZip(archive).getEntries();
  if (entries.length > limits.maxEntries) throw new Error('Archive contains too many entries');
  let total = 0;
  for (const entry of entries) {
    validateEntry(entry.entryName);
    const mode = (entry.header.externalFileAttributes >>> 16) & 0xf000;
    if (mode === 0xa000) throw new Error('Symlink archive entries are not allowed');
    const size = Number(entry.header.size || 0);
    if (size > limits.maxEntryBytes || (total += size) > limits.maxUncompressedBytes) throw new Error('Archive exceeds extraction limits');
  }
}
async function extractArchive({ archivePath, destination, applicationRoot, limits = {} }) {
  const root = path.resolve(applicationRoot); const archive = assertInside(root, archivePath); const finalDestination = assertInside(root, destination); const merged = { ...DEFAULT_LIMITS, ...limits };
  if (!fs.existsSync(archive)) throw new Error('Archive does not exist');
  const isZip = archive.toLowerCase().endsWith('.zip'); const isTar = archive.toLowerCase().endsWith('.tar.gz'); if (!isZip && !isTar) throw new Error('Unsupported archive format');
  if (isZip) await inspectZip(archive, merged); else await inspectTar(archive, merged);
  fs.mkdirSync(path.dirname(finalDestination), { recursive: true }); const temp = fs.mkdtempSync(path.join(path.dirname(finalDestination), `.${path.basename(finalDestination)}-extract-`));
  try {
    if (isZip) new AdmZip(archive).extractAllTo(temp, true); else await run('tar', ['-xzf', archive, '-C', temp, '--no-same-owner', '--no-same-permissions']);
    const files = [];
    const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); assertInside(temp, full); if (entry.isSymbolicLink()) throw new Error('Symlink archive entries are not allowed'); if (entry.isDirectory()) walk(full); else if (entry.isFile()) { const size = fs.statSync(full).size; if (size > merged.maxEntryBytes) throw new Error('Archive entry exceeds size limit'); files.push(full); } } };
    walk(temp); if (files.length > merged.maxEntries) throw new Error('Archive contains too many entries');
    if (fs.existsSync(finalDestination)) fs.rmSync(finalDestination, { recursive: true, force: true }); fs.renameSync(temp, finalDestination); return finalDestination;
  } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
}
module.exports = { extractArchive, validateEntry, assertInside, DEFAULT_LIMITS };
