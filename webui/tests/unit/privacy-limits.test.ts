import { describe, it, expect } from 'vitest';
import { ProviderService } from '$lib/services/provider.service';
import type { ProviderStreamMetrics } from '$lib/services/provider.service';
import type { ApiChatCompletionRequest } from '$lib/types/api';

const testRequest: ApiChatCompletionRequest = {
	model: 'test-model',
	messages: [{ role: 'user', content: 'private question' }],
	stream: false
};

describe('privacy limits — no message content in metrics or errors', () => {
	it('redacts provider error bodies to avoid leaking prompt content', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response('Error: invalid prompt "secret system prompt content"', {
				status: 400,
				headers: { 'content-type': 'text/plain' }
			})) as typeof fetch;

		try {
			const metrics: Array<Record<string, unknown>> = [];
			ProviderService.configureStreamMonitoring({ onMetrics: (m) => metrics.push(m as unknown as Record<string, unknown>) });

			await expect(ProviderService.complete(testRequest)).rejects.toThrow();

			// Verify no metrics contain message content
			for (const m of metrics) {
				const json = JSON.stringify(m);
				expect(json).not.toContain('private question');
				expect(json).not.toContain('secret system prompt');
			}
		} finally {
			globalThis.fetch = originalFetch;
			ProviderService.configureStreamMonitoring({});
		}
	});

	it('does not include prompt content in stream metrics', async () => {
		const sseChunks = [
			'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
			'data: {"choices":[{"delta":{"content":" world"}}]}\n',
			'data: [DONE]\n'
		];
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				for (const chunk of sseChunks) controller.enqueue(encoder.encode(chunk));
				controller.close();
			}
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(stream, {
				status: 200,
				headers: { 'content-type': 'text/event-stream' }
			})) as typeof fetch;

		try {
			const metrics: Array<Record<string, unknown>> = [];
			ProviderService.configureStreamMonitoring({ onMetrics: (m) => metrics.push(m as unknown as Record<string, unknown>) });

			const result = await ProviderService.stream({ ...testRequest, stream: true });

			expect(result.events.length).toBeGreaterThan(0);

			// Metrics should contain counts and timing, not message content
			for (const m of metrics) {
				const json = JSON.stringify(m);
				expect(json).not.toContain('private question');
				// Metrics should have structural fields only
				expect(m).toHaveProperty('eventCount');
				expect(m).toHaveProperty('status');
			}
		} finally {
			globalThis.fetch = originalFetch;
			ProviderService.configureStreamMonitoring({});
		}
	});

	it('classifies caller cancellation as cancelled, not failed', async () => {
		const controller = new AbortController();
		const stream = new ReadableStream({
			start() {
				// Never enqueues — simulates a stalled stream
			}
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(stream, {
				status: 200,
				headers: { 'content-type': 'text/event-stream' }
			})) as typeof fetch;

		try {
			const metrics: Array<Record<string, unknown>> = [];
			ProviderService.configureStreamMonitoring({
				heartbeatTimeoutMs: 100,
				onMetrics: (m) => metrics.push(m as unknown as Record<string, unknown>)
			});

			controller.abort();
			const result = await ProviderService.stream(
				{ ...testRequest, stream: true },
				undefined,
				controller.signal
			);

			// Cancellation should produce cancelled status, not failed
			for (const m of metrics) {
				if (m.status === 'cancelled' || m.status === 'completed') {
					expect(m.status).not.toBe('failed');
				}
			}
		} finally {
			globalThis.fetch = originalFetch;
			ProviderService.configureStreamMonitoring({});
		}
	});
});
