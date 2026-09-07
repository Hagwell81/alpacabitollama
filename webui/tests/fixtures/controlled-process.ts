export class ControlledProcess {
	state: 'idle' | 'running' | 'stopping' | 'exited' = 'idle';
	readonly commands: Array<{ type: string; value?: unknown }> = [];
	private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

	on(event: string, listener: (...args: unknown[]) => void): this {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
		return this;
	}

	private emit(event: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(event) ?? []) listener(...args);
	}

	start(command: string, args: string[] = []): void {
		this.commands.push({ type: 'start', value: { command, args } });
		this.state = 'running';
		this.emit('spawn');
	}

	writeStdout(chunk: string): void { this.emit('stdout', chunk); }
	writeStderr(chunk: string): void { this.emit('stderr', chunk); }
	terminate(signal = 'SIGTERM'): void { this.commands.push({ type: 'terminate', value: signal }); this.state = 'stopping'; }
	forceTerminate(signal = 'SIGKILL'): void { this.commands.push({ type: 'forceTerminate', value: signal }); this.state = 'stopping'; }
	exit(code = 0, signal: string | null = null): void { this.state = 'exited'; this.emit('exit', code, signal); this.emit('close', code, signal); }
}
