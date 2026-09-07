import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
	markActiveStreamsInterrupted: vi.fn().mockResolvedValue(0),
	saveStreamingCheckpoint: vi.fn().mockResolvedValue(undefined),
	deleteStreamingCheckpoint: vi.fn().mockResolvedValue(undefined),
	listStreamingCheckpoints: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/services/database.service', () => ({ DatabaseService: database }));

import { MAX_CHECKPOINT_CONTENT, StreamingStore } from '$lib/stores/streaming.svelte';

describe('checkpoint recovery and isolation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		database.listStreamingCheckpoints.mockResolvedValue([]);
	});

	it('coalesces updates inside the checkpoint interval and forces terminal persistence', async () => {
		const store = new StreamingStore();
		const state = store.begin('conversation-a', 'message-a');
		await Promise.resolve();
		const writesAfterBegin = database.saveStreamingCheckpoint.mock.calls.length;
		store.update(state.requestId, { content: 'first' });
		store.update(state.requestId, { content: 'latest' });
		await Promise.resolve();

		expect(database.saveStreamingCheckpoint).toHaveBeenCalledTimes(writesAfterBegin);
		await store.finish(state.requestId, 'cancelled');
		expect(database.saveStreamingCheckpoint.mock.calls.at(-1)?.[0]).toMatchObject({
			requestId: state.requestId,
			content: 'latest',
			status: 'cancelled'
		});
	});

	it('bounds content and reasoning while preserving request and conversation identity', () => {
		const store = new StreamingStore();
		const a = store.begin('conversation-a', 'message-a');
		const b = store.begin('conversation-b', 'message-b');
		const updated = store.update(a.requestId, {
			content: 'c'.repeat(MAX_CHECKPOINT_CONTENT + 10),
			reasoning: 'r'.repeat(MAX_CHECKPOINT_CONTENT + 10)
		});

		expect(updated?.content).toHaveLength(MAX_CHECKPOINT_CONTENT);
		expect(updated?.reasoning).toHaveLength(MAX_CHECKPOINT_CONTENT);
		expect(store.getForConversation('conversation-a').map((item) => item.requestId)).toEqual([a.requestId]);
		expect(store.getForConversation('conversation-b').map((item) => item.requestId)).toEqual([b.requestId]);
	});

	it.each(['completed', 'cancelled', 'failed', 'interrupted'] as const)('round-trips %s terminal state', async (status) => {
		const store = new StreamingStore();
		const state = store.begin('conversation-a', 'message-a');
		store.update(state.requestId, { content: 'partial answer', reasoning: 'partial thought' });
		await store.finish(state.requestId, status);

		expect(store.states.get(state.requestId)?.status).toBe(status);
		expect(database.saveStreamingCheckpoint.mock.calls.at(-1)?.[0]).toMatchObject({ status, content: 'partial answer' });
		if (status === 'completed') expect(database.deleteStreamingCheckpoint).toHaveBeenCalledWith(state.requestId);
		else expect(database.deleteStreamingCheckpoint).not.toHaveBeenCalled();
	});

	it('marks active streams interrupted during restart and restores only the selected conversation', async () => {
		database.markActiveStreamsInterrupted.mockResolvedValueOnce(2);
		const interrupted = { requestId: 'old', conversationId: 'conversation-a', content: 'old output', reasoning: '', checkpointSequence: 1, createdAt: 1, updatedAt: 2, status: 'interrupted' as const };
		database.listStreamingCheckpoints.mockResolvedValueOnce([interrupted]);
		const store = new StreamingStore();
		await store.initialize();
		await store.initialize();
		await store.restoreConversation('conversation-a');

		expect(database.markActiveStreamsInterrupted).toHaveBeenCalledOnce();
		expect(store.getForConversation('conversation-a')).toEqual([interrupted]);
		expect(store.getForConversation('conversation-b')).toEqual([]);
	});
});
