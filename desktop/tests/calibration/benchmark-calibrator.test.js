/* eslint-env node */
/**
 * Benchmark calibrator tests (Task 13.1)
 * Requirements: 19.1-19.2, 19.6
 * Validates: opt-in, pause/cancel, resource limits, summarized results,
 * no prompt/content transmission, clear opt-out.
 */
const assert = require('assert');
const { BenchmarkCalibrator } = require('../../calibration/benchmark-calibrator');

async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.stack || error.message}`); process.exitCode = 1; }
}

(async () => {
  console.log('Benchmark calibrator tests');

  await test('disabled calibrator refuses calibration', async () => {
    const cal = new BenchmarkCalibrator();
    const result = await cal.calibrate({ modelDigest: 'sha256:abc', runner: async () => ({ tokensGenerated: 10, durationMs: 100 }) });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'CALIBRATION_DISABLED');
  });

  await test('enable allows calibration', async () => {
    const cal = new BenchmarkCalibrator();
    cal.enable();
    assert.strictEqual(cal.enabled, true);
    const result = await cal.calibrate({
      modelDigest: 'sha256:abc',
      runner: async () => ({ tokensGenerated: 100, durationMs: 1000 })
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.result.iterations, 5);
  });

  await test('results contain only summarized metrics, no prompts or content', async () => {
    const cal = new BenchmarkCalibrator();
    cal.enable();
    let capturedPrompt = null;
    const result = await cal.calibrate({
      modelDigest: 'sha256:abc',
      runner: async (ctx) => {
        capturedPrompt = ctx.prompt;
        return { tokensGenerated: 50, durationMs: 500 };
      }
    });
    assert.strictEqual(result.success, true);
    const r = result.data.result;
    assert.ok(r.tokensPerSecond !== undefined);
    assert.ok(r.latencyMs !== undefined);
    assert.strictEqual(r.totalTokens, 250);
    // The result should not contain the prompt
    assert.strictEqual(JSON.stringify(r).includes('Calibration benchmark prompt'), false);
  });

  await test('cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    const cal = new BenchmarkCalibrator();
    cal.enable();
    controller.abort();
    const result = await cal.calibrate({
      modelDigest: 'sha256:abc',
      runner: async () => ({ tokensGenerated: 10, durationMs: 100 }),
      signal: controller.signal
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'CALLER_CANCELLED');
  });

  await test('resource limits: maxIterations bounded', async () => {
    const cal = new BenchmarkCalibrator({ maxIterations: 3 });
    cal.enable();
    let count = 0;
    const result = await cal.calibrate({
      modelDigest: 'sha256:abc',
      runner: async () => { count++; return { tokensGenerated: 10, durationMs: 100 }; }
    });
    assert.strictEqual(count, 3);
    assert.strictEqual(result.data.result.iterations, 3);
  });

  await test('disable stops calibration and clears results', async () => {
    const cal = new BenchmarkCalibrator();
    cal.enable();
    await cal.calibrate({
      modelDigest: 'sha256:abc',
      runner: async () => ({ tokensGenerated: 10, durationMs: 100 })
    });
    assert.strictEqual(cal.results().length, 1);
    cal.disable();
    assert.strictEqual(cal.enabled, false);
    assert.strictEqual(cal.results().length, 0);
  });

  await test('pause and resume work correctly', async () => {
    const cal = new BenchmarkCalibrator({ maxIterations: 10 });
    cal.enable();
    let count = 0;
    const promise = cal.calibrate({
      modelDigest: 'sha256:abc',
      runner: async () => { count++; return { tokensGenerated: 10, durationMs: 50 }; }
    });
    // Pause after a short delay
    setTimeout(() => cal.pause(), 80);
    setTimeout(() => cal.resume(), 200);
    const result = await promise;
    assert.strictEqual(result.success, true);
    assert.ok(count <= 10);
  });

  await test('time budget exceeded stops calibration', async () => {
    const cal = new BenchmarkCalibrator({ maxIterations: 100, maxDurationMs: 250 });
    cal.enable();
    let count = 0;
    const result = await cal.calibrate({
      modelDigest: 'sha256:abc',
      runner: async () => { count++; await new Promise(r => setTimeout(r, 80)); return { tokensGenerated: 10, durationMs: 80 }; }
    });
    assert.strictEqual(result.success, true);
    assert.ok(count < 100, `count should be < 100 but was ${count}`);
  });

  await test('missing model digest returns error', async () => {
    const cal = new BenchmarkCalibrator();
    cal.enable();
    const result = await cal.calibrate({ runner: async () => ({ tokensGenerated: 10, durationMs: 100 }) });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'CALIBRATION_MISSING_MODEL');
  });

  await test('missing runner returns error', async () => {
    const cal = new BenchmarkCalibrator();
    cal.enable();
    const result = await cal.calibrate({ modelDigest: 'sha256:abc' });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'CALIBRATION_MISSING_RUNNER');
  });

  console.log('\nBenchmark calibrator tests complete.');
})();
