import type {
	ApiChatCompletionRequest,
	ApiChatCompletionResponse,
	ApiChatCompletionStreamChunk,
	ApiChatCompletionToolCall,
	ApiChatCompletionToolCallDelta
} from '$lib/types/api';
import type { ChatMessagePromptProgress, ChatMessageTimings } from '$lib/types/chat';
import { UrlProtocol } from '$lib/enums';

export interface NormalizedChatResponse {
	model?: string;
	content: string;
	reasoningContent?: string;
	toolCalls?: ApiChatCompletionToolCall[];
	timings?: ChatMessageTimings;
	promptProgress?: ChatMessagePromptProgress;
}

export type NormalizedProviderEvent =
	| { kind: 'content'; text: string; model?: string }
	| { kind: 'reasoning'; text: string; model?: string }
	| { kind: 'tool-call'; delta: ApiChatCompletionToolCallDelta[]; model?: string }
	| { kind: 'model'; id: string }
	| {
			kind: 'timings';
			timings?: ChatMessageTimings;
			promptProgress?: ChatMessagePromptProgress;
			model?: string;
	  }
	| { kind: 'complete'; finishReason?: string; model?: string }
	| { kind: 'protocol-error'; message: string }
	| { kind: 'heartbeat' };

export interface ProviderStreamMetrics {
	requestStartedAt: number;
	firstEventAt?: number;
	lastActivityAt: number;
	eventCount: number;
	contentChars: number;
	reasoningChars: number;
	toolCallCount: number;
	heartbeats: number;
	status: 'completed' | 'cancelled' | 'failed';
	durationMs: number;
}

export interface ProviderStreamResult {
	model?: string;
	events: NormalizedProviderEvent[];
}
/**
 * ProviderService — normalized chat provider for the local llama-server.
 *
 * Architectural note: The renderer talks directly to the local llama-server
 * HTTP endpoint (`./v1/chat/completions`) rather than routing through the
 * main-process `LlamaServerProvider` IPC bridge. This is intentional: streaming
 * chat generates high-frequency token chunks that would suffer latency and
 * back-pressure overhead if routed through IPC. The main-process provider
 * contract is used for non-chat operations (health, model listing, readiness).
 *
 * Cancellation is bounded via AbortSignal and a heartbeat timeout. Provider
 * error bodies are redacted to avoid leaking credentials, paths, or prompt
 * data to the renderer.
 */
export class ProviderService {
	private static metricsSink?: (metrics: ProviderStreamMetrics) => void;
	private static heartbeatTimeoutMs = 120000;

	static configureStreamMonitoring(options: { heartbeatTimeoutMs?: number; onMetrics?: (metrics: ProviderStreamMetrics) => void } = {}): void {
		if (options.heartbeatTimeoutMs !== undefined) ProviderService.heartbeatTimeoutMs = Math.max(1000, options.heartbeatTimeoutMs);
		ProviderService.metricsSink = options.onMetrics;
	}

	static async complete(
		request: ApiChatCompletionRequest,
		signal?: AbortSignal
	): Promise<NormalizedChatResponse> {
		const response = await ProviderService.fetch(request, signal);
		const text = await response.text();
		if (!text.trim()) throw new Error('No response received from server. Please try again.');

		let data: ApiChatCompletionResponse;
		try {
			data = JSON.parse(text) as ApiChatCompletionResponse;
		} catch {
			throw new Error('Malformed provider response.');
		}
		const choice = data.choices?.[0];
		if (!choice?.message) throw new Error('Malformed provider response.');

		return {
			model: ProviderService.extractModel(data),
			content: choice.message.content || '',
			reasoningContent: choice.message.reasoning_content,
			toolCalls: choice.message.tool_calls,
			timings: data.timings,
			promptProgress: data.prompt_progress
		};
	}

