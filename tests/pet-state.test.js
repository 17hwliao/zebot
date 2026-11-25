import test from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_MOTIONS, PetStateMachine } from '../src/core/pet-state.js';

function machine() {
  let now = 0;
  const sm = new PetStateMachine({ now: () => now, random: () => 0.5 });
  return {
    sm,
    advance(ms) { now += ms; },
    now() { return now; },
  };
}

test('thinking, working, speaking and done flow', () => {
  const { sm, advance } = machine();
  let update = sm.handle({ type: 'session.attached' });
  assert.equal(update.state, 'idle');
  assert.equal(update.motion, 'wave');

  advance(10);
  update = sm.handle({ type: 'turn.started' });
  assert.equal(update.state, 'thinking');
  assert.equal(update.expression, 'thinking');

  update = sm.handle({ type: 'tool.started', id: 't1', name: 'exec_command', args: { cmd: 'npm test' } });
  assert.equal(update.state, 'working');
  assert.equal(update.expression, 'determined');
  assert.equal(update.status, 'shell');
  assert.match(update.bubble.text, /npm test/);
  assert.equal(update.motion, 'nod');

  update = sm.handle({ type: 'tool.finished', id: 't1', ok: true });
  assert.equal(update.state, 'thinking');

  update = sm.handle({ type: 'agent.message', text: '测试通过了。' });
  assert.equal(update.state, 'speaking');
  assert.equal(update.bubble.text, '测试通过了。');

  update = sm.handle({ type: 'turn.completed', summary: '测试通过' });
  assert.equal(update.state, 'happy');
  assert.ok(['jump', 'dance', 'spin'].includes(update.motion));
  assert.match(update.bubble.text, /完成/);

  advance(5000);
  update = sm.tick();
  assert.equal(update.state, 'idle');
});

test('waiting has priority and clears cleanly', () => {
  const { sm } = machine();
  sm.handle({ type: 'turn.started' });
  let update = sm.handle({
    type: 'approval.requested',
    id: 'a1',
    summary: '允许运行吗？',
    options: ['允许', '拒绝'],
  });
  assert.equal(update.state, 'waiting');
  assert.equal(update.status, 'ask');
  assert.equal(update.bubble.text, '允许运行吗？');

  update = sm.handle({ type: 'approval.resolved', id: 'a1' });
  assert.equal(update.state, 'thinking');
  assert.equal(update.motion, 'nod');
});

test('request_user_input becomes waiting until its call finishes', () => {
  const { sm } = machine();
  sm.handle({ type: 'turn.started' });
  let update = sm.handle({ type: 'tool.started', id: 'ask1', name: 'request_user_input' });
  assert.equal(update.state, 'waiting');
  assert.equal(update.status, 'ask');
  assert.equal(update.bubble.text, '等待你回答');

  update = sm.handle({ type: 'tool.finished', id: 'ask1', ok: true });
  assert.equal(update.state, 'thinking');
});

test('failures hold error for the configured window', () => {
  const { sm, advance } = machine();
  sm.handle({ type: 'turn.started' });
  let update = sm.handle({ type: 'turn.failed', message: '命令失败' });
  assert.equal(update.state, 'error');
  assert.equal(update.expression, 'sad');
  assert.equal(update.motion, 'shake');

  advance(3000);
  update = sm.tick();
  assert.equal(update.state, 'error');

  advance(4000);
  update = sm.tick();
  assert.equal(update.state, 'idle');
});

test('voice wake and command drive listening and thinking', () => {
  const { sm } = machine();
  let update = sm.handle({ type: 'voice.wake', keyword: '小扣小扣' });
  assert.equal(update.state, 'listening');
  assert.equal(update.expression, 'surprised');
  assert.equal(update.motion, 'turn');

  update = sm.handle({ type: 'voice.command', text: '看看测试' });
  assert.equal(update.state, 'thinking');
  assert.equal(update.bubble.text, '你说：看看测试');
});

test('touch wakes a sleeping pet and reacts', () => {
  const { sm, advance } = machine();
  sm.handle({ type: 'session.attached' });
  advance(16 * 60 * 1000);
  let update = sm.tick();
  assert.equal(update.state, 'sleeping');

  update = sm.handle({ type: 'pet.touch', kind: 'poke' });
  assert.notEqual(update.state, 'sleeping');
  assert.equal(update.expression, 'surprised');
  assert.equal(update.motion, 'hop');
});

test('idle motions include the bow and run keyframes', () => {
  assert.ok(IDLE_MOTIONS.includes('bow'));
  assert.ok(IDLE_MOTIONS.includes('run'));
  assert.equal(new Set(IDLE_MOTIONS).size, IDLE_MOTIONS.length);

  let now = 0;
  const sm = new PetStateMachine({ now: () => now, random: () => 0.95 });
  now = 44_000;
  const update = sm.tick();
  assert.equal(update.state, 'idle');
  assert.equal(update.motion, 'run');
});

