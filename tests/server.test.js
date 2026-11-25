import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStaticServer } from '../src/main/server.js';

test('static server serves mounted assets, supports HEAD and blocks traversal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-pet-server-'));
  const renderer = path.join(root, 'renderer');
  const characters = path.join(root, 'characters');
  const outside = path.join(root, 'secret.txt');
  await fs.mkdir(renderer);
  await fs.mkdir(characters);
  await fs.writeFile(path.join(renderer, 'index.html'), '<!doctype html>ok');
  await fs.writeFile(path.join(characters, 'manifest.json'), '{"id":"xingyin"}');
  await fs.writeFile(outside, 'outside');

  const server = await startStaticServer(renderer, {
    mounts: { '/characters/': characters },
  });
  try {
    const index = await fetch(`${server.url}/`);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), '<!doctype html>ok');

    const head = await fetch(`${server.url}/characters/manifest.json`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength('{"id":"xingyin"}')));
    assert.equal(await head.text(), '');

    const misses = [
      `${server.url}/characters/../secret.txt`,
      `${server.url}/characters/%2e%2e/secret.txt`,
      `${server.url}/characters/%2e%2e%2fsecret.txt`,
    ];
    for (const url of misses) {
      const response = await fetch(url);
      assert.ok(response.status === 403 || response.status === 404, `${url} returned ${response.status}`);
      assert.notEqual(await response.text(), 'outside');
    }
  } finally {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
