export class ControlledProvider {
	readonly calls: Array<{ operation: string; value: unknown }> = [];

	constructor(private readonly overrides: Record<string, unknown> = {}) {}

	descriptor(): unknown {
		return this.overrides.descriptor ?? { id: 'fixture-provider', name: 'Fixture Provider' };
	}

	call(operation: string, value: unknown): Promise<unknown> {
		this.calls.push({ operation, value });
		const result = this.overrides[operation];
		return Promise.resolve(typeof result === 'function' ? (result as (input: unknown) => unknown)(value) : result ?? { ok: true, operation, value });
	}

	listModels(value?: unknown) { return this.call('listModels', value); }
	ensureReady(value?: unknown) { return this.call('ensureReady', value); }
	health(value?: unknown) { return this.call('health', value); }
	chat(value?: unknown) { return this.call('chat', value); }
	stream(value?: unknown) { return this.call('stream', value); }
	cancel(value?: unknown) { return this.call('cancel', value); }
}
