export class FakeClock {
	private currentTime: number;
	private nextId = 1;
	private timers = new Map<number, { at: number; callback: () => void }>();

	constructor(start = 0) {
		this.currentTime = start;
	}

	now(): number {
		return this.currentTime;
	}

	setTimeout(callback: () => void, delay = 0): number {
		const id = this.nextId++;
		this.timers.set(id, { at: this.currentTime + Math.max(0, delay), callback });
		return id;
	}

	clearTimeout(id: number): void {
		this.timers.delete(id);
	}

	advanceBy(milliseconds: number): void {
		const target = this.currentTime + Math.max(0, milliseconds);
		while (true) {
			const next = [...this.timers.entries()]
				.filter(([, timer]) => timer.at <= target)
				.sort(([, left], [, right]) => left.at - right.at)[0];
			if (!next) break;
			const [id, timer] = next;
			this.timers.delete(id);
			this.currentTime = timer.at;
			timer.callback();
		}
		this.currentTime = target;
	}

	pendingCount(): number {
		return this.timers.size;
	}
}
