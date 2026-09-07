import { SvelteMap } from 'svelte/reactivity';
import { DatabaseService } from '$lib/services/database.service';
import type { StreamingState } from '$lib/services/database.service';

export type StreamingStatus = StreamingState['status'];
export type StreamingSnapshot = StreamingState & {
	contextUsed?: number;
	contextTotal?: number;
};

const MAX_CHECKPOINT_CONTENT = 256 * 1024;
const CHECKPOINT_INTERVAL_MS = 250;

const newRequestId = (): string => {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export class StreamingStore {
	states = new SvelteMap<string, StreamingSnapshot>();
	private sequences = new Map<string, number>();
	private lastCheckpoint = new Map<string, number>();
	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		await DatabaseService.markActiveStreamsInterrupted();
	}

	begin(conversationId: string, messageId?: string): StreamingSnapshot {
		const requestId = newRequestId();
		const snapshot: StreamingSnapshot = {
			requestId, conversationId, messageId, content: '', reasoning: '', checkpointSequence: 0,
			createdAt: Date.now(), updatedAt: Date.now(), status: 'active'
		};
		this.sequences.set(requestId, 0);
		this.states.set(requestId, snapshot);
		void this.persist(snapshot, true);
		return snapshot;
	}

	update(requestId: string, update: Partial<Pick<StreamingSnapshot, 'messageId' | 'content' | 'reasoning' | 'contextUsed' | 'contextTotal'>>): StreamingSnapshot | undefined {
		const current = this.states.get(requestId);
		if (!current || current.status !== 'active') return current;
		const sequence = (this.sequences.get(requestId) || current.checkpointSequence) + 1;
		const next: StreamingSnapshot = {
			...current, ...update, content: (update.content ?? current.content).slice(-MAX_CHECKPOINT_CONTENT),
			reasoning: (update.reasoning ?? current.reasoning)?.slice(-MAX_CHECKPOINT_CONTENT),
			checkpointSequence: sequence, updatedAt: Date.now()
		};
		this.sequences.set(requestId, sequence);
		this.states.set(requestId, next);
		if (next.updatedAt - (this.lastCheckpoint.get(requestId) || 0) >= CHECKPOINT_INTERVAL_MS) void this.persist(next);
		return next;
	}

	async finish(requestId: string, status: Exclude<StreamingStatus, 'active'>, content?: string, reasoning?: string): Promise<void> {
		const current = this.states.get(requestId);
		if (!current) return;
		const next = this.update(requestId, { content, reasoning });
		if (!next) return;
		const finalState = { ...next, status, updatedAt: Date.now() };
		this.states.set(requestId, finalState);
		await this.persist(finalState, true);
		if (status === 'completed') await DatabaseService.deleteStreamingCheckpoint(requestId);
	}

	async restoreConversation(conversationId: string): Promise<StreamingSnapshot[]> {
		const checkpoints = await DatabaseService.listStreamingCheckpoints(conversationId);
		for (const checkpoint of checkpoints) this.states.set(checkpoint.requestId, checkpoint);
		return checkpoints;
	}

	getForConversation(conversationId: string): StreamingSnapshot[] {
		return Array.from(this.states.values()).filter((state) => state.conversationId === conversationId);
	}

	private async persist(state: StreamingSnapshot, force = false): Promise<void> {
		if (!force && state.updatedAt - (this.lastCheckpoint.get(state.requestId) || 0) < CHECKPOINT_INTERVAL_MS) return;
		this.lastCheckpoint.set(state.requestId, state.updatedAt);
		await DatabaseService.saveStreamingCheckpoint(state);
	}
}

export const streamingStore = new StreamingStore();
export { MAX_CHECKPOINT_CONTENT };
