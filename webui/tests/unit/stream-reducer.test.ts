import { describe, expect, it, vi } from 'vitest';
import { StreamReducer } from '$lib/utils/stream-reducer';

describe('StreamReducer', () => {
	it('normalizes ordered content, reasoning, tool, timing, model, heartbeat, and completion events', () => {
		const events: string[] = [];
		const reducer = new StreamReducer({
			now: () => 123,
			onEvent: (event) => events.push(event.kind)
		});

		reducer.push(
			': keep-alive\r\n' +
			'data: {"model":"model-a","choices":[{"delta":{"content":"hi"}}]}\n' +
			'data: {"choices":[{"delta":{"reasoning_content":"why","tool_calls":[{"index":0,"id":"call-1"}]} }],"prompt_progress":{"prompt_tokens":2}}\n' +
			'data: {"timings":{"predicted_ms":4},"choices":[{"delta":{}}]}\n' +
			'data: [DONE]\n'
		);

		expect(events).toEqual(['heartbeat', 'model', 'content', 'timings', 'reasoning', 'tool-progress', 'timings', 'complete']);
		expect(reducer.getResult().events).toMatchObject([
			{ kind: 'heartbeat', at: 123 },
			{ kind: 'model', id: 'model-a' },
			{ kind: 'content', text: 'hi' },
			{ kind: 'timings', value: { prompt_tokens: 2 } },
			{ kind: 'reasoning', text: 'why' },
			{ kind: 'tool-progress' },
			{ kind: 'timings', value: { predicted_ms: 4 } },
			{ kind: 'complete' }
		]);
	});

	it('keeps incomplete lines buffered and does not leak malformed content', () => {
		const onEvent = vi.fn();
		const reducer = new StreamReducer({ onEvent });
		reducer.push('data: {"choices":[{"delta":{"content":"safe"}}]}\n' + 'data: {bad');
		expect(onEvent).toHaveBeenCalledTimes(1);
		reducer.finish();
		expect(onEvent).toHaveBeenCalledTimes(2);
		expect(onEvent.mock.calls.some(([event]) => event.kind === 'content' && event.text.includes('bad'))).toBe(false);
	});

	it('recovers from malformed events and continues in order', () => {
		const reducer = new StreamReducer();
		reducer.push('data: {not-json}\ndata: {"choices":[]}\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n');
		expect(reducer.getResult().events).toEqual([
			expect.objectContaining({ kind: 'error', error: expect.objectContaining({ code: 'MALFORMED_STREAM_EVENT' }) }),
			expect.objectContaining({ kind: 'error', error: expect.objectContaining({ code: 'MALFORMED_STREAM_EVENT' }) }),
		{ kind: 'content', text: 'ok' }
		]);
	});

	it('supports terminal malformed policy and never emits completion afterward', () => {
		const reducer = new StreamReducer({ malformed: 'terminal' });
		reducer.push('data: {"choices":[]}\ndata: [DONE]\n');
		expect(reducer.getResult().events).toHaveLength(1);
		expect(reducer.getResult().events[0]?.kind).toBe('error');
	});

	it('classifies caller cancellation separately and ignores later data', () => {
		const controller = new AbortController();
		const reducer = new StreamReducer({ signal: controller.signal });
		reducer.push('data: {"choices":[{"delta":{"content":"partial"}}]}\n');
		controller.abort();
		reducer.push('data: [DONE]\n');
		expect(reducer.getResult().events).toEqual([
			{ kind: 'content', text: 'partial' },
			{ kind: 'cancelled' }
		]);
		expect(reducer.getResult().cancelled).toBe(true);
	});

	it('emits completion once for finish reason plus DONE and preserves callback order', () => {
		const onEvent = vi.fn();
		const reducer = new StreamReducer({ onEvent });
		reducer.push(
			'data: {"choices":[{"delta":{"content":"answer"}}]}\n' +
			'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n' +
			'data: [DONE]\n'
		);
		expect(onEvent.mock.calls.map(([event]) => event.kind)).toEqual(['content', 'complete']);
		expect(onEvent).toHaveBeenCalledTimes(2);
	});
});
