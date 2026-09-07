const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { stageArtifacts, validateDeclaration } = require('../../scripts/stage-release-artifacts.js');

function mockResponse(statusCode, headers, body = '') {
  const stream = Readable.from([body]);
  stream.statusCode = statusCode;
  stream.headers = headers;
  return stream;
}

function mockRequest(responses) {
  return (_url, _options, callback) => {
    const next = responses.shift();
    process.nextTick(() => callback(next));
    return { on() { return this; } };
  };
}

test('rejects non-HTTPS artifact URLs and invalid paths', () => {
  assert.throws(() => validateDeclaration({ reference: 'archive:v1/file', url: 'http://example.test/file', path: 'release-assets/file' }), /HTTPS/);
  assert.throws(() => validateDeclaration({ reference: 'archive:v1/file', url: 'https://example.test/file', path: '../file' }), /relative/);
  assert.throws(() => validateDeclaration({ reference: 'archive:v1/file', path: 'release-assets/file' }), /requires url/);
});

test('stages bytes from an HTTPS response and follows an HTTPS redirect', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-stage-artifacts-'));
  try {
    const input = path.join(directory, 'declarations.json');
    const target = 'release-assets/backend.tar.gz';
    fs.writeFileSync(input, JSON.stringify([{ reference: 'archive:v1/backend.tar.gz', url: 'https://source.example/backend.tar.gz', path: target }]));
    const request = mockRequest([
      mockResponse(302, { location: 'https://cdn.example/backend.tar.gz' }),
      mockResponse(200, { 'content-length': '15' }, 'release artifact')
    ]);
    await stageArtifacts(input, { root: directory, request });
    assert.equal(fs.readFileSync(path.join(directory, target), 'utf8'), 'release artifact');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a non-HTTPS redirect and does not expose environment secrets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-stage-artifacts-'));
  const secret = 'do-not-log-private-key';
  const originalError = console.error;
  const errors = [];
  console.error = (message) => errors.push(String(message));
  try {
    const input = path.join(directory, 'declarations.json');
    fs.writeFileSync(input, JSON.stringify([{ reference: 'archive:v1/backend.tar.gz', url: 'https://source.example/backend.tar.gz', path: 'release-assets/backend.tar.gz' }]));
    await assert.rejects(
      stageArtifacts(input, {
        root: directory,
        request: mockRequest([mockResponse(302, { location: 'http://unsafe.example/backend.tar.gz' })])
      }),
      /non-HTTPS redirect/
    );
    assert.equal(errors.join('\n').includes(secret), false);
  } finally {
    console.error = originalError;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
