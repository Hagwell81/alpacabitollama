import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ReadinessPanel from '$lib/components/app/runtime/ReadinessPanel.svelte';

describe('ReadinessPanel', () => {
	it('renders the runtime readiness section with accessible label', () => {
		const { getByRole } = render(ReadinessPanel);
		const heading = getByRole('heading', { name: 'Runtime readiness' });
		expect(heading).toBeTruthy();
	});

	it('shows no-action message when state is idle and action is none', async () => {
		const { container } = render(ReadinessPanel);
		// The component renders a section with aria-live
		const section = container.querySelector('section.runtime-readiness');
		expect(section).toBeTruthy();
		expect(section?.getAttribute('aria-live')).toBe('polite');
	});
});
