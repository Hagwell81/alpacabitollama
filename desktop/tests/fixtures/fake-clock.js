class FakeClock {
  constructor(start = 0) {
    this.currentTime = start;
    this.timers = new Map();
    this.nextId = 1;
  }

  now() {
    return this.currentTime;
  }

  setTimeout(callback, delay = 0) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.currentTime + Math.max(0, delay), callback });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  advanceBy(milliseconds) {
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

  pendingCount() {
    return this.timers.size;
  }
}

module.exports = { FakeClock };
