import { describe, expect, it } from 'vitest';
import { RuntimeBridgeError, RuntimeService, type RuntimeBridge } from '$lib/services/runtime.service';

describe('RuntimeService', () => {
	it('maps bridge operations without Electron dependencies', async () => {
		const calls: string[] = [];
		const bridge: RuntimeBridge = {
			getRuntimeSnapshot: async () => ({ runtime: { state: 'ready' } }),
			getProviderStatus: async () => [],
			getDiagnosticsHealth: async () => ({ status: 'healthy' }),
			getFeatureGates: async () => ({ flags: {} }),
			startServer: async () => { calls.push('start'); return true; },
			stopServer: async () => { calls.push('stop'); return true; },
			ensureReady: async (request) => ({ success: true, request }),
			cancelRuntimeOperation: async () => true
		};
		const service = new RuntimeService(bridge);
		expect(await service.getSnapshot()).toEqual({ runtime: { state: 'ready' } });
		await service.start();
		await service.stop();
		expect(calls).toEqual(['start', 'stop']);
		expect(await service.ensureReady({ modelIdentity: 'local.gguf' })).toMatchObject({ success: true });
	});

	it('reports missing bridge capabilities and safe error envelopes', async () => {
		expect(() => new RuntimeService({}).start()).toThrow(RuntimeBridgeError);
		const service = new RuntimeService({ getRuntimeSnapshot: async () => ({ success: false, error: { code: 'NOPE', message: 'not ready' } }) });
		await expect(Promise.resolve(service.getSnapshot()).then(RuntimeService.unwrap)).rejects.toThrow('not ready');
	});
});
