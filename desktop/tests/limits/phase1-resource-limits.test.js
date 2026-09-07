const assert = require('node:assert/strict');
const { AdmissionScheduler } = require('../../scheduling/admission-scheduler');
const { ModelResourceManager } = require('../../scheduling/model-resource-manager');

test('Phase 1 admission limits reject excess work deterministically', async () => {
  const scheduler = new AdmissionScheduler({ maxActive: 1, maxQueued: 1 });
  let release;
  const active = scheduler.enqueue(() => new Promise((resolve) => { release = resolve; }));
  const queued = scheduler.enqueue(() => 'queued');
  await assert.rejects(scheduler.enqueue(() => 'rejected'), (error) => error.code === 'CAPACITY');
  release('active');
  assert.equal(await active, 'active');
  assert.equal(await queued, 'queued');
  assert.equal(scheduler.getCounters().rejected, 1);
});

test('Phase 1 resource manager bounds retained resources', () => {
  const manager = new ModelResourceManager({ maxResources: 1, maxBytes: 10 });
  manager.markLoaded({ id: 'small' }, { bytes: 6 }, { selected: true });
  assert.throws(() => manager.evictForCapacity({ bytes: 6 }), /capacity|resource/i);
  assert.equal(manager.getStatus().loaded, 1);
});
