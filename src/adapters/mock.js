import { EventEmitter } from 'node:events';

const SCRIPT = [
  { delay: 400, event: { type: 'session.attached', session: 'mock-session', model: 'codex-mock' } },
  { delay: 900, event: { type: 'turn.started' } },
  { delay: 1600, event: { type: 'tool.started', id: 'mock-1', name: 'exec_command', args: { cmd: 'npm test' } } },
  { delay: 2600, event: { type: 'tool.finished', id: 'mock-1', ok: true } },
  { delay: 3300, event: { type: 'agent.message', text: '测试通过。现在整理一下结果。' } },
  { delay: 4600, event: { type: 'turn.completed', summary: '测试通过' } },
  { delay: 9000, event: { type: 'user.message', text: '继续处理下一个问题' } },
  { delay: 9400, event: { type: 'turn.started' } },
  { delay: 10200, event: { type: 'tool.started', id: 'mock-2', name: 'apply_patch', args: {} } },
  { delay: 11600, event: { type: 'tool.finished', id: 'mock-2', ok: true } },
  { delay: 12400, event: { type: 'agent.message', text: '改好了，等你确认。' } },
  { delay: 13200, event: { type: 'approval.requested', id: 'mock-a', summary: '允许运行安装命令吗？', options: ['允许', '拒绝'] } },
  { delay: 19000, event: { type: 'approval.resolved', id: 'mock-a' } },
  { delay: 19600, event: { type: 'turn.completed', summary: '修改完成' } },
];

export class MockAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.loop = options.loop ?? true;
    this.timers = [];
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  schedule(offset) {
    for (const step of SCRIPT) {
      const timer = setTimeout(() => {
        if (!this.stopped) this.emit('event', step.event);
      }, offset + step.delay);
      timer.unref?.();
      this.timers.push(timer);
    }
    if (this.loop) {
      const duration = SCRIPT[SCRIPT.length - 1].delay + 5000;
      const again = setTimeout(() => {
        if (!this.stopped) {
          this.timers = [];
          this.schedule(0);
        }
      }, offset + duration);
      again.unref?.();
      this.timers.push(again);
    }
  }

  stop() {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}

