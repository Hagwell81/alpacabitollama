import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ConversationRecovery from '$lib/components/app/chat/ConversationRecovery.svelte';

describe('ConversationRecovery', () => {
	it('renders recovery title and error message', () => {
		const { getByText } = render(ConversationRecovery, {
			status: 'failed' as const,
			error: 'Server crashed'
		});
		expect(getByText('Conversation needs recovery')).toBeTruthy();
	});

	it('shows context-overflow title for context-overflow status', () => {
		const { getByText } = render(ConversationRecovery, {
			status: 'context-overflow' as const
		});
		expect(getByText('Context limit reached')).toBeTruthy();
	});

	it('shows Continue button only for interrupted/cancelled status', () => {
		const { getByRole } = render(ConversationRecovery, {
			status: 'interrupted' as const
		});
		expect(getByRole('button', { name: 'Continue' })).toBeTruthy();
		expect(getByRole('button', { name: 'Retry' })).toBeTruthy();
	});

	it('shows Reduce context button only for context-overflow status', () => {
		const { getByRole } = render(ConversationRecovery, {
			status: 'context-overflow' as const
		});
		expect(getByRole('button', { name: 'Reduce context' })).toBeTruthy();
		expect(() => getByRole('button', { name: 'Continue' })).toThrow();
	});

	it('uses role=status for accessibility', () => {
		const { container } = render(ConversationRecovery, {
			status: 'failed' as const
		});
		const section = container.querySelector('section[role="status"]');
		expect(section).toBeTruthy();
	});
});
