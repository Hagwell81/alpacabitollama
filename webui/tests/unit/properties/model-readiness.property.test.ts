import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextRuntimeAction } from '$lib/stores/runtime.svelte';

describe('Feature: model readiness actions', () => {
	it('Property 18: every runtime state maps deterministically to one valid action', () => {
		fc.assert(fc.property(fc.constantFrom('idle', 'acquiring', 'starting', 'ready', 'busy', 'stopping', 'failed', 'cancelling'), fc.boolean(), (state, cancellable) => {
			const action = nextRuntimeAction({ runtime: { state, reason: { cancellable } } });
			expect(['start', 'retry', 'cancel', 'ensure-ready', 'none']).toContain(action);
			expect(nextRuntimeAction({ runtime: { state, reason: { cancellable } } })).toBe(action);
			if ((state === 'stopping' || state === 'cancelling') && action !== 'none') throw new Error('terminal transition must not compete');
		}));
	});
});
