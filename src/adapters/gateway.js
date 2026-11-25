import { EventEmitter } from 'node:events';

const RECONNECT_MIN = 800;
const RECONNECT_MAX = 15000;

/**
 * Consumes the JSON protocol in docs/EVENT-PROTOCOL.md. The adapter maps the
 * protocol's high-level messages onto the same internal events as the Codex
 * rollout adapter.
 */
export class GatewayAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.url = options.url ?? 'ws://127.0.0.1:3426/pet';
    this.token = options.token ?? '';
    this.socket = null;
    this.stopped = true;
    this.backoff = RECONNECT_MIN;
    this.seq = 0;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    const url = new URL(this.url);
    if (this.token) url.searchParams.set('token', this.token);
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.emit('event', { type: 'gateway.status', state: 'offline', message: String(error.message ?? error) });
      this.retry();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.backoff = RECONNECT_MIN;
      this.emit('event', { type: 'gateway.status', state: 'online' });
    });
    socket.addEventListener('message', (message) => this.onMessage(message.data));
    socket.addEventListener('close', () => {
      this.socket = null;
      if (!this.stopped) {
        this.emit('event', { type: 'gateway.status', state: 'offline', message: '网关连接断开' });
        this.retry();
      }
    });
    socket.addEventListener('error', () => {
      // close will follow; keep the log quiet here.
    });
  }

  retry() {
    if (this.stopped) return;
    const delay = this.backoff;
    this.backoff = Math.min(RECONNECT_MAX, Math.round(this.backoff * 1.7));
    const timer = setTimeout(() => this.connect(), delay);
    timer.unref?.();
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message.v !== 1) return;
    const data = message.data ?? {};
    switch (message.type) {
      case 'agent.state':
        if (data.state === 'idle') this.emit('event', { type: 'turn.completed', summary: null });
        else if (data.state === 'error') this.emit('event', { type: 'turn.failed', message: data.label ?? 'Agent 出错' });
        else if (data.state === 'waiting') this.emit('event', { type: 'approval.requested', summary: data.label ?? '需要你确认' });
        else this.emit('event', { type: 'turn.started' });
        break;
      case 'agent.tool':
        this.emit('event', {
          type: data.phase === 'finished' ? 'tool.finished' : 'tool.started',
          id: data.id,
          name: data.name,
          label: data.label,
          ok: data.ok,
        });
        break;
      case 'agent.message':
        this.emit('event', { type: 'agent.message', text: data.text ?? '' });
        break;
      case 'agent.approval':
        this.emit('event', {
          type: 'approval.requested',
          id: data.id,
          summary: data.summary ?? '需要你确认',
          options: data.options,
        });
        break;
      case 'agent.done':
        this.emit('event', { type: 'turn.completed', summary: data.summary ?? null });
        break;
      case 'agent.error':
        this.emit('event', { type: 'turn.failed', message: data.message ?? 'Agent 出错' });
        break;
      case 'gateway.status':
        this.emit('event', { type: 'gateway.status', ...data });
        break;
      case 'voice.wake':
        this.emit('event', { type: 'voice.wake', keyword: data.keyword });
        break;
      case 'voice.command':
        this.emit('event', { type: 'voice.command', text: data.text ?? '' });
        break;
      default:
        break;
    }
  }

  send(type, data = {}) {
    if (this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify({
      v: 1,
      type,
      ts: Date.now(),
      seq: ++this.seq,
      source: 'pet',
      data,
    }));
    return true;
  }

  stop() {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }
}

