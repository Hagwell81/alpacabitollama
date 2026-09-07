/** Serializable contracts shared by the desktop bridge and renderer. */

export const RUNTIME_STATES = ['idle', 'acquiring', 'starting', 'ready', 'busy', 'stopping', 'failed', 'cancelling'] as const;
export type RuntimeState = (typeof RUNTIME_STATES)[number];

export type CorrelationId = string;
export type RecoveryAction = 'Retry' | 'Select another model' | 'Open diagnostics' | 'Start' | 'Cancel' | 'Stop';

export interface SafeError {
	code: string;
	message: string;
	retryable: boolean;
	recoveryAction: string;
	correlationId: CorrelationId;
	details?: Record<string, string | number | boolean | null>;
}

export interface SuccessEnvelope<T> {
	success: true;
	correlationId: CorrelationId;
	data: T;
}

export interface ErrorEnvelope {
	success: false;
	correlationId: CorrelationId;
	error: SafeError;
}

export type ResultEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export interface TransitionReason {
	from: RuntimeState;
	to: RuntimeState;
	reasonCode: string;
	correlationId: CorrelationId;
	at: number;
	progress?: number;
	cancellable: boolean;
}

export interface ProviderRef {
	id: string;
	groupId: string;
}

export interface ModelDigest {
	algorithm: string;
	value: string;
	verified: boolean;
}

export interface ModelRef {
	id: string;
	providerId: string;
	digest?: string | ModelDigest;
}

export type ProviderAuthMode = 'none' | 'api-key' | 'token' | 'secure-store';
export type ProviderCapability = 'chat' | 'streaming' | 'model-listing' | 'readiness' | 'cancellation' | 'tools' | 'reasoning';

export interface ProviderDescriptor extends ProviderRef {
	name: string;
	origin: string;
	authMode: ProviderAuthMode;
	capabilities: ProviderCapability[];
	endpoint?: string;
}

export type ModelSource = 'local' | 'curated' | 'router' | 'discovery';
export type ModelFormat = 'gguf' | 'remote' | 'unknown';
export type ModelAvailability = 'available' | 'unavailable' | 'stale';
export type VerificationStatus = 'verified' | 'pending' | 'failed' | 'unknown';
export type MetadataStatus = 'known' | 'unknown' | 'malformed';

export interface ModelRecord extends ModelRef {
	displayName: string;
	providerGroupId: string;
	source: ModelSource;
	format: ModelFormat;
	reference: string;
	digest?: ModelDigest;
	capabilities: string[];
	contextLimit?: number;
	sizeBytes?: number;
	availability: ModelAvailability;
	verification: VerificationStatus;
	metadata: Record<string, unknown>;
	metadataStatus: Record<string, MetadataStatus>;
	lastSeenAt: number;
}

export interface QueueStatus {
	active: number;
	queued: number;
	rejected: number;
	cancelled: number;
	completed: number;
	failed: number;
	capacity: number;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export interface CircuitStatus {
	providerId?: string;
	operation?: string;
	state: CircuitState;
	consecutiveFailures: number;
	resetAt?: number;
}

export interface RuntimeSnapshot {
	state: RuntimeState;
	reason: TransitionReason;
	provider?: ProviderDescriptor;
	model?: { id: string; digest?: string; fit?: FitPlan };
	operation?: { id: string; progress?: number; cancellable: boolean };
	queue: QueueStatus;
	circuit: CircuitStatus[];
	phase: { phase1Exit: 'pending' | 'passed' | 'failed'; phase2Enabled: boolean };
}

export interface FitPlan {
	modelId: string;
	status: 'fits' | 'tight' | 'does-not-fit' | 'unknown';
	estimated: { weightsBytes?: number; kvCacheBytes?: number; overheadBytes?: number; totalBytes?: number };
	allocation?: { contextTokens?: number; gpuOffloadLayers?: number; cpuBytes?: number; acceleratorBytes?: number };
	assumptions: string[];
	explanation: string;
	alternatives: string[];
}

export interface SafeToolProgress {
	name?: string;
	status?: string;
	progress?: number;
	[key: string]: string | number | boolean | null | undefined;
}

export interface SafeTimings {
	[key: string]: number | string | null | undefined;
}

export type StreamEvent =
	| { kind: 'content'; text: string }
	| { kind: 'reasoning'; text: string }
	| { kind: 'tool-progress'; payload: SafeToolProgress }
	| { kind: 'heartbeat'; at: number }
	| { kind: 'model'; id: string }
	| { kind: 'timings'; value: SafeTimings }
	| { kind: 'complete'; finishReason?: string }
	| { kind: 'cancelled' }
	| { kind: 'error'; error: SafeError };

export interface StreamingState {
	conversationId: string;
	requestId: string;
	messageId: string;
	content: string;
	reasoningContent: string;
	modelId?: string;
	checkpointSequence: number;
	startedAt: number;
	lastActivityAt: number;
	terminalStatus: 'active' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
	failure?: SafeError;
}
