import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCodexRecord } from '../src/adapters/codex-events.js';

test('session_meta becomes session.attached', () => {
  const events = mapCodexRecord({
    type: 'session_meta',
    payload: { id: 's1', model_provider: 'openai', cwd: 'C:/work' },
  });
  assert.deepEqual(events, [{ type: 'session.attached', session: 's1', model: 'openai', cwd: 'C:/work' }]);
});

test('task lifecycle maps to turn events', () => {
  assert.deepEqual(mapCodexRecord({ type: 'event_msg', payload: { type: 'task_started' } })[0].type, 'turn.started');
  const done = mapCodexRecord({
    type: 'event_msg',
    payload: { type: 'task_complete', last_agent_message: 'ok', duration_ms: 10 },
  })[0];
  assert.equal(done.type, 'turn.completed');
  assert.equal(done.summary, 'ok');
});

test('function calls carry parsed arguments and completion status', () => {
  const started = mapCodexRecord({
    type: 'response_item',
    payload: {
      type: 'function_call',
      call_id: 'call-1',
      name: 'exec_command',
      arguments: '{"cmd":"npm test"}',
    },
  })[0];
  assert.equal(started.type, 'tool.started');
  assert.equal(started.id, 'call-1');
  assert.equal(started.args.cmd, 'npm test');

  const ok = mapCodexRecord({
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call-1', output: 'Process exited with code 0' },
  })[0];
  assert.equal(ok.type, 'tool.finished');
  assert.equal(ok.ok, true);

  const bad = mapCodexRecord({
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call-2', output: 'Process exited with code 2' },
  })[0];
  assert.equal(bad.ok, false);
});

test('completed items map to user, agent and tool result events', () => {
  assert.deepEqual(
    mapCodexRecord({
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: { type: 'UserMessage', content: [{ type: 'text', text: 'hello' }] },
      },
    }),
    [{ type: 'user.message', text: 'hello' }],
  );

  assert.deepEqual(
    mapCodexRecord({
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: { type: 'AgentMessage', content: [{ type: 'text', text: 'done' }] },
      },
    }),
    [{ type: 'agent.message', text: 'done' }],
  );

  const failed = mapCodexRecord({
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      item: { type: 'CommandExecution', exit_code: 1, command: 'npm test' },
    },
  })[0];
  assert.equal(failed.type, 'tool.result');
  assert.equal(failed.ok, false);
});

test('unknown and malformed records are ignored safely', () => {
  assert.deepEqual(mapCodexRecord(null), []);
  assert.deepEqual(mapCodexRecord({ type: 'unknown' }), []);
  const call = mapCodexRecord({
    type: 'response_item',
    payload: { type: 'function_call', name: 'x', arguments: '{broken' },
  })[0];
  assert.deepEqual(call.args, {});
});

