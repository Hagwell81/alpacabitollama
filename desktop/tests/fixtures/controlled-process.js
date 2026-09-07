const { EventEmitter } = require('events');

class ControlledProcess extends EventEmitter {
  constructor() {
    super();
    this.state = 'idle';
    this.commands = [];
  }

  start(command, args = []) {
    this.commands.push({ type: 'start', command, args });
    this.state = 'running';
    this.emit('spawn');
  }

  writeStdout(chunk) {
    this.emit('stdout', String(chunk));
  }

  writeStderr(chunk) {
    this.emit('stderr', String(chunk));
  }

  terminate(signal = 'SIGTERM') {
    this.commands.push({ type: 'terminate', signal });
    this.state = 'stopping';
  }

  forceTerminate(signal = 'SIGKILL') {
    this.commands.push({ type: 'forceTerminate', signal });
    this.state = 'stopping';
  }

  exit(code = 0, signal = null) {
    this.state = 'exited';
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

module.exports = { ControlledProcess };
