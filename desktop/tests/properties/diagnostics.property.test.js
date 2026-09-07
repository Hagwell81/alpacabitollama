/* eslint-env node */
const assert = require('node:assert/strict');
const test = globalThis.test;
const fc = require('fast-check');
const { DiagnosticsService } = require('../../diagnostics/diagnostics-service');

const identifier = fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/);
const secret = fc.stringMatching(/^[A-Za-z0-9_-]{8,24}$/);
const content = fc.string({ minLength: 1, maxLength: 40 }).filter((value) => value.trim().length > 0);

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 16: Privacy-safe diagnostics projection
// **Validates: Requirements 12.1, 12.3-12.6**

test('redacts generated content, secrets, private paths, and disabled metrics before persistence', () => {
  fc.assert(
    fc.property(identifier, secret, content, fc.boolean(), (providerId, secretValue, rawContent, metricsEnabled) => {
      const contentValue = `forbidden-content-${rawContent}`;
      const service = new DiagnosticsService({ maxRecords: 10, maxBytes: 10000, metricsEnabled, clock: () => '2026-01-01T00:00:00.000Z' });
      const record = service.record({
        subsystem: 'generated',
        operation: 'property',
        providerId,
        message: contentValue,
        content: contentValue,
        apiKey: secretValue,
        authorization: `Bearer ${secretValue}`,
        privatePath: `/home/${providerId}/private/model.gguf`,
        promptTokens: 12,
        completionTokens: 8,
        safeValue: providerId
      });
      const serialized = JSON.stringify(record);
      assert.ok(!serialized.includes(contentValue));
      assert.ok(!serialized.includes(secretValue));
      assert.ok(!serialized.includes(`/home/${providerId}/private/model.gguf`));
      assert.equal(record.providerId, providerId);
      assert.equal(record.safeValue, providerId);
      if (metricsEnabled) assert.equal(record.promptTokens, 12);
      else assert.equal(Object.prototype.hasOwnProperty.call(record, 'promptTokens'), false);
    }),
    { numRuns: 120 }
  );
});

test('keeps generated diagnostics bounded and projects only safe health data', () => {
  fc.assert(
    fc.property(fc.array(identifier, { minLength: 4, maxLength: 12 }), (ids) => {
      const service = new DiagnosticsService({ maxRecords: 3, maxBytes: 5000, clock: () => '2026-01-01T00:00:00.000Z' });
      ids.forEach((providerId) => service.record({ providerId, operation: 'health', safe: true }));
      const records = service.getRecords();
      assert.ok(records.length <= 3);
      const health = service.projectHealth({
        runtime: { state: 'ready', provider: ids.at(-1), model: 'local-model' },
        scheduler: { active: 1, queued: 2 },
        providers: [{ providerId: ids.at(-1), status: 'available', checkedAt: 'now', secret: 'must-not-project' }]
      });
      assert.equal(health.runtimeState, 'ready');
      assert.equal(health.activeProvider, ids.at(-1));
      assert.equal(health.activeRequests, 1);
      assert.equal(health.queuedRequests, 2);
      assert.ok(!JSON.stringify(health).includes('must-not-project'));
    }),
    { numRuns: 120 }
  );
});
