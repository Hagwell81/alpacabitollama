import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderService } from '$lib/services/provider.service';
import { ChatService } from '$lib/services/chat.service';

describe('ProviderService', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('normalizes a non-stream response while preserving model, reasoning, and tool calls', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						model: 'local-model',
						choices: [
							{
								message: {
									content: 'answer',
									reasoning_content: 'thought',
									tool_calls: [
										{
											index: 0,
											id: 'call-1',
											type: 'function',
											function: { name: 'search', arguments: '{}' }
										}
									]
								}
							}
						]
					})
				)
			)
		);

		const result = await ProviderService.complete({ messages: [], stream: false });
		expect(result).toMatchObject({
			model: 'local-model',
			content: 'answer',
			reasoningContent: 'thought'
		});
		expect(result.toolCalls?.[0]?.function?.name).toBe('search');
	});

	it('normalizes SSE events and forwards the abort signal', async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						'data: {"model":"router-model","choices":[{"delta":{"content":"hi"}}]}\n'
					)
				);
				controller.enqueue(
					new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"why"}}]}\n')
				);
				controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
				controller.close();
			}
		});
		const fetchMock = vi.fn().mockResolvedValue(new Response(stream));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const events: string[] = [];

		await ProviderService.stream(
			{ messages: [], stream: true },
			(event) => {
				if (event.kind === 'content' || event.kind === 'reasoning') events.push(event.text);
			},
			controller.signal
		);

		expect(events).toEqual(['hi', 'why']);
		expect(fetchMock).toHaveBeenCalledWith(
			'./v1/chat/completions',
			expect.objectContaining({ signal: controller.signal })
		);
	});
	it('recovers from malformed and invalid SSE events without emitting content', async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						'data: {not-json}\n' +
							'data: {"choices":[]}\n' +
							'data: {"choices":[{"delta":{"content":"recovered"}}]}\n' +
							'data: [DONE]\r\n'
					)
				);
				controller.close();
			}
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
		const events: ReturnType<typeof ProviderService.normalizeStreamLine>[] = [];

		await ProviderService.stream({ messages: [], stream: true }, (event) => events.push(event));

		expect(events).toEqual([
			{ kind: 'protocol-error', message: 'Malformed provider stream event.' },
			{ kind: 'content', text: 'recovered' },
			{ kind: 'complete' }
		]);
		expect(events.some((event) => event?.kind === 'content' && event.text.includes('not'))).toBe(
			false
		);
	});

	it('preserves prompt progress and timings as one normalized event', () => {
		expect(
			ProviderService.normalizeStreamLine(
				'data: {"prompt_progress":{"prompt_tokens":12,"prompt_eval_count":12},"choices":[{"delta":{}}]} '
			)
		).toEqual({
			kind: 'timings',
			promptProgress: { prompt_tokens: 12, prompt_eval_count: 12 },
			timings: undefined,
			model: undefined
		});
	});

	it('extracts content from events that also carry timings (return_progress mode)', () => {
		// When return_progress is enabled, llama-server includes timings in
		// content events. Content must be extracted, not dropped as timings.
		expect(
			ProviderService.normalizeStreamLine(
				'data: {"choices":[{"delta":{"content":"hello"}}],"timings":{"predicted_n":5}}'
			)
		).toEqual({
			kind: 'content',
			text: 'hello',
			model: undefined
		});
		expect(
			ProviderService.normalizeStreamLine(
				'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}],"timings":{"predicted_n":3}}'
			)
		).toEqual({
			kind: 'reasoning',
			text: 'thinking',
			model: undefined
		});
	});

	it('returns a complete event for a terminal event without delta', () => {
		expect(
			ProviderService.normalizeStreamLine('data: {"choices":[{"finish_reason":"stop"}]}')
		).toEqual({
			kind: 'complete',
			finishReason: 'stop',
			model: undefined
		});
		expect(ProviderService.normalizeStreamLine('data: null')).toEqual({
			kind: 'protocol-error',
			message: 'Malformed stream event.'
		});
	});

	it('completes only once when finish reason and DONE are both received', async () => {
		const stream = vi
			.spyOn(ProviderService, 'stream')
			.mockImplementation(async (_request, onEvent) => {
				onEvent?.({ kind: 'content', text: 'answer' });
				onEvent?.({ kind: 'complete', finishReason: 'stop' });
				onEvent?.({ kind: 'complete' });
				return { model: undefined, events: [] };
			});
		const onComplete = vi.fn();

		await (
			ChatService as unknown as {
				handleNormalizedStream: (
					request: unknown,
					onChunk: unknown,
					onComplete: (
						response: string,
						reasoningContent?: string,
						timings?: object,
						toolCalls?: string
					) => void
				) => Promise<void>;
			}
		).handleNormalizedStream({ messages: [], stream: true }, undefined, onComplete);

		expect(onComplete).toHaveBeenCalledOnce();
		expect(onComplete).toHaveBeenCalledWith('answer', undefined, undefined, undefined);
		stream.mockRestore();
	});
});
