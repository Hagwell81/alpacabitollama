/* eslint-env node */
/**
 * Deterministic, conservative model-fit planning. This module is deliberately
 * pure: it only reads model/hardware data and never changes either object.
 */

const DEFAULT_SAFETY_FRACTION = 0.8;
const DEFAULT_OVERHEAD_FRACTION = 0.15;
const MIN_OVERHEAD_BYTES = 256 * 1024 * 1024;
const BYTES_PER_KV_ELEMENT = 2;
const GPU_BACKENDS = Object.freeze(['cuda', 'rocm', 'vulkan', 'metal', 'opencl']);

function finitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function integerPositive(value) {
  const number = finitePositive(value);
  return number && Number.isInteger(number) ? number : undefined;
}

function metadataValue(model, names) {
  const metadata = model && model.metadata && typeof model.metadata === 'object' ? model.metadata : {};
  for (const name of names) {
    if (metadata[name] !== undefined) return metadata[name];
    if (model && model[name] !== undefined) return model[name];
  }
  return undefined;
}

function numberFrom(model, names) {
  return finitePositive(Number(metadataValue(model, names)));
}

function modelSizeBytes(model) {
  return finitePositive(model && model.sizeBytes)
    || finitePositive(Number(metadataValue(model, ['sizeBytes', 'size_bytes', 'file_size', 'fileSize'])));
}

function contextLimit(model) {
  return integerPositive(model && model.contextLimit)
    || integerPositive(Number(metadataValue(model, ['contextLimit', 'context_length', 'contextLength', 'n_ctx_train'])));
}

function architecture(model) {
  const layers = integerPositive(Number(metadataValue(model, [
    'block_count', 'blockCount', 'n_layer', 'n_layers', 'layers', 'num_layers'
  ])));
  const heads = integerPositive(Number(metadataValue(model, [
    'attention.head_count', 'attention.headCount', 'n_head', 'num_attention_heads', 'heads'
  ])));
  const headDim = integerPositive(Number(metadataValue(model, [
    'attention.key_length', 'attention.keyLength', 'head_dim', 'headDim'
  ]))) || (heads && integerPositive(Number(metadataValue(model, [
    'embedding_length', 'embeddingLength', 'n_embd', 'hidden_size'
  ]))) ? Math.floor(Number(metadataValue(model, [
    'embedding_length', 'embeddingLength', 'n_embd', 'hidden_size'
  ])) / heads) : undefined);
  return { layers, heads, headDim };
}

function normalizeSafetyFraction(value) {
  const fraction = finitePositive(value);
  return fraction && fraction <= 1 ? fraction : DEFAULT_SAFETY_FRACTION;
}

function estimateKvBytes(model, tokens) {
  const { layers, heads, headDim } = architecture(model);
  if (!layers || !heads || !headDim || !tokens) return undefined;
  return Math.ceil(tokens * layers * heads * headDim * 2 * BYTES_PER_KV_ELEMENT);
}

function backendSupportsOffload(hardware) {
  const capabilities = hardware && hardware.backendCapabilities;
  if (!capabilities || typeof capabilities !== 'object') return false;
  return GPU_BACKENDS.some((backend) => capabilities[backend] === true);
}

function chooseAlternatives(model, hardware, options, budgetBytes) {
  const candidates = Array.isArray(options.alternatives)
    ? options.alternatives
    : (Array.isArray(options.catalog) ? options.catalog : []);
  const currentId = model && model.id;
  const usable = candidates.filter((candidate) => candidate && candidate.id !== currentId);
  const result = usable.map((candidate) => {
    const size = modelSizeBytes(candidate);
    return { candidate, size, fits: Boolean(size && budgetBytes && size <= budgetBytes) };
  }).filter((item) => item.fits || (item.candidate.availability === 'available' && item.size === undefined));
  return result.sort((left, right) => {
    const leftSize = left.size || Number.MAX_SAFE_INTEGER;
    const rightSize = right.size || Number.MAX_SAFE_INTEGER;
    return leftSize - rightSize || String(left.candidate.id).localeCompare(String(right.candidate.id));
  }).map((item) => String(item.candidate.id));
}

