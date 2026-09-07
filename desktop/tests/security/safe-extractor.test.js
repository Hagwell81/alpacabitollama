const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { validateEntry, assertInside, DEFAULT_LIMITS } = require('../../security/safe-extractor');

test('safe extractor accepts confined relative entries and rejects traversal/absolute paths', () => {
  assert.equal(validateEntry('models/model.gguf'), 'models/model.gguf');
  for (const value of ['../escape', '..\\escape', '/absolute', '\\absolute', 'C:\\escape', '']) {
    assert.throws(() => validateEntry(value), /Unsafe archive entry/);
  }
});

test('safe extractor confines resolved paths and exposes bounded defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-'));
  try {
    assert.equal(assertInside(root, path.join(root, 'out')), path.join(root, 'out'));
    assert.throws(() => assertInside(root, path.join(root, '..', 'outside')), /escapes/);
    assert.equal(DEFAULT_LIMITS.maxEntries > 0, true);
    assert.equal(DEFAULT_LIMITS.maxUncompressedBytes > DEFAULT_LIMITS.maxEntryBytes, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
