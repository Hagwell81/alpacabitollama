import type { ResultEnvelope } from '$lib/types/runtime';

export interface RuntimeBridge {
	getRuntimeSnapshot?: () => Promise<unknown>;
	getProviderStatus?: () => Promise<unknown>;
	getDiagnosticsHealth?: () => Promise<unknown>;
	getFeatureGates?: () => Promise<unknown>;
	evaluatePhase1?: () => Promise<unknown>;
	startServer?: () => Promise<unknown>;
	stopServer?: () => Promise<unknown>;
	ensureReady?: (request: Record<string, unknown>) => Promise<unknown>;
	cancelRuntimeOperation?: (request: Record<string, unknown>, callerId?: string) => Promise<unknown>;
}

export class RuntimeBridgeError extends Error {
	code = 'RUNTIME_BRIDGE_UNAVAILABLE';
	constructor(message: string, code = 'RUNTIME_BRIDGE_UNAVAILABLE') {
		super(message);
		this.name = 'RuntimeBridgeError';
		this.code = code;
	}
}

function bridge(): RuntimeBridge {
	if (typeof window === 'undefined') return {};
	return (window as unknown as { llamaAPI?: RuntimeBridge }).llamaAPI ?? {};
}

function requireMethod<K extends keyof RuntimeBridge>(api: RuntimeBridge, name: K): NonNullable<RuntimeBridge[K]> {
	const method = api[name];
	if (typeof method !== 'function') throw new RuntimeBridgeError(`Runtime operation is unavailable: ${String(name)}`);
	return method as NonNullable<RuntimeBridge[K]>;
}

export class RuntimeService {
	private readonly api: RuntimeBridge;
	constructor(api: RuntimeBridge = bridge()) { this.api = api; }

	getSnapshot() { return requireMethod(this.api, 'getRuntimeSnapshot')!(); }
	getProviderStatus() { return requireMethod(this.api, 'getProviderStatus')!(); }
	getDiagnosticsHealth() { return requireMethod(this.api, 'getDiagnosticsHealth')!(); }
	getFeatureGates() { return requireMethod(this.api, 'getFeatureGates')!(); }
	evaluatePhase1() { return requireMethod(this.api, 'evaluatePhase1')!(); }
	start() { return requireMethod(this.api, 'startServer')!(); }
	stop() { return requireMethod(this.api, 'stopServer')!(); }
	ensureReady(request: Record<string, unknown>) { return requireMethod(this.api, 'ensureReady')!(request); }
	cancel(request: Record<string, unknown>, callerId?: string) { return requireMethod(this.api, 'cancelRuntimeOperation')!(request, callerId); }

	static unwrap<T>(value: unknown): T {
		if (value && typeof value === 'object' && 'success' in value && (value as ResultEnvelope<unknown>).success === false) {
			const error = (value as ResultEnvelope<unknown> & { error?: { message?: string; code?: string } }).error;
			throw new RuntimeBridgeError(error?.message || 'Runtime operation failed', error?.code || 'RUNTIME_OPERATION_FAILED');
		}
		return value as T;
	}
}
