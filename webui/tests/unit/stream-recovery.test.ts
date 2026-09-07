import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderService } from '$lib/services/provider.service';
import { StreamReducer } from '$lib/utils/stream-reducer';

describe('stream recovery and observability', () => {
	afterEach(() => {
		vi.useRealTimers();
		ProviderService.configureStreamMonitoring({ heartbeatTimeoutMs: 120000, onMetrics: undefined });
		vi.unstubAllGlobals();
	});

	it('recovers from malformed SSE without forwarding raw payloads', () => {
		const reducer = new StreamReducer({ correlationId: 'safe-test' });
		reducer.push('data: {"choices":[] }\ndata: {"secret":"do-not-forward"}\n');
		reducer.push('data: {"choices":[{"delta":{"content":"safe"}}]}\n');

		const result = reducer.getResult();
		expect(result.events.map((event) => event.kind)).toEqual(['error', 'error', 'content']);
		expect(JSON.stringify(result.events)).not.toContain('do-not-forward');
		expect(result.events).toContainEqual({ kind: 'content', text: 'safe' });
	});

	it('makes terminal malformed events and completion idempotent', () => {
		const onEvent = vi.fn();
		const reducer = new StreamReducer({ malformed: 'terminal', onEvent });
		reducer.push('data: {"choices":[]}\ndata: [DONE]\n');
		reducer.push('data: {"choices":[{"delta":{"content":"late"}}]}\n');
		reducer.finish();
		reducer.cancel();

		expect(onEvent).toHaveBeenCalledOnce();
		expect(reducer.getResult().completed).toBe(false);
		expect(reducer.isTerminal).toBe(true);
	});

	it('honors a pre-aborted AbortSignal and reports cancelled metrics', async () => {
		const reader = {
			read: vi.fn(),
			cancel: vi.fn(async () => undefined),
			releaseLock: vi.fn()
		};
		const controller = new AbortController();
		controller.abort();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }));
		const metrics: Array<{ status: string; eventCount: number }> = [];
		ProviderService.configureStreamMonitoring({ onMetrics: (value) => metrics.push(value) });

		const result = await ProviderService.stream({ messages: [], stream: true }, undefined, controller.signal);

		expect(reader.read).not.toHaveBeenCalled();
		expect(reader.cancel).toHaveBeenCalledOnce();
		expect(reader.releaseLock).toHaveBeenCalledOnce();
		expect(result.events).toEqual([]);
		expect(metrics.at(-1)?.status).toBe('cancelled');
	});

	it('emits a safe heartbeat-timeout protocol event and failed metrics', async () => {
		vi.useFakeTimers();
		const reader = {
			read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
			cancel: vi.fn(async () => undefined),
			releaseLock: vi.fn()
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }));
		const events: Array<{ kind: string; message?: string }> = [];
		const metrics: Array<{ status: string; eventCount: number }> = [];
		ProviderService.configureStreamMonitoring({ heartbeatTimeoutMs: 1000, onMetrics: (value) => metrics.push(value) });

		const pending = ProviderService.stream({ messages: [], stream: true }, (event) => events.push(event));
		await vi.advanceTimersByTimeAsync(1000);
		await pending;

		expect(events).toEqual([{ kind: 'protocol-error', message: 'Stream heartbeat timeout.' }]);
		expect(metrics.at(-1)).toMatchObject({ status: 'failed', eventCount: 1 });
		expect(JSON.stringify(metrics)).not.toContain('secret user prompt');
	});

	it('emits privacy-safe metrics without request content or provider error bodies', async () => {
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"private prompt output"}}]}\n'));
				controller.close();
			}
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
		const metrics: unknown[] = [];
		ProviderService.configureStreamMonitoring({ onMetrics: (value) => metrics.push(value) });
		await ProviderService.stream({ messages: [{ role: 'user', content: 'secret user prompt' }], stream: true }, undefined);

		const serialized = JSON.stringify(metrics);
		expect(serialized).not.toContain('private prompt output');
		expect(serialized).not.toContain('secret user prompt');
		expect(metrics.at(-1)).toMatchObject({ eventCount: 1, contentChars: 21, status: 'completed' });
	});
});
