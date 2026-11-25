import { EventEmitter } from 'node:events';
import { STATE_EXPRESSION, clip, toolAction, toolLabel } from './actions.js';

const DEFAULTS = {
  sleepAfterMs: 15 * 60 * 1000,
  idleMotionMinMs: 18 * 1000,
  idleMotionMaxMs: 45 * 1000,
  speakingHoldMs: 3000,
  happyHoldMs: 4000,
  errorHoldMs: 6000,
  listeningHoldMs: 8000,
  bubbleMax: 110,
};

export const IDLE_MOTIONS = Object.freeze([
  'look', 'hop', 'wink', 'nod', 'walk', 'sit', 'turn', 'bow', 'run',
]);

/**
 * Turns normalized Codex events into pet-facing updates. It knows nothing about
 * Codex files, Electron, or a particular figure.
 */
export class PetStateMachine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.opts = { ...DEFAULTS, ...options };
    this.now = this.opts.now ?? Date.now;
    this.random = this.opts.random ?? Math.random;
    this.state = 'idle';
    this.rev = 0;
    this.session = null;
    this.model = null;
    this.usage = null;
    this.turnActive = false;
    this.activeTools = new Map();
    this.approval = null;
    this.listening = false;
    this.listeningUntil = 0;
    this.speakingUntil = 0;
    this.happyUntil = 0;
    this.errorUntil = 0;
    this.lastEventAt = this.now();
    this.lastIdleMotionAt = this.now();
    this.nextIdleMotionAt = this.now() + this.idleDelay();
    this.transientExpression = null;
    this.transientUntil = 0;
    this.pendingMotion = null;
    this.bubble = null;
    this.bubbleSeq = 0;
    this.lastPublished = null;
  }

  idleDelay() {
    const { idleMotionMinMs, idleMotionMaxMs } = this.opts;
    return idleMotionMinMs + this.random() * Math.max(1, idleMotionMaxMs - idleMotionMinMs);
  }

  handle(event) {
    const now = this.now();
    const type = event?.type;
    if (!type) return this.snapshot();

    this.lastEventAt = now;

    switch (type) {
      case 'session.attached':
        this.session = event.session ?? this.session;
        this.model = event.model ?? this.model;
        if (this.state === 'offline' || !this.turnActive) this.state = 'idle';
        this.motion('wave');
        this.bubble = this.makeBubble('Codex 已连接', 'info', 2200);
        break;

      case 'session.context':
        this.session = event.session ?? this.session;
        this.model = event.model ?? this.model;
        break;

      case 'turn.started':
        this.turnActive = true;
        this.activeTools.clear();
        this.approval = null;
        this.errorUntil = 0;
        this.listening = false;
        this.state = 'thinking';
        this.motion('nod');
        this.bubble = this.makeBubble('开始处理…', 'think', 1800);
        break;

      case 'user.message':
        this.motion('nod');
        if (event.text) this.bubble = this.makeBubble(`你：${clip(event.text, 64)}`, 'user', 2600);
        break;

      case 'agent.reasoning':
        if (!this.activeTools.size && this.turnActive) this.state = 'thinking';
        break;

      case 'agent.message': {
        const text = clip(event.text, this.opts.bubbleMax);
        if (!text) break;
        this.speakingUntil = now + this.opts.speakingHoldMs;
        this.state = 'speaking';
        this.bubble = this.makeBubble(text, 'agent', this.opts.speakingHoldMs + 2200);
        break;
      }

      case 'tool.started': {
        const action = toolAction(event.name);
        const id = event.id ?? event.name;
        this.activeTools.set(id, {
          name: event.name,
          status: action.status,
          label: event.label ?? toolLabel(event.name, event.args),
        });
        if (event.name === 'request_user_input') {
          this.approval = { id, summary: '等待你回答', options: [] };
          this.state = 'waiting';
          this.motion('look');
          this.bubble = this.makeBubble('等待你回答', 'wait', 0);
          break;
        }
        this.state = 'working';
        this.motion(action.motion);
        this.bubble = this.makeBubble(event.label ?? toolLabel(event.name, event.args), 'work', 3200);
        break;
      }

      case 'tool.finished': {
        const id = event.id ?? event.name;
        this.activeTools.delete(id);
        if (this.approval?.id === id) this.approval = null;
        if (event.ok === false) {
          this.fail(event.message ?? '工具执行失败');
        } else {
          this.motion('nod');
          if (!this.activeTools.size) this.state = this.turnActive ? 'thinking' : 'idle';
        }
        break;
      }

      case 'tool.result':
        if (event.ok === false) this.fail(event.message ?? '命令执行失败');
        else this.motion('nod');
        break;

      case 'approval.requested':
        this.approval = {
          id: event.id ?? 'approval',
          summary: event.summary ?? '需要你确认',
          options: Array.isArray(event.options) ? event.options : [],
        };
        this.state = 'waiting';
        this.motion('look');
        this.bubble = this.makeBubble(this.approval.summary, 'wait', 0);
        break;

      case 'approval.resolved':
        this.approval = null;
        this.state = this.activeTools.size ? 'working' : this.turnActive ? 'thinking' : 'idle';
        this.motion('nod');
        break;

      case 'turn.completed':
      case 'turn.done':
        this.turnActive = false;
        this.activeTools.clear();
        this.approval = null;
        this.happyUntil = now + this.opts.happyHoldMs;
        this.speakingUntil = 0;
        this.state = 'happy';
        this.motion(['jump', 'dance', 'spin'][Math.floor(this.random() * 3)]);
        this.bubble = this.makeBubble(event.summary ? `完成：${clip(event.summary, 80)}` : '完成 ✓', 'done', this.opts.happyHoldMs);
        break;

      case 'turn.failed':
      case 'turn.aborted':
        this.turnActive = false;
        this.activeTools.clear();
        this.approval = null;
        this.fail(event.message ?? '这一轮没有完成');
        break;

      case 'usage.updated':
        this.usage = event.usage ?? null;
        break;

      case 'gateway.status':
        if (event.state === 'offline') {
          this.state = 'offline';
          this.bubble = this.makeBubble(event.message ?? '网关没有连接', 'error', 6000);
        } else if (event.state === 'failover' || event.state === 'quota' || event.state === 'rate-limit') {
          this.state = 'error';
          this.errorUntil = now + 5000;
          this.motion('shiver');
          this.bubble = this.makeBubble(event.message ?? '网关正在切换', 'warn', 6000);
        } else if (this.state === 'offline') {
          this.state = 'idle';
          this.bubble = this.makeBubble('网关已连接', 'info', 2200);
        }
        break;

      case 'voice.wake':
        this.listening = true;
        this.listeningUntil = now + this.opts.listeningHoldMs;
        this.state = 'listening';
        this.transientExpression = 'surprised';
        this.transientUntil = now + 900;
        this.motion('turn');
        this.bubble = this.makeBubble('我在听…', 'listen', 2600);
        break;

      case 'voice.command':
        this.listening = false;
        this.listeningUntil = 0;
        this.turnActive = true;
        this.state = 'thinking';
        this.motion('nod');
        if (event.text) this.bubble = this.makeBubble(`你说：${clip(event.text, 70)}`, 'user', 3000);
        break;

      case 'pet.touch':
        this.touch(event.kind);
        break;

      case 'pet.wake':
        if (this.state === 'sleeping') {
          this.state = 'idle';
          this.lastEventAt = now;
          this.motion('stand');
          this.transientExpression = 'surprised';
          this.transientUntil = now + 800;
        }
        break;

      default:
        break;
    }

    return this.publish();
  }

  touch(kind) {
    const now = this.now();
    if (this.state === 'sleeping') {
      this.state = 'idle';
      this.lastEventAt = now;
    }
    switch (kind) {
      case 'poke':
        this.motion('hop');
        this.transientExpression = 'surprised';
        this.transientUntil = now + 900;
        this.bubble = this.makeBubble('诶？', 'react', 1200);
        break;
      case 'pet':
        this.motion('nod');
        this.transientExpression = 'shy';
        this.transientUntil = now + 1400;
        this.bubble = this.makeBubble('嘿嘿…', 'react', 1400);
        break;
      case 'throw':
        this.motion('dizzy');
        this.transientExpression = 'flustered';
        this.transientUntil = now + 1800;
        this.bubble = this.makeBubble('哇——', 'react', 1600);
        break;
      case 'drop':
        this.motion('stand');
        this.transientExpression = 'flustered';
        this.transientUntil = now + 1000;
        break;
      default:
        break;
    }
  }

  fail(message) {
    const now = this.now();
    this.errorUntil = now + this.opts.errorHoldMs;
    this.state = 'error';
    this.motion('shake');
    this.bubble = this.makeBubble(message, 'error', this.opts.errorHoldMs);
  }

  motion(word) {
    this.pendingMotion = word;
  }

  makeBubble(text, tone, holdMs) {
    return {
      id: ++this.bubbleSeq,
      text: clip(text, this.opts.bubbleMax),
      tone,
      holdMs,
      at: this.now(),
    };
  }

  tick() {
    const now = this.now();
    let changed = false;
    if (this.decide(now) !== this.state) changed = true;

    if (this.bubble && this.bubble.holdMs > 0 && now - this.bubble.at > this.bubble.holdMs) {
      this.bubble = null;
      changed = true;
    }
    if (this.listening && this.listeningUntil && now > this.listeningUntil) {
      this.listening = false;
      this.listeningUntil = 0;
      changed = true;
    }
    if (this.transientExpression && now > this.transientUntil) {
      this.transientExpression = null;
      changed = true;
    }
    if (this.state === 'idle' && now >= this.nextIdleMotionAt) {
      this.motion(IDLE_MOTIONS[Math.floor(this.random() * IDLE_MOTIONS.length)]);
      this.lastIdleMotionAt = now;
      this.nextIdleMotionAt = now + this.idleDelay();
      changed = true;
    }
    if (!this.turnActive && !this.activeTools.size && now - this.lastEventAt > this.opts.sleepAfterMs && this.state !== 'sleeping') {
      this.state = 'sleeping';
      this.motion('sleep');
      changed = true;
    }

    if (changed || this.pendingMotion) return this.publish();
    return this.snapshot();
  }

  decide(now = this.now()) {
    if (this.approval) return 'waiting';
    if (this.errorUntil > now) return 'error';
    if (this.activeTools.size) return 'working';
    if (this.speakingUntil > now) return 'speaking';
    if (this.listening) return 'listening';
    if (this.turnActive) return 'thinking';
    if (this.happyUntil > now) return 'happy';
    if (this.state === 'offline') return 'offline';
    if (!this.turnActive && now - this.lastEventAt > this.opts.sleepAfterMs) return 'sleeping';
    return 'idle';
  }

  snapshot() {
    const now = this.now();
    const state = this.decide(now);
    const active = [...this.activeTools.values()];
    return {
      rev: this.rev,
      state,
      expression: this.transientExpression ?? STATE_EXPRESSION[state] ?? 'neutral',
      motion: this.pendingMotion,
      bubble: this.bubble
        ? { id: this.bubble.id, text: this.bubble.text, tone: this.bubble.tone, holdMs: this.bubble.holdMs }
        : null,
      speaking: state === 'speaking',
      roam: state === 'idle',
      status: active[0]?.status ?? (state === 'waiting' ? 'ask' : null),
      detail: {
        session: this.session,
        model: this.model,
        tools: active.map((tool) => tool.name),
        usage: this.usage,
      },
    };
  }

  publish() {
    this.state = this.decide();
    const update = this.snapshot();
    const comparable = JSON.stringify({ ...update, rev: 0, motion: null });
    const hasMotion = Boolean(this.pendingMotion);
    this.pendingMotion = null;
    if (!hasMotion && comparable === this.lastPublished) return update;
    this.lastPublished = comparable;
    this.rev += 1;
    update.rev = this.rev;
    update.motion = hasMotion ? update.motion : null;
    this.emit('update', update);
    return update;
  }
}

