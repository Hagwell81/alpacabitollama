/* eslint-env node */
const assert = require('assert');
const test = globalThis.test;
const fc = require('fast-check');
const {
  CAPABILITIES,
  createProviderDescriptor,
  normalizeListing,
  normalizeReadiness,
  normalizeHealth,
  normalizeStatus,
  normalizeStreamResult,
  normalizeCancellation
} = require('../../providers');
const { ProviderRegistry } = require('../../providers/provider-registry');
const { LlamaServerProvider } = require('../../providers/llama-server-provider');

const nonEmptyText = fc.string({ minLength: 1, maxLength: 16 })
  .filter((value) => value.trim().length > 0);
const providerId = nonEmptyText.map((value) => `provider-${value}`);
const capabilityValue = fc.oneof(
  fc.constantFrom(...CAPABILITIES),
  nonEmptyText
);
const capabilityList = fc.array(capabilityValue, { maxLength: 14 });
const operationCases = fc.constantFrom(
  { operation: 'chat', capability: 'chat' },
  { operation: 'stream', capability: 'streaming' },
  { operation: 'list-models', capability: 'model-listing' },
  { operation: 'ensure-ready', capability: 'readiness' },
  { operation: 'health', capability: 'readiness' },
  { operation: 'cancel', capability: 'cancellation' },
  { operation: 'capabilities', capability: 'tools' }
);

function assertEquivalent(normalize, raw, correlationId) {
  const rawResult = normalize(raw, correlationId);
  const envelopeResult = normalize({ success: true, data: raw }, correlationId);
  assert.deepStrictEqual(envelopeResult, rawResult);
  assert.strictEqual(rawResult.success, true);
  assert.strictEqual(rawResult.correlationId, correlationId);
  return rawResult;
}


// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 3: Provider normalization and capability refusal
// **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 18.1, 18.6**

test('normalizes provider descriptors to safe, stable capability shapes', () => {
  fc.assert(
    fc.property(providerId, nonEmptyText, capabilityList, nonEmptyText, (id, groupId, inputCapabilities, name) => {
      const descriptor = createProviderDescriptor({
        id,
        groupId,
        name,
        capabilities: inputCapabilities
      });
      const expected = [...new Set(inputCapabilities.map(String).filter((value) => CAPABILITIES.includes(value)))];
      assert.deepStrictEqual(descriptor.capabilities, expected);
      assert.strictEqual(descriptor.id, id);
      assert.strictEqual(descriptor.groupId, groupId);
      assert.ok(CAPABILITIES.includes(descriptor.capabilities[0]) || descriptor.capabilities.length === 0);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(descriptor, 'endpoint'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(descriptor, 'modelId'), false);
    }),
    { numRuns: 100 }
  );
});

test('normalizes equivalent raw and success-enveloped common provider responses', () => {
  fc.assert(
    fc.property(
      providerId,
      nonEmptyText,
      fc.integer({ min: 0, max: 100000 }),
      fc.boolean(),
      (id, modelId, number, flag) => {
        const correlationId = 'property-3-correlation';
        assertEquivalent(normalizeListing, {
          models: [{ id: modelId, providerId: id, metadata: { number, flag } }],
          nextCursor: modelId
        }, correlationId);
        assertEquivalent(normalizeReadiness, {
          providerId: id, modelId, state: flag ? 'ready' : 'starting'
        }, correlationId);
        assertEquivalent(normalizeHealth, {
          providerId: id, status: flag ? 'healthy' : 'degraded', latencyMs: number
        }, correlationId);
        assertEquivalent(normalizeStatus, {
          providerId: id, status: flag ? 'ready' : 'unavailable'
        }, correlationId);
        assertEquivalent(normalizeStreamResult, {
          status: flag ? 'completed' : 'cancelled', events: [{ kind: 'content', text: modelId }], metrics: { number }
        }, correlationId);
        assertEquivalent(normalizeCancellation, { cancelled: flag }, correlationId);
      }
    ),
    { numRuns: 100 }
  );
});

test('refuses unsupported capabilities before registry or local adapter invocation', async () => {
  await fc.assert(
    fc.asyncProperty(providerId, capabilityList, operationCases, async (id, capabilities, requested) => {
      const supported = [...new Set(capabilities.map(String).filter((value) => CAPABILITIES.includes(value)))];
      fc.pre(!supported.includes(requested.capability));

      let registryCalls = 0;
      const registry = new ProviderRegistry();
      registry.register({
        descriptor: () => ({ id, origin: 'loopback', capabilities: supported }),
        [requested.operation]: async () => { registryCalls += 1; return { ok: true }; }
      });
      const registryResult = await registry.invoke(id, requested.operation, [], { capability: requested.capability });
      assert.strictEqual(registryResult.success, false);
      assert.strictEqual(registryResult.error.code, 'PROVIDER_UNSUPPORTED_CAPABILITY');
      assert.deepStrictEqual(registryResult.error.details, {
        providerId: id, capability: requested.capability, operation: requested.operation
      });
      assert.strictEqual(registryCalls, 0);

      if (requested.operation === 'chat' || requested.operation === 'stream') {
        let fetchCalls = 0;
        const local = new LlamaServerProvider({ providerId: id, fetch: async () => {
          fetchCalls += 1;
          throw new Error('unsupported capability must not fetch');
        } });
        const originalDescriptor = local.descriptor.bind(local);
        local.descriptor = () => ({ ...originalDescriptor(), capabilities: supported });
        const result = requested.operation === 'chat'
          ? await local.chat({ messages: [] })
          : await local.stream({ messages: [] }, () => {});
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error.code, 'PROVIDER_UNSUPPORTED_CAPABILITY');
        assert.strictEqual(fetchCalls, 0);
      }
    }),
    { numRuns: 100 }
  );
});
