import { EventEmitter } from 'node:events';
import { WakeWordService } from './wake.js';

export class VoiceService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = options.config ?? {};
    this.keywordsFile = options.keywordsFile ?? '';
    this.onKeyword = options.onKeyword ?? (() => {});
    this.onCommand = options.onCommand ?? (() => {});
    this.wake = null;
    this.status = { state: 'idle', message: '未启动' };
  }

  async start() {
    this.wake = new WakeWordService({
      modelsDir: this.config.modelsDir || undefined,
      keywordsFile: this.config.keywordsFile || this.keywordsFile || undefined,
    });
    this.wake.on('keyword', (keyword) => {
      this.status = { state: 'awake', keyword };
      this.emit('keyword', keyword);
      this.onKeyword(keyword);
    });
    this.wake.on('status', (status) => {
      this.status = status;
      this.emit('status', status);
    });
    return this.wake.start();
  }

  stop() {
    this.wake?.stop();
    this.wake = null;
  }

  get available() {
    return this.status?.state === 'listening';
  }
}

