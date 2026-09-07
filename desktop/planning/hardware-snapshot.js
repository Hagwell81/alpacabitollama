const os = require('os');
const { execFile } = require('child_process');

const CONFIDENCE = Object.freeze(['known', 'partial', 'unknown']);

function isFinitePositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function asString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function settledValue(result) {
  return result && result.status === 'fulfilled' ? result.value : undefined;
}

function normalizeConfidence(value, { cpu, memory, osIdentity, accelerator } = {}) {
  if (CONFIDENCE.includes(value)) return value;

  const hasCpu = Boolean(cpu && Object.keys(cpu).length);
  const hasOs = Boolean(osIdentity && Object.keys(osIdentity).length);
  const knownCore = hasCpu
    && isFinitePositiveNumber(memory)
    && Boolean(osIdentity && osIdentity.platform && osIdentity.arch);
  if (knownCore && accelerator !== undefined) return 'known';
  if (knownCore || hasCpu || isFinitePositiveNumber(memory) || hasOs) return 'partial';
  return 'unknown';
}

function normalizeCpu(value) {
  if (!value || typeof value !== 'object') return {};
  const logicalCores = Number.isInteger(value.logicalCores) && value.logicalCores > 0
    ? value.logicalCores
    : undefined;
  return {
    ...(logicalCores === undefined ? {} : { logicalCores }),
    ...(asString(value.architecture) ? { architecture: asString(value.architecture) } : {}),
    ...(asString(value.model) ? { model: asString(value.model) } : {}),
    ...(typeof value.avx2 === 'boolean' ? { avx2: value.avx2 } : {}),
    ...(typeof value.avx512 === 'boolean' ? { avx512: value.avx512 } : {})
  };
}

function normalizeAccelerator(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  for (const key of ['vendor', 'name', 'driver', 'driverVersion', 'backend']) {
    const normalized = asString(value[key]);
    if (normalized) result[key] = normalized;
  }
  if (isFinitePositiveNumber(value.memoryBytes)) result.memoryBytes = value.memoryBytes;
  return result;
}

function normalizeOs(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...(asString(source.platform) ? { platform: asString(source.platform) } : {}),
    ...(asString(source.arch) ? { arch: asString(source.arch) } : {}),
    ...(asString(source.release) ? { release: asString(source.release) } : {}),
    ...(asString(source.version) ? { version: asString(source.version) } : {})
  };
}

function normalizeBackendCapabilities(value, legacy = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const capabilities = {};
  for (const name of ['cpu', 'cuda', 'rocm', 'vulkan', 'metal', 'opencl', 'cpuAVX2', 'cpuAVX512']) {
    if (typeof source[name] === 'boolean') capabilities[name] = source[name];
    else if (typeof legacy[name] === 'boolean') capabilities[name] = legacy[name];
  }
  return capabilities;
}

function safeExecFile(file, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout);
    });
  });
}

function defaultProbes() {
  return {
    cpu: () => ({
      logicalCores: os.cpus().length || undefined,
      architecture: process.arch,
      model: os.cpus()[0] && os.cpus()[0].model
    }),
    memory: () => os.freemem(),
    os: () => ({ platform: process.platform, release: os.release(), arch: process.arch }),
    accelerator: async () => {
      // The legacy capability detector remains authoritative for backend choice.
      // This lightweight probe only enriches the snapshot when platform tools exist.
      if (process.platform === 'win32') {
        const output = await safeExecFile('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits']);
        if (output && output.trim()) {
          const [name, driver, memory] = output.trim().split(/\s*,\s*/);
          return { vendor: 'nvidia', name, driver, memoryBytes: Number(memory) * 1024 * 1024 };
        }
      }
      return null;
    },
    backendCapabilities: () => ({ cpu: true })
  };
}

/**
 * Capture a normalized hardware snapshot. Probe functions may return values or
 * promises; a failed probe is intentionally treated as missing information.
 * `legacyCapabilities` lets callers retain the existing detector and backend
 * selection without changing its IPC response shape.
 */
async function createHardwareSnapshot(options = {}) {
  const probes = { ...defaultProbes(), ...(options.probes || {}) };
  const legacyCapabilities = options.legacyCapabilities && typeof options.legacyCapabilities === 'object'
    ? options.legacyCapabilities
    : {};

  const results = await Promise.allSettled([
    Promise.resolve().then(() => probes.cpu()),
    Promise.resolve().then(() => probes.accelerator()),
    Promise.resolve().then(() => probes.memory()),
    Promise.resolve().then(() => probes.os()),
    Promise.resolve().then(() => probes.backendCapabilities())
  ]);
  const [cpuResult, acceleratorResult, memoryResult, osResult, backendResult] = results.map(settledValue);
  const cpu = normalizeCpu(cpuResult);
  const accelerator = normalizeAccelerator(acceleratorResult);
  const osIdentity = normalizeOs(osResult);
  const usableMemoryBytes = isFinitePositiveNumber(memoryResult) ? memoryResult : undefined;
  const backendCapabilities = normalizeBackendCapabilities(backendResult, legacyCapabilities);
  const confidence = normalizeConfidence(options.confidence, {
    cpu,
    memory: usableMemoryBytes,
    osIdentity,
    accelerator
  });

  return {
    cpu,
    ...(accelerator !== undefined ? { accelerator } : {}),
    ...(usableMemoryBytes === undefined ? {} : { usableMemoryBytes }),
    os: osIdentity,
    backendCapabilities,
    confidence,
    capturedAt: typeof options.now === 'number' ? options.now : Date.now()
  };
}

function detectHardwareSnapshot(options = {}) {
  return createHardwareSnapshot(options);
}

module.exports = {
  CONFIDENCE,
  createHardwareSnapshot,
  detectHardwareSnapshot,
  normalizeConfidence,
  normalizeCpu,
  normalizeAccelerator,
  normalizeBackendCapabilities,
  normalizeOs
};
