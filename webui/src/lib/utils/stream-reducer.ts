import type { SafeError, SafeTimings, SafeToolProgress, StreamEvent } from '$lib/types/runtime';

export type MalformedEventPolicy =
	| 'recoverable'
	| 'terminal'
	| ((reason: string, payload: unknown) => 'recoverable' | 'terminal');

export interface StreamReducerOptions {
	onEvent?: (event: StreamEvent) => void;
	now?: () => number;
	correlationId?: string;
	malformed?: MalformedEventPolicy;
	signal?: AbortSignal;
}

export interface StreamReducerResult {
	events: StreamEvent[];
	completed: boolean;
	cancelled: boolean;
}

const DEFAULT_CORRELATION_ID = 'stream';

/**
 * Stateful, provider-independent SSE reducer. It deliberately emits only
 * validated, serializable events and has one terminal outcome.
 */
export class StreamReducer {
	private readonly onEvent?: (event: StreamEvent) => void;
	private readonly now: () => number;
	private readonly correlationId: string;
	private readonly malformed: MalformedEventPolicy;
	private readonly events: StreamEvent[] = [];
	private buffer = '';
	private terminal = false;
	private completionEmitted = false;
	private abortListener?: () => void;

	constructor(options: StreamReducerOptions = {}) {
		this.onEvent = options.onEvent;
		this.now = options.now ?? Date.now;
		this.correlationId = options.correlationId ?? DEFAULT_CORRELATION_ID;
		this.malformed = options.malformed ?? 'recoverable';
		if (options.signal) {
			this.abortListener = () => this.cancel();
			if (options.signal.aborted) this.cancel();
			else options.signal.addEventListener('abort', this.abortListener, { once: true });
		}
	}

	/** Feed an arbitrary UTF-8 decoded chunk. Incomplete lines are retained. */
	push(chunk: string): StreamEvent[] {
		if (this.terminal || !chunk) return [];
		this.buffer += chunk;
		const emittedBefore = this.events.length;
		const lines = this.buffer.split(/\r?\n|\r/);
		this.buffer = lines.pop() ?? '';
		for (const line of lines) this.consumeLine(line);
		return this.events.slice(emittedBefore);
	}

	/** Flushes a final unterminated SSE line without inventing completion. */
	finish(): StreamEvent[] {
		if (this.terminal) return [];
		const emittedBefore = this.events.length;
		if (this.buffer) {
			this.consumeLine(this.buffer);
			this.buffer = '';
		}
		return this.events.slice(emittedBefore);
	}

	cancel(): StreamEvent[] {
		if (this.terminal) return [];
		this.buffer = '';
		this.terminal = true;
		return this.emit({ kind: 'cancelled' });
	}

	getResult(): StreamReducerResult {
		return {
			events: [...this.events],
			completed: this.completionEmitted,
			cancelled: this.events.some((event) => event.kind === 'cancelled')
		};
	}

	get isTerminal(): boolean {
		return this.terminal;
	}

	private consumeLine(line: string): void {
		if (this.terminal) return;
		if (!line || line.startsWith(':')) {
			if (line.startsWith(':')) this.emit({ kind: 'heartbeat', at: this.now() });
			return;
		}
		if (!line.startsWith('data:')) return;
		const data = line.slice(5).replace(/^ /, '');
		this.consumeData(data);
	}

	private consumeData(data: string): void {
		if (this.terminal) return;
		if (data === '[DONE]') {
			this.complete();
			return;
		}

		let payload: unknown;
		try {
			payload = JSON.parse(data);
		} catch {
			this.malformedEvent('Malformed provider stream event.', data);
			return;
		}
		if (!isRecord(payload)) {
			this.malformedEvent('Malformed stream event.', payload);
			return;
		}
		this.reducePayload(payload);
	}

	private reducePayload(payload: Record<string, unknown>): void {
		const choice = firstRecord(payload.choices);
		const delta = choice && isRecord(choice.delta) ? choice.delta : undefined;
		const message = choice && isRecord(choice.message) ? choice.message : undefined;
		const model = firstString(payload.model) ?? firstString(choice?.model) ?? firstString(delta?.model) ?? firstString(message?.model);

		if (payload.error !== undefined) {
			this.emit({ kind: 'error', error: safeError('PROVIDER_ERROR', payload.error, this.correlationId) });
			this.terminal = true;
			return;
		}
		if (model) this.emit({ kind: 'model', id: model });

		const timings = normalizeTimings(payload.timings, payload.prompt_progress);
		if (timings) this.emit({ kind: 'timings', value: timings });

		const finishReason = firstString(choice?.finish_reason);
		if (!choice) {
			if (model || timings) return;
			this.malformedEvent('Malformed stream event.', payload);
			return;
		}
		if (!delta && !message && finishReason) {
			this.complete(finishReason);
			return;
		}
		if (!delta) {
			if (model || timings) return;
			this.malformedEvent('Malformed stream event.', payload);
			return;
		}

		const content = typeof delta.content === 'string' ? delta.content : undefined;
		const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined;
		if (content !== undefined) this.emit({ kind: 'content', text: content });
		if (reasoning !== undefined) this.emit({ kind: 'reasoning', text: reasoning });
		if (Array.isArray(delta.tool_calls)) {
			const payloadValue: SafeToolProgress = {
				status: 'progress',
				toolCalls: JSON.stringify(sanitizeJsonValue(delta.tool_calls))
			};
			this.emit({ kind: 'tool-progress', payload: payloadValue });
		}
		if (finishReason) this.complete(finishReason);
	}

	private complete(finishReason?: string): StreamEvent[] {
		if (this.terminal || this.completionEmitted) return [];
		this.completionEmitted = true;
		this.terminal = true;
		return this.emit(finishReason ? { kind: 'complete', finishReason } : { kind: 'complete' });
	}

	private malformedEvent(reason: string, payload: unknown): void {
		const policy = typeof this.malformed === 'function' ? this.malformed(reason, payload) : this.malformed;
		this.emit({ kind: 'error', error: safeError('MALFORMED_STREAM_EVENT', reason, this.correlationId) });
		if (policy === 'terminal') this.terminal = true;
	}

	private emit(event: StreamEvent): StreamEvent[] {
		this.events.push(event);
		this.onEvent?.(event);
		return [event];
	}
}

export function createStreamReducer(options: StreamReducerOptions = {}): StreamReducer {
	return new StreamReducer(options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
	return Array.isArray(value) && isRecord(value[0]) ? value[0] : undefined;
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
	return undefined;
}

function normalizeTimings(...values: unknown[]): SafeTimings | undefined {
	const result: SafeTimings = {};
	let found = false;
	for (const value of values) {
		if (!isRecord(value)) continue;
		for (const [key, item] of Object.entries(value)) {
			if (isSafeScalar(item)) {
				result[key] = item;
				found = true;
			}
		}
	}
	return found ? result : undefined;
}

function isSafeScalar(value: unknown): value is string | number | null {
	return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function sanitizeJsonValue(value: unknown): unknown {
	if (isSafeScalar(value) || typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.map(sanitizeJsonValue);
	if (isRecord(value)) {
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) result[key] = sanitizeJsonValue(item);
		return result;
	}
	return null;
}

function safeError(code: string, message: unknown, correlationId: string): SafeError {
	return {
		code,
		message: code === 'MALFORMED_STREAM_EVENT' && typeof message === 'string' ? message : 'Provider request failed.',
		retryable: code === 'MALFORMED_STREAM_EVENT',
		recoveryAction: 'Retry',
		correlationId
	};
}