	static async stream(
		request: ApiChatCompletionRequest,
		onEvent?: (event: NormalizedProviderEvent) => void,
		signal?: AbortSignal
	): Promise<ProviderStreamResult> {
		const response = await ProviderService.fetch(request, signal);
		const contentType = response.headers?.get('content-type') || '';
		if (contentType && !contentType.includes('text/event-stream') && !contentType.includes('application/json')) console.warn('[ProviderService] Unexpected response content-type:', contentType);
		const reader = response.body?.getReader();
		if (!reader) throw new Error('No response body');

		const decoder = new TextDecoder();
		let buffer = '';
		let model: string | undefined;
		const events: NormalizedProviderEvent[] = [];
		const startedAt = Date.now();
		let lastActivityAt = startedAt;
		let firstEventAt: number | undefined;
		let contentChars = 0;
		let reasoningChars = 0;
		let toolCallCount = 0;
		let heartbeats = 0;
		let status: ProviderStreamMetrics['status'] = signal?.aborted ? 'cancelled' : 'completed';
		const emitMetrics = () => ProviderService.metricsSink?.({ requestStartedAt: startedAt, firstEventAt, lastActivityAt, eventCount: events.length, contentChars, reasoningChars, toolCallCount, heartbeats, status, durationMs: Date.now() - startedAt });
		const emit = (event: NormalizedProviderEvent) => {
			if (!firstEventAt) firstEventAt = Date.now();
			lastActivityAt = Date.now();
			if (event.kind === 'content') contentChars += event.text.length;
			if (event.kind === 'reasoning') reasoningChars += event.text.length;
			if (event.kind === 'tool-call') toolCallCount += event.delta.length;
			if (event.kind === 'heartbeat') heartbeats += 1;
			events.push(event); onEvent?.(event); emitMetrics();
		};

		try {
			while (!signal?.aborted) {
				let timeout: ReturnType<typeof setTimeout> | undefined;
				const read = reader.read();
				const guardedRead = ProviderService.heartbeatTimeoutMs > 0
					? Promise.race([read, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Stream heartbeat timeout')), ProviderService.heartbeatTimeoutMs); })])
					: read;
				const { done, value } = await guardedRead;
				if (timeout) clearTimeout(timeout);
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';
				for (const line of lines) {
					const event = ProviderService.normalizeStreamLine(line);
					if (!event) continue;
					if (event.kind === 'model') model = event.id;
					else if ('model' in event && event.model) model = event.model;
					emit(event);
				}
			}
			buffer += decoder.decode();
			const finalEvent = ProviderService.normalizeStreamLine(buffer);
			if (finalEvent && !signal?.aborted) emit(finalEvent);
			if (events.length === 0) console.warn('[ProviderService] Stream ended with zero events. The server may have returned an empty or non-SSE response.');
			return { model, events };
		} catch (error) {
			status = signal?.aborted ? 'cancelled' : 'failed';
			if (signal?.aborted || (error instanceof Error && error.message === 'Stream heartbeat timeout')) {
				if (!signal?.aborted) emit({ kind: 'protocol-error', message: 'Stream heartbeat timeout.' });
				emitMetrics();
				return { model, events };
			}
			throw error;
		} finally {
			if (signal?.aborted) await reader.cancel().catch(() => undefined);
			reader.releaseLock();
			emitMetrics();
		}
	}

	static normalizeStreamLine(line: string): NormalizedProviderEvent | undefined {
		const normalizedLine = line.trimEnd();
		if (
			!normalizedLine ||
			normalizedLine.startsWith(':') ||
			!normalizedLine.startsWith(UrlProtocol.DATA)
		)
			return normalizedLine.startsWith(':') ? { kind: 'heartbeat' } : undefined;
		const data = normalizedLine.slice(UrlProtocol.DATA.length).trimStart();
		if (data === '[DONE]') return { kind: 'complete' };

		let parsed: ApiChatCompletionStreamChunk;
		try {
			parsed = JSON.parse(data) as ApiChatCompletionStreamChunk;
		} catch {
			return { kind: 'protocol-error', message: 'Malformed provider stream event.' };
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { kind: 'protocol-error', message: 'Malformed stream event.' };
		}
		const chunkModel = ProviderService.extractModel(parsed);
		const delta = parsed.choices?.[0]?.delta;
		if (!delta) return { kind: 'protocol-error', message: 'Malformed stream event.' };
		const timings = parsed.timings;
		const promptProgress = parsed.prompt_progress;
		if (timings || promptProgress) {
			return { kind: 'timings', timings, promptProgress, model: chunkModel };
		}
		if (delta.tool_calls?.length) {
			return { kind: 'tool-call', delta: delta.tool_calls, model: chunkModel };
		}
		if (delta.reasoning_content) {
			return { kind: 'reasoning', text: delta.reasoning_content, model: chunkModel };
		}
		if (delta.content) {
			return { kind: 'content', text: delta.content, model: chunkModel };
		}
		if (parsed.choices?.[0]?.finish_reason) {
			return {
				kind: 'complete',
				finishReason: parsed.choices[0].finish_reason || undefined,
				model: chunkModel
			};
		}
		return chunkModel ? { kind: 'model', id: chunkModel } : undefined;
	}

	private static async fetch(
		request: ApiChatCompletionRequest,
		signal?: AbortSignal
	): Promise<Response> {
		const response = await fetch('./v1/chat/completions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(request),
			signal
		});
		if (!response.ok) {
			const message = await response.text();
			const error = new Error(`Server error (${response.status})`);
			error.name = response.status === 400 ? 'ServerError' : 'HttpError';
			// Do not forward provider bodies: they may contain credentials, paths,
			// or model prompt data. The status remains useful for UI recovery.
			void message;
			throw error;
		}
		return response;
	}

	private static extractModel(data: {
		model?: string;
		choices?: Array<{
			model?: string;
			metadata?: { model?: string };
			delta?: { model?: string };
			message?: { model?: string };
		}>;
	}): string | undefined {
		return (
			data.model ||
			data.choices?.[0]?.model ||
			data.choices?.[0]?.metadata?.model ||
			data.choices?.[0]?.delta?.model ||
			data.choices?.[0]?.message?.model
		);
	}
}
