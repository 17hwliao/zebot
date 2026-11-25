import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mapCodexRecord } from './codex-events.js';

const DEFAULT_ROOT = path.join(os.homedir(), '.codex', 'sessions');
const MAX_CHUNK = 4 * 1024 * 1024;

async function newestSession(root) {
  let best = null;
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat && (!best || stat.mtimeMs > best.mtimeMs)) {
          best = { file: full, mtimeMs: stat.mtimeMs, size: stat.size };
        }
      }
    }
  }
  await walk(root);
  return best;
}

/**
 * Read-only tail of the newest Codex rollout. It intentionally watches the
 * files Codex already writes instead of modifying Codex or its config.
 */
export class CodexSessionTail extends EventEmitter {
  constructor(options = {}) {
    super();
    this.root = options.root ?? DEFAULT_ROOT;
    this.intervalMs = options.intervalMs ?? 450;
    this.file = null;
    this.offset = 0;
    this.remainder = '';
    this.timer = null;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async switchTo(file) {
    this.file = file;
    // Follow new records only. Replaying the whole rollout on startup would
    // make the pet re-enact stale turns; app-server is the live alternative.
    const stat = await fs.stat(file).catch(() => null);
    this.offset = stat?.size ?? 0;
    this.remainder = '';
    const meta = await this.readMeta(file);
    this.emit('event', {
      type: 'session.attached',
      session: meta.id ?? meta.session_id ?? null,
      model: meta.model_provider ?? null,
      cwd: meta.cwd ?? null,
      file,
    });
  }

  async readMeta(file) {
    try {
      const handle = await fs.open(file, 'r');
      try {
        const buffer = Buffer.alloc(256 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const first = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
        const record = JSON.parse(first);
        return record?.type === 'session_meta' ? record.payload ?? {} : {};
      } finally {
        await handle.close();
      }
    } catch {
      return {};
    }
  }

  async poll() {
    if (this.stopped) return;
    const latest = await newestSession(this.root);
    if (!latest) return;

    if (!this.file || latest.file !== this.file) {
      await this.switchTo(latest.file);
    }

    let stat;
    try {
      stat = await fs.stat(this.file);
    } catch {
      return;
    }
    if (stat.size < this.offset) {
      this.offset = 0;
      this.remainder = '';
    }
    if (stat.size === this.offset) return;

    const length = Math.min(stat.size - this.offset, MAX_CHUNK);
    const buffer = Buffer.alloc(length);
    let handle;
    try {
      handle = await fs.open(this.file, 'r');
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
      this.offset += bytesRead;
      const text = this.remainder + buffer.subarray(0, bytesRead).toString('utf8');
      const lines = text.split('\n');
      this.remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        for (const event of mapCodexRecord(record)) this.emit('event', event);
      }
    } catch {
      // A session can be rotated while it is being read; the next poll retries.
    } finally {
      await handle?.close();
    }
  }
}

export { newestSession };