function evaluateFitPlan(model = {}, hardware = {}, options = {}) {
  const safetyFraction = normalizeSafetyFraction(options.safetyFraction);
  const assumptions = [];
  const estimated = {};
  const allocation = {};
  const limit = contextLimit(model);
  const size = modelSizeBytes(model);
  const usableMemory = finitePositive(hardware.usableMemoryBytes);
  const budget = usableMemory ? Math.floor(usableMemory * safetyFraction) : undefined;
  const acceleratorMemory = finitePositive(hardware.accelerator && hardware.accelerator.memoryBytes);
  const offload = backendSupportsOffload(hardware);

  if (size !== undefined) estimated.weightsBytes = size;
  else assumptions.push('Model size is unavailable; a positive fit cannot be claimed.');
  if (usableMemory === undefined) assumptions.push('Usable system memory is unavailable.');
  if (budget !== undefined) assumptions.push(`Usable memory is limited to ${Math.round(safetyFraction * 100)}% for inference.`);
  if (limit !== undefined) assumptions.push(`Context is capped at the model limit of ${limit} tokens.`);
  else assumptions.push('Model context limit is unavailable.');

  if (size !== undefined) {
    estimated.overheadBytes = Math.max(MIN_OVERHEAD_BYTES, Math.ceil(size * DEFAULT_OVERHEAD_FRACTION));
    assumptions.push('Runtime overhead includes a conservative 15% model-size margin and a 256 MiB floor.');
  }

  const architectureInfo = architecture(model);
  const hasKvArchitecture = Boolean(architectureInfo.layers && architectureInfo.heads && architectureInfo.headDim);
  let contextTokens;
  if (limit !== undefined && hasKvArchitecture) {
    const kvAtLimit = estimateKvBytes(model, limit);
    estimated.kvCacheBytes = kvAtLimit;
    const fixedBytes = (estimated.weightsBytes || 0) + (estimated.overheadBytes || 0);
    const availableForKv = budget === undefined ? undefined : budget - fixedBytes;
    if (availableForKv !== undefined && availableForKv >= 0) {
      const perToken = estimateKvBytes(model, 1);
      contextTokens = Math.min(limit, Math.max(1, Math.floor(availableForKv / perToken)));
      allocation.contextTokens = contextTokens;
      if (contextTokens < limit) assumptions.push('Context is reduced to fit the conservative memory budget.');
    }
  } else {
    assumptions.push('KV-cache architecture metadata is incomplete; KV memory and fit remain unknown.');
  }

  if (offload && acceleratorMemory !== undefined) {
    const gpuBudget = Math.floor(acceleratorMemory * safetyFraction);
    allocation.acceleratorBytes = Math.min(gpuBudget, estimated.weightsBytes || 0);
    const layers = architectureInfo.layers;
    allocation.gpuOffloadLayers = layers && size ? Math.min(layers, Math.floor(layers * allocation.acceleratorBytes / size)) : undefined;
    assumptions.push('GPU offload is considered only because the detected backend and accelerator support it.');
  } else {
    allocation.gpuOffloadLayers = 0;
    assumptions.push(offload ? 'Accelerator memory is unavailable; GPU offload is not claimed.' : 'No supported accelerator offload capability is available; planning uses CPU memory.');
  }

  if (size !== undefined && estimated.overheadBytes !== undefined && estimated.kvCacheBytes !== undefined) {
    estimated.totalBytes = estimated.weightsBytes + estimated.overheadBytes + estimated.kvCacheBytes;
  }
  const totalAtRecommendedContext = contextTokens && hasKvArchitecture
    ? estimated.weightsBytes + estimated.overheadBytes + estimateKvBytes(model, contextTokens)
    : undefined;
  if (totalAtRecommendedContext !== undefined) estimated.totalBytes = totalAtRecommendedContext;

  let status = 'unknown';
  if (size !== undefined && usableMemory !== undefined && limit !== undefined && hasKvArchitecture) {
    const total = totalAtRecommendedContext || estimated.totalBytes;
    status = total <= budget ? (total <= budget * 0.85 ? 'fits' : 'tight') : 'does-not-fit';
  }
  if (status === 'does-not-fit' && contextTokens === 1) assumptions.push('Even the minimum recommended context exceeds the conservative memory budget.');

  const alternatives = chooseAlternatives(model, hardware, options, budget);
  return {
    modelId: String(model.id || ''), status, estimated, allocation,
    assumptions: Array.from(new Set(assumptions)),
    explanation: status === 'fits' ? 'The model fits within the conservative usable-memory budget.'
      : status === 'tight' ? 'The model fits, but leaves a limited memory margin.'
        : status === 'does-not-fit' ? 'The model exceeds the conservative memory budget; choose a smaller model or reduce context.'
          : 'There is not enough verified hardware or model metadata to claim that this model fits.',
    alternatives
  };
}

function createFitPlan(model, hardware, options) { return evaluateFitPlan(model, hardware, options); }

module.exports = {
  DEFAULT_SAFETY_FRACTION,
  DEFAULT_OVERHEAD_FRACTION,
  MIN_OVERHEAD_BYTES,
  evaluateFitPlan,
  createFitPlan,
  estimateKvBytes,
  modelSizeBytes,
  contextLimit,
  architecture,
  backendSupportsOffload
};
