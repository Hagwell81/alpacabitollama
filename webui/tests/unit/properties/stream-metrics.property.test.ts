import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ProviderService } from '$lib/services/provider.service';

// Feature: streaming-reliability
// Property: 12 — Stream timeout and metric privacy
// Validates: Requirements 8.3–8.4, 12.4

describe('Property 12: Stream timeout and metric privacy', () => {
	it('reports bounded, content-free metrics for arbitrary valid content chunks', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.string({ minLength: 1, maxLength: 24 }).filter((value) => !/[\r\n]/.test(value)), { minLength: 1, maxLength: 8 }),
				async (chunks) => {
					const lines = chunks.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`).join('') + 'data: [DONE]\n';
					const body = new ReadableStream({
						start(controller) { controller.enqueue(new TextEncoder().encode(lines)); controller.close(); }
					});
					const oldFetch = globalThis.fetch;
					const metrics: Array<Record<string, unknown>> = [];
					ProviderService.configureStreamMonitoring({ onMetrics: (value) => metrics.push(value as unknown as Record<string, unknown>) });
					(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async () => new Response(body);
					try {
						await ProviderService.stream({ messages: [{ role: 'user', content: 'secret prompt' }], stream: true });
						const serialized = JSON.stringify(metrics);
						expect(serialized).not.toContain('secret prompt');
						expect(metrics.at(-1)).toMatchObject({ eventCount: chunks.length + 1, contentChars: chunks.reduce((total, value) => total + value.length, 0), status: 'completed' });
					} finally {
						globalThis.fetch = oldFetch;
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});
