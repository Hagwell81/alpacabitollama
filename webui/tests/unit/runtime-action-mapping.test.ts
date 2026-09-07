import { describe, expect, it } from 'vitest';
import { nextRuntimeAction } from '$lib/stores/runtime.svelte';

describe('runtime action mapping', () => {
  it('maps lifecycle states to safe actions', () => {
    expect(nextRuntimeAction({ runtime: { state: 'idle' } })).toBe('start');
    expect(nextRuntimeAction({ runtime: { state: 'failed' } })).toBe('retry');
    expect(nextRuntimeAction({ runtime: { state: 'busy', reason: { cancellable: true } } })).toBe('cancel');
    expect(nextRuntimeAction({ runtime: { state: 'busy', reason: { cancellable: false } } })).toBe('none');
    expect(nextRuntimeAction({ runtime: { state: 'ready' } })).toBe('ensure-ready');
  });
});
