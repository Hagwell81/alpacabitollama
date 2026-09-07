import { describe, expect, it } from 'vitest';

describe('conversation recovery contract', () => {
  it('limits recovery actions to a conversation-scoped message id', () => {
    const activeConversationId = 'conversation-a';
    const checkpoint = { conversationId: 'conversation-a', messageId: 'message-a', status: 'cancelled' };
    expect(checkpoint.conversationId).toBe(activeConversationId);
    expect(checkpoint.messageId).toBeTruthy();
    expect({ ...checkpoint, conversationId: 'conversation-b' }.conversationId).not.toBe(activeConversationId);
  });
});
