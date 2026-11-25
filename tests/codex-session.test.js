import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodexSessionTail } from '../src/adapters/codex-session.js';

function record(type, payload) {
  return `${JSON.stringify({ type, payload })}\n`;
}

test('session tail starts at the current end and reads only new records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-pet-tail-'));
  const file = path.join(root, 'rollout-test.jsonl');
  await fs.writeFile(file, record('session_meta', { id: 'session-1' }) + record('event_msg', {
    type: 'task_complete',
    last_agent_message: 'old turn',
  }));

  const tail = new CodexSessionTail({ root, intervalMs: 10_000 });
  const events = [];
  tail.on('event', (event) => events.push(event));
  try {
    await tail.switchTo(file);
    tail.stopped = false;
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'session.attached');
    assert.equal(tail.offset, (await fs.stat(file)).size);

    await fs.appendFile(file, record('response_item', {
      type: 'function_call',
      call_id: 'call-1',
      name: 'exec_command',
      arguments: '{"cmd":"npm test"}',
    }));
    await tail.poll();

    assert.equal(events.at(-1).type, 'tool.started');
    assert.equal(events.at(-1).name, 'exec_command');
  } finally {
    tail.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
