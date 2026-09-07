import { RuntimeService } from '$lib/services/runtime.service';

export type RuntimeAction = 'start' | 'retry' | 'cancel' | 'ensure-ready' | 'none';

export function nextRuntimeAction(snapshot: any): RuntimeAction {
	const state = snapshot?.runtime?.state ?? snapshot?.state;
	if (state === 'idle') return 'start';
	if (state === 'failed') return 'retry';
	if (state === 'acquiring' || state === 'starting' || state === 'busy') {
		return snapshot?.runtime?.reason?.cancellable === false ? 'none' : 'cancel';
	}
	if (state === 'ready') return 'ensure-ready';
	return 'none';
}

export class RuntimeStore {
	snapshot = $state<any>(null);
	providerStatuses = $state<any[]>([]);
	diagnosticsHealth = $state<any>(null);
	featureGates = $state<any>(null);
	lastEvaluation = $state<any>(null);
	loading = $state(false);
	actionInFlight = $state<RuntimeAction | null>(null);
	error = $state<string | null>(null);
	private refreshPromise: Promise<void> | null = null;
	constructor(private readonly service: RuntimeService = new RuntimeService()) {}

	async refresh(): Promise<void> {
		if (this.refreshPromise) return this.refreshPromise;
		this.loading = true;
		this.error = null;
		this.refreshPromise = (async () => {
			try {
				const [snapshot, providers, health, gates] = await Promise.all([
					this.service.getSnapshot(), this.service.getProviderStatus(), this.service.getDiagnosticsHealth(), this.service.getFeatureGates()
				]);
				this.snapshot = RuntimeService.unwrap(snapshot);
				this.providerStatuses = RuntimeService.unwrap<any[]>(providers) ?? [];
				this.diagnosticsHealth = RuntimeService.unwrap(health);
				this.featureGates = RuntimeService.unwrap(gates);
				this.lastEvaluation = this.featureGates?.evaluation?.lastEvaluation ?? this.snapshot?.phase1Evaluation ?? null;
			} catch (error) {
				this.error = error instanceof Error ? error.message : 'Unable to read runtime status';
			} finally {
				this.loading = false;
				this.refreshPromise = null;
			}
		})();
		return this.refreshPromise;
	}

	async start() { return this.run('start', () => this.service.start()); }
	async stop() { return this.run('cancel', () => this.service.stop()); }
	async ensureReady(request: Record<string, unknown>) { return this.run('ensure-ready', () => this.service.ensureReady(request)); }
	async cancel(request: Record<string, unknown>, callerId?: string) { return this.run('cancel', () => this.service.cancel(request, callerId)); }
	async evaluatePhase1() {
		this.actionInFlight = 'none'; this.error = null;
		try { const result = RuntimeService.unwrap(await this.service.evaluatePhase1()); this.lastEvaluation = result; return result; }
		catch (error) { this.error = error instanceof Error ? error.message : 'Phase 1 evaluation failed'; return null; }
		finally { this.actionInFlight = null; await this.refresh(); }
	}

	private async run(action: RuntimeAction, operation: () => Promise<unknown>) {
		this.actionInFlight = action; this.error = null;
		try { return RuntimeService.unwrap(await operation()); }
		catch (error) { this.error = error instanceof Error ? error.message : 'Runtime operation failed'; return null; }
		finally { this.actionInFlight = null; await this.refresh(); }
	}

	clear() { this.snapshot = null; this.providerStatuses = []; this.diagnosticsHealth = null; this.featureGates = null; this.lastEvaluation = null; this.error = null; this.loading = false; }
}

export const runtimeStore = new RuntimeStore();
export const runtimeSnapshot = () => runtimeStore.snapshot;
export const runtimeState = () => runtimeStore.snapshot?.runtime?.state ?? runtimeStore.snapshot?.state ?? 'idle';
export const runtimeError = () => runtimeStore.error;
export const readinessOperation = () => runtimeStore.snapshot?.readiness?.operation ?? runtimeStore.snapshot?.runtime?.operation ?? null;
export const phase1Report = () => runtimeStore.lastEvaluation;
export const runtimeLoading = () => runtimeStore.loading;
