import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import HealthView from '$lib/components/app/runtime/HealthView.svelte';

describe('HealthView', () => {
	it('renders the runtime health section with accessible label', () => {
		const { getByRole } = render(HealthView);
		const heading = getByRole('heading', { name: 'Runtime health' });
		expect(heading).toBeTruthy();
	});

	it('shows health information unavailable message when no data', () => {
		const { container } = render(HealthView);
		const section = container.querySelector('section[aria-labelledby="runtime-health-title"]');
		expect(section).toBeTruthy();
		// The default text when no health data is available
		expect(section?.textContent).toContain('Health information unavailable');
	});
});
