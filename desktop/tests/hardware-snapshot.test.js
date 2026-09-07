import assert from 'node:assert';
import { createRequire } from 'node:module';
import { describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createHardwareSnapshot,
  normalizeConfidence,
  normalizeBackendCapabilities
} = require('../planning/hardware-snapshot');

describe('hardware snapshot', () => {
  it('normalizes complete hardware and preserves backend capability identity', async () => {
    const snapshot = await createHardwareSnapshot({
      now: 123,
      probes: {
        cpu: () => ({ logicalCores: 8, architecture: 'x64', model: 'Test CPU', avx2: true }),
        accelerator: () => ({ vendor: 'NVIDIA', name: 'Test GPU', driver: '555.1', memoryBytes: 8 * 1024 ** 3 }),
        memory: () => 16 * 1024 ** 3,
        os: () => ({ platform: 'win32', release: '11', arch: 'x64' }),
        backendCapabilities: () => ({ cpu: true, cuda: true, vulkan: false })
      }
    });

    assert.deepStrictEqual(snapshot.cpu, {
      logicalCores: 8, architecture: 'x64', model: 'Test CPU', avx2: true
    });
    assert.strictEqual(snapshot.accelerator.driver, '555.1');
    assert.strictEqual(snapshot.usableMemoryBytes, 16 * 1024 ** 3);
    assert.deepStrictEqual(snapshot.os, { platform: 'win32', release: '11', arch: 'x64' });
    assert.deepStrictEqual(snapshot.backendCapabilities, { cpu: true, cuda: true, vulkan: false });
    assert.strictEqual(snapshot.confidence, 'known');
    assert.strictEqual(snapshot.capturedAt, 123);
  });

  it('keeps legacy capability fields while adding normalized backend fields', async () => {
    const snapshot = await createHardwareSnapshot({
      legacyCapabilities: { cpu: true, cuda: true, nvidiaDriverVersion: '550.2' },
      probes: {
        cpu: () => ({ logicalCores: 4 }),
        accelerator: () => null,
        memory: () => 4,
        os: () => ({ platform: 'linux', arch: 'x64' }),
        backendCapabilities: () => ({ cpu: true })
      }
    });

    assert.deepStrictEqual(snapshot.backendCapabilities, { cpu: true, cuda: true });
    assert.strictEqual(snapshot.accelerator, null);
  });

  it('does not reject when individual probes fail and never invents missing values', async () => {
    const snapshot = await createHardwareSnapshot({
      probes: {
        cpu: () => { throw new Error('cpu unavailable'); },
        accelerator: () => Promise.reject(new Error('gpu unavailable')),
        memory: () => { throw new Error('memory unavailable'); },
        os: () => { throw new Error('os unavailable'); },
        backendCapabilities: () => { throw new Error('backend unavailable'); }
      }
    });

    assert.deepStrictEqual(snapshot.cpu, {});
    assert.strictEqual(snapshot.accelerator, undefined);
    assert.strictEqual(snapshot.usableMemoryBytes, undefined);
    assert.deepStrictEqual(snapshot.os, {});
    assert.deepStrictEqual(snapshot.backendCapabilities, {});
    assert.strictEqual(snapshot.confidence, 'unknown');
  });

  it('normalizes confidence conservatively', () => {
    assert.strictEqual(normalizeConfidence(undefined, {}), 'unknown');
    assert.strictEqual(normalizeConfidence(undefined, { cpu: { logicalCores: 2 } }), 'partial');
    assert.strictEqual(normalizeConfidence('known', {}), 'known');
    assert.deepStrictEqual(normalizeBackendCapabilities({ cuda: true }, { cuda: false, rocm: true }), { cuda: true, rocm: true });
  });
});
