import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/database.service', () => ({
  DatabaseService: {
    markActiveStreamsInterrupted: vi.fn().mockResolvedValue(0),
    saveStreamingCheckpoint: vi.fn().mockResolvedValue(undefined),
    deleteStreamingCheckpoint: vi.fn().mockResolvedValue(undefined),
    listStreamingCheckpoints: vi.fn().mockResolvedValue([])
  }
}));

import { StreamingStore, MAX_CHECKPOINT_CONTENT } from '$lib/stores/streaming.svelte';

describe('request-keyed streaming state', () => {
  it('isolates conversations and bounds checkpoint content', () => {
    const store = new StreamingStore();
    const first = store.begin('conversation-a', 'message-a');
    const second = store.begin('conversation-b', 'message-b');
    store.update(first.requestId, { content: 'x'.repeat(MAX_CHECKPOINT_CONTENT + 50) });
    expect(store.getForConversation('conversation-a')[0].content).toHaveLength(MAX_CHECKPOINT_CONTENT);
    expect(store.getForConversation('conversation-a')[0].messageId).toBe('message-a');
    expect(store.getForConversation('conversation-b')[0].content).toBe('');
    expect(first.requestId).not.toBe(second.requestId);
  });

  it('reconciles terminal completion and removes completed persistence', async () => {
    const store = new StreamingStore();
    const state = store.begin('conversation-a', 'message-a');
    store.update(state.requestId, { content: 'partial' });
    await store.finish(state.requestId, 'completed', 'final');
    expect(store.states.get(state.requestId)?.status).toBe('completed');
  });
});
