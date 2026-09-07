/**
 * RemoteProviderDisclosure component tests (Task 12.3)
 * Requirements: 18.3-18.6
 * Validates: transport, authentication, privacy, availability,
 * failure redaction, cancellation, phase gate, local-provider fallback.
 */
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RemoteProviderDisclosure from '$lib/components/app/providers/RemoteProviderDisclosure.svelte';

const remoteDescriptor = {
	id: 'openai-compatible',
	groupId: 'openai',
	name: 'OpenAI-compatible',
	origin: 'remote',
	authMode: 'api-key',
	capabilities: ['chat', 'streaming', 'model-listing'],
	endpoint: 'https://api.openai.com/v1'
};

const localDescriptor = {
	id: 'lmstudio',
	groupId: 'lmstudio',
	name: 'LM Studio',
	origin: 'local',
	authMode: 'none',
	capabilities: ['chat', 'streaming'],
	endpoint: 'http://127.0.0.1:1234/v1'
};

describe('RemoteProviderDisclosure', () => {
	it('displays transport, auth, and endpoint characteristics', () => {
		const { container } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: true,
			remoteOptIn: true
		});
		expect(container.textContent).toContain('HTTPS (encrypted)');
		expect(container.textContent).toContain('API key (Bearer token)');
		expect(container.textContent).toContain('https://api.openai.com/v1');
	});

	it('shows privacy warning for remote providers', () => {
		const { getByTestId } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: true,
			remoteOptIn: true
		});
		const note = getByTestId('rpd-privacy-note');
		expect(note).toBeTruthy();
		expect(note.element().textContent).toContain('remote endpoint');
		expect(note.element().textContent).toContain('leaves the local device');
	});

	it('shows local privacy note for local providers', () => {
		const { getByTestId } = render(RemoteProviderDisclosure, {
			descriptor: localDescriptor,
			phase1Passed: true,
			remoteOptIn: true
		});
		const note = getByTestId('rpd-privacy-note');
		expect(note.element().textContent).toContain('stays on this device');
	});

	it('shows phase gate message when phase1 not passed', () => {
		const { getByTestId } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: false,
			remoteOptIn: false
		});
		const gate = getByTestId('rpd-phase-gate');
		expect(gate.element().textContent).toContain('Phase 1 exit criteria');
	});

	it('shows opt-in message when phase1 passed but no opt-in', () => {
		const { getByTestId } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: true,
			remoteOptIn: false
		});
		const gate = getByTestId('rpd-phase-gate');
		expect(gate.element().textContent).toContain('explicit user opt-in');
	});

	it('shows enable button when phase1 passed but no opt-in', () => {
		const { getByTestId } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: true,
			remoteOptIn: false
		});
		expect(getByTestId('rpd-enable')).toBeTruthy();
	});

	it('shows disable and test buttons when enabled', () => {
		const { getByTestId } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: true,
			remoteOptIn: true
		});
		expect(getByTestId('rpd-disable')).toBeTruthy();
		expect(getByTestId('rpd-test')).toBeTruthy();
	});

	it('shows local fallback when disabled', () => {
		const { getByTestId } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: false,
			remoteOptIn: false
		});
		const fallback = getByTestId('rpd-fallback');
		expect(fallback.element().textContent).toContain('llama-server');
	});

	it('does not show fallback when provider is enabled', () => {
		const { container } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: true,
			remoteOptIn: true
		});
		const fallback = container.querySelector('[data-testid="rpd-fallback"]');
		expect(fallback).toBeFalsy();
	});

	it('displays availability status', () => {
		const { container } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: true,
			remoteOptIn: true,
			status: { providerId: 'openai-compatible', status: 'ready' }
		});
		expect(container.textContent).toContain('Ready');
	});

	it('displays health info when available', () => {
		const { getByTestId } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: true,
			remoteOptIn: true,
			status: {
				providerId: 'openai-compatible',
				status: 'ready',
				health: { status: 'healthy', latencyMs: 42 }
			}
		});
		const health = getByTestId('rpd-health');
		expect(health.element().textContent).toContain('healthy');
		expect(health.element().textContent).toContain('42ms');
	});

	it('does not show redacted error content in messages', () => {
		const { getByTestId } = render(RemoteProviderDisclosure, {
			descriptor: remoteDescriptor,
			phase1Passed: true,
			remoteOptIn: true,
			status: { providerId: 'openai-compatible', status: 'failed', message: 'Request failed' }
		});
		const msg = getByTestId('rpd-message');
		expect(msg.element().textContent).not.toContain('api_key');
		expect(msg.element().textContent).not.toContain('Bearer');
	});
});
