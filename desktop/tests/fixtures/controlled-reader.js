class ControlledReader {
  constructor(chunks = []) {
    this.chunks = [...chunks];
    this.waiters = [];
    this.cancelled = false;
  }

  read() {
    if (this.cancelled) return Promise.resolve({ done: true, value: undefined });
    if (this.chunks.length) return Promise.resolve({ done: false, value: this.chunks.shift() });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  push(chunk) {
    const resolve = this.waiters.shift();
    if (resolve) resolve({ done: false, value: chunk });
    else this.chunks.push(chunk);
  }

  close() {
    for (const resolve of this.waiters.splice(0)) resolve({ done: true, value: undefined });
  }

  cancel() {
    this.cancelled = true;
    this.close();
  }
}

module.exports = { ControlledReader };
