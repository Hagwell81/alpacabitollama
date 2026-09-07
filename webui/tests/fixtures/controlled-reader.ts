export class ControlledReader<T> {
	private chunks: T[];
	private waiters: Array<(result: ReadResult<T>) => void> = [];
	cancelled = false;

	constructor(chunks: T[] = []) {
		this.chunks = [...chunks];
	}

	read(): Promise<ReadResult<T>> {
		if (this.cancelled) return Promise.resolve({ done: true, value: undefined });
		if (this.chunks.length) return Promise.resolve({ done: false, value: this.chunks.shift() as T });
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	push(chunk: T): void {
		const resolve = this.waiters.shift();
		if (resolve) resolve({ done: false, value: chunk });
		else this.chunks.push(chunk);
	}

	close(): void {
		for (const resolve of this.waiters.splice(0)) resolve({ done: true, value: undefined });
	}

	cancel(): void {
		this.cancelled = true;
		this.close();
	}
}

export type ReadResult<T> = { done: boolean; value: T | undefined };
