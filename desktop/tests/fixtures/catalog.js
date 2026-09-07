/* eslint-env node */
// Plain catalog records used by merge, identity, stale-source, ordering, and
// snapshot serializer tests. They intentionally contain no filesystem secrets.
const digest = (value) => ({ algorithm: 'sha256', value, verified: true });

function model(overrides = {}) {
  return {
    id: 'local-model',
    displayName: 'Local Model',
    providerId: 'local',
    providerGroupId: 'Local',
    source: 'local',
    format: 'gguf',
    reference: 'models/local.gguf',
    digest: digest('abc123'),
    verification: 'verified',
    availability: 'available',
    capabilities: ['chat'],
    contextLimit: 4096,
    sizeBytes: 1024,
    metadata: { architecture: 'llama' },
    metadataStatus: { 'general.architecture': 'known' },
    lastSeenAt: 1,
    ...overrides
  };
}

const duplicateDigestAliases = [
  model(),
  model({
    id: 'curated-copy', displayName: 'Curated Copy', providerId: 'curated',
    providerGroupId: 'Curated', source: 'curated', reference: 'manifest://local-model'
  })
];
const changedDigestArtifacts = [
  model({ id: 'original', reference: 'models/original.gguf', digest: digest('bytes-v1') }),
  model({ id: 'changed', reference: 'models/changed.gguf', digest: digest('bytes-v2') })
];
const orderedSources = {
  discovery: [model({ id: 'zeta', displayName: 'Zeta', providerId: 'remote', providerGroupId: 'Remote', source: 'discovery', reference: 'zeta', digest: digest('zzz') })],
  local: [model({ id: 'alpha', displayName: 'Alpha', reference: 'models/alpha.gguf', digest: digest('aaa') })],
  curated: [model({ id: 'curated', displayName: 'Curated', providerId: 'curated', providerGroupId: 'Curated', source: 'curated', reference: 'curated://model', digest: digest('ccc') })],
  router: [model({ id: 'router', displayName: 'Router', providerId: 'router', providerGroupId: 'Router', source: 'router', reference: 'router://model', digest: digest('rrr') })]
};

module.exports = {
  digest,
  model,
  duplicateDigestAliases,
  changedDigestArtifacts,
  orderedSources,
  unavailableLocal: { local: { error: { code: 'E_OFFLINE', message: 'Local scan failed', retryable: true } } }
};
