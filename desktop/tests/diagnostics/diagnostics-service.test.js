/* eslint-env node */
const assert = require('assert');
const { PassThrough } = require('stream');
// Vitest globals are enabled by desktop/vitest.config.js.
const { DiagnosticsService } = require('../../diagnostics/diagnostics-service');
const { redactDiagnostic } = require('../../diagnostics/redactor');

describe('DiagnosticsService', () => {
  it('emits required structured fields and preserves safe operational evidence', () => {
    const service = new DiagnosticsService({ maxRecords: 10, maxBytes: 10000, clock: () => '2025-01-01T00:00:00.000Z' });
    const record = service.record({ severity: 'error', subsystem: 'provider', operation: 'health', correlationId: 'corr-1', runtimeState: 'failed', providerId: 'local', modelId: 'model.gguf', error: { code: 'PROVIDER_AUTH', message: 'authorization: Bearer secret /Users/alice/model.gguf', retryable: false, recoveryAction: 'Retry' } });
    assert.deepStrictEqual(Object.keys(record).slice(0, 8), ['timestamp', 'severity', 'subsystem', 'operation', 'correlationId', 'runtimeState', 'providerId', 'modelId']);
    assert.strictEqual(record.error.code, 'PROVIDER_AUTH');
    assert.ok(!JSON.stringify(record).includes('secret'));
    assert.ok(!JSON.stringify(record).includes('/Users/alice'));
  });

  it('omits content, secrets, paths, headers, and disabled metrics recursively', () => {
    const output = redactDiagnostic({ message: 'private prompt', headers: { authorization: 'secret' }, request: { content: 'response' }, apiKey: 'abc', privatePath: '/home/alice/x', promptTokens: 12, nested: { reasoning: 'hidden', safe: 'kept' } });
    const serialized = JSON.stringify(output);
    assert.ok(!serialized.includes('private prompt'));
    assert.ok(!serialized.includes('secret'));
    assert.ok(!serialized.includes('response'));
    assert.ok(!serialized.includes('/home/alice'));
    assert.ok(!serialized.includes('promptTokens'));
    assert.strictEqual(output.nested.safe, 'kept');
  });

  it('enforces count and UTF-8 byte bounds oldest-first', () => {
    const service = new DiagnosticsService({ maxRecords: 2, maxBytes: 10000 });
    service.record({ correlationId: 'first', operation: 'one' });
    service.record({ correlationId: 'second', operation: 'two' });
    service.record({ correlationId: 'third', operation: 'three' });
    assert.deepStrictEqual(service.getRecords().map((item) => item.correlationId), ['second', 'third']);
  });

  it('projects only safe renderer health fields and latest redacted error', () => {
    const service = new DiagnosticsService();
    service.record({ severity: 'error', error: { code: 'X', message: 'bad /Users/a', retryable: true, recoveryAction: 'Retry', correlationId: 'corr-x' } });
    const health = service.getHealthProjection({ runtime: { state: 'ready', provider: 'local', model: { id: 'm' }, secret: 'no' }, scheduler: { active: 1, queued: 2 }, providers: [{ providerId: 'local', status: 'ready', endpoint: 'http://u:p@host' }] }, { artifactVerification: 'verified' });
    assert.deepStrictEqual(health, { readiness: 'ready', runtimeState: 'ready', activeProvider: 'local', activeModel: 'm', activeRequests: 1, queuedRequests: 2, providers: [{ providerId: 'local', status: 'ready', checkedAt: null }], artifactVerification: 'verified', latestError: { code: 'X', message: 'bad [REDACTED_PATH]', retryable: true, recoveryAction: 'Retry', correlationId: 'corr-x' } });
  });

  it('exports redacted records incrementally as NDJSON', async () => {
    const service = new DiagnosticsService({ clock: () => 'now' });
    service.record({ operation: 'chat', prompt: 'do not export', correlationId: 'corr-export' });
    const stream = new PassThrough(); const chunks = []; stream.on('data', (chunk) => chunks.push(chunk));
    const result = await service.exportToStream(stream);
    const lines = Buffer.concat(chunks).toString('utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(result.recordCount, 1);
    assert.strictEqual(lines[0].format, 'alpacabitollama-diagnostics');
    assert.strictEqual(lines[1].correlationId, 'corr-export');
    assert.ok(!JSON.stringify(lines).includes('do not export'));
  });
});
