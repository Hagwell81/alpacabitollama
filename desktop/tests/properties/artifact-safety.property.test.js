/* eslint-env node */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = globalThis.test;
const fc = require('fast-check');
const {
  deterministicIdentity,
  ownedPath
} = require('../../security/artifact-verifier');
const { validateEntry, assertInside } = require('../../security/safe-extractor');

const safeSegment = fc.stringMatching(/^[a-zA-Z0-9._-]{1,20}$/);
const digestValue = fc.stringMatching(/^[0-9a-f]{64}$/);
const safeRelativeEntry = fc.array(safeSegment, { minLength: 1, maxLength: 4 }).map((parts) => `${parts.join('/')}.gguf`);

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 13: Artifact identity and path safety
// **Validates: Requirements 9.5-9.6**

test('canonicalizes verified identities and keeps unverified identities contextual', () => {
  fc.assert(
    fc.property(digestValue, safeSegment, safeSegment, safeSegment, (value, kind, source, reference) => {
      const digest = { algorithm: 'SHA256', value, verified: true };
      const identity = deterministicIdentity({ digest, kind, source, reference });
      assert.equal(identity, `digest:sha256:${value.toLowerCase()}`);
      assert.equal(deterministicIdentity({ digest, kind: 'other', source: 'other', reference: 'other' }), identity);

      const fallback = deterministicIdentity({ digest: { algorithm: 'sha256', value, verified: false }, kind, source, reference });
      assert.match(fallback, /^artifact:[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/);
      assert.notEqual(fallback, identity);
    }),
    { numRuns: 120 }
  );
});

test('confines generated artifact and archive paths to the application root', () => {
  fc.assert(
    fc.property(safeSegment, safeRelativeEntry, (segment, entry) => {
      const root = path.resolve(path.join('phase1-artifacts', segment));
      const descendant = path.join(root, 'downloads', entry);
      assert.equal(ownedPath(root, descendant), path.resolve(descendant));
      assert.equal(assertInside(root, descendant), path.resolve(descendant));
      assert.equal(assertInside(root, root), root);
      assert.throws(() => ownedPath(root, root), /inside the application data directory/);
      assert.throws(() => ownedPath(root, path.join(path.dirname(root), 'outside', entry)), /inside the application data directory/);
      assert.throws(() => assertInside(root, path.join(path.dirname(root), 'outside', entry)), /escapes/);
    }),
    { numRuns: 120 }
  );
});

test('rejects generated unsafe archive entry forms', () => {
  fc.assert(
    fc.property(safeSegment, (segment) => {
      assert.equal(validateEntry(`nested/${segment}.gguf`), `nested/${segment}.gguf`);
      for (const unsafe of [
        `../${segment}.gguf`,
        `nested/../${segment}.gguf`,
        `/${segment}.gguf`,
        `\\${segment}.gguf`,
        `C:\\${segment}.gguf`,
        `nested/${segment}\0.gguf`
      ]) assert.throws(() => validateEntry(unsafe), /Unsafe archive entry/);
    }),
    { numRuns: 120 }
  );
});
