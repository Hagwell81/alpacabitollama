import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StreamReducer } from '$lib/utils/stream-reducer';

// Feature: streaming-reliability
// Property: 11 — Stream reducer safety
// Validates: Requirements 8.2, 8.5–8.6

describe('Property 11: Stream reducer safety', () => {
	const contentArb = fc.string({ minLength: 0, maxLength: 20 }).filter((value) => !/[\r\n]/.test(value));
	const validStreamArb = fc.array(contentArb, { minLength: 1, maxLength: 12 }).map((parts) => ({
		parts,
		stream: parts.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`).join('') + 'data: [DONE]\n'
	}));

	it('preserves valid content across arbitrary chunk boundaries and completes once', () => {
		fc.assert(
			fc.property(validStreamArb, fc.array(fc.nat({ max: 100 }), { maxLength: 30 }), ({ parts, stream }, cuts) => {
				const reducer = new StreamReducer();
				let offset = 0;
				for (const width of cuts) {
					if (offset >= stream.length) break;
					const end = Math.min(stream.length, offset + width + 1);
					reducer.push(stream.slice(offset, end));
					offset = end;
				}
				if (offset < stream.length) reducer.push(stream.slice(offset));
				const result = reducer.getResult();
				const content = result.events.filter((event) => event.kind === 'content').map((event) => event.text).join('');
				expect(content).toBe(parts.join(''));
				expect(result.events.filter((event) => event.kind === 'complete')).toHaveLength(1);
				expect(result.completed).toBe(true);
				expect(result.events.every((event) => JSON.stringify(event).length < 10000)).toBe(true);
			}),
			{ numRuns: 120 }
		);
	});

	it('never leaks arbitrary malformed payload text and terminal policy stops later events', () => {
		fc.assert(
			fc.property(fc.string({ minLength: 1, maxLength: 80 }).filter((value) => /\S/.test(value) && !value.includes('\n')), (payload) => {
				const reducer = new StreamReducer({ malformed: 'terminal' });
				reducer.push(`data: ${payload}\ndata: ${JSON.stringify({ choices: [{ delta: { content: 'late' } }] })}\n`);
				expect(reducer.isTerminal).toBe(true);
				expect(reducer.getResult().events[0]).toMatchObject({
					kind: 'error',
					error: { code: 'MALFORMED_STREAM_EVENT', message: expect.any(String) }
				});
				expect(reducer.getResult().events.some((event) => event.kind === 'content')).toBe(false);
			}),
			{ numRuns: 120 }
		);
	});
});
