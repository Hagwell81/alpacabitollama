import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
	markActiveStreamsInterrupted: vi.fn().mockResolvedValue(0),
	saveStreamingCheckpoint: vi.fn().mockResolvedValue(undefined),
	deleteStreamingCheckpoint: vi.fn().mockResolvedValue(undefined),
	listStreamingCheckpoints: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/services/database.service', () => ({ DatabaseService: database }));

import { MAX_CHECKPOINT_CONTENT, StreamingStore } from '$lib/stores/streaming.svelte';

// Feature: streaming-reliability
// Property: 17 — Streaming state isolation and round trip
// Validates: Requirements 13.1–13.2, 13.7

describe('Property 17: Streaming state isolation and round trip', () => {
	it('keeps generated requests isolated, bounded, and terminally stable', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.record({ conversation: fc.constantFrom('a', 'b'), content: fc.string({ maxLength: 300 }) }), { minLength: 1, maxLength: 20 }),
				async (updates) => {
					const store = new StreamingStore();
					const first = store.begin('a', 'message-a');
					const second = store.begin('b', 'message-b');
					for (const update of updates) store.update(update.conversation === 'a' ? first.requestId : second.requestId, { content: update.content });
					await store.finish(first.requestId, 'cancelled');
					await store.finish(second.requestId, 'failed');
					const a = store.getForConversation('a');
					const b = store.getForConversation('b');
					expect(a).toHaveLength(1);
					expect(b).toHaveLength(1);
					expect(a[0].conversationId).toBe('a');
					expect(b[0].conversationId).toBe('b');
					expect(a[0].content.length).toBeLessThanOrEqual(MAX_CHECKPOINT_CONTENT);
					expect(b[0].content.length).toBeLessThanOrEqual(MAX_CHECKPOINT_CONTENT);
					expect(store.update(first.requestId, { content: 'late' })?.content).not.toBe('late');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('round-trips every terminal status without deleting non-completed checkpoints', async () => {
		await fc.assert(
			fc.asyncProperty(fc.constantFrom('cancelled', 'failed', 'interrupted' as const), async (status) => {
				vi.clearAllMocks();
				const store = new StreamingStore();
				const state = store.begin('conversation', 'message');
				store.update(state.requestId, { content: 'partial' });
				await store.finish(state.requestId, status);
				expect(store.states.get(state.requestId)?.status).toBe(status);
				expect(database.deleteStreamingCheckpoint).not.toHaveBeenCalled();
			})
		);
	});
});
