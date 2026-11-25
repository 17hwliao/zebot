import { EventEmitter } from 'node:events';
import { PetStateMachine } from '../core/pet-state.js';
import { CodexSessionTail } from '../adapters/codex-session.js';
import { GatewayAdapter } from '../adapters/gateway.js';
import { MockAdapter } from '../adapters/mock.js';

export class PetRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = options.config ?? {};
    this.mock = Boolean(options.mock);
    this.sm = new PetStateMachine();
    this.adapter = null;
    this.timer = null;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;

    this.sm.on('update', (update) => this.emit('update', update));

    if (this.mock) {
      this.adapter = new MockAdapter();
    } else if (this.config.adapter === 'gateway' || this.config.gateway?.enabled) {
      this.adapter = new GatewayAdapter({
        url: this.config.gateway?.url,
        token: this.config.gateway?.token,
      });
    } else {
      this.adapter = new CodexSessionTail();
    }

    this.adapter.on('event', (event) => this.handle(event));
    this.adapter.start();
    this.timer = setInterval(() => this.sm.tick(), 320);
    this.timer.unref?.();
    this.sm.publish();
  }

  handle(event) {
    if (!event || typeof event.type !== 'string') return;
    if (event.type === 'pet.touch' && this.adapter instanceof GatewayAdapter) {
      this.adapter.send('pet.touch', { kind: event.kind });
    }
    this.sm.handle(event);
  }

  input(event) {
    this.handle(event);
  }

  send(type, data) {
    if (this.adapter instanceof GatewayAdapter) return this.adapter.send(type, data);
    return false;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.adapter?.stop?.();
    this.adapter = null;
  }
}

