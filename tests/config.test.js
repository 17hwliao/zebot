import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_CONFIG,
  loadConfig,
  normalizeCalibration,
  saveConfig,
} from '../src/main/config.js';

async function temporaryConfig(t, contents) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-pet-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  if (contents !== undefined) {
    await fs.writeFile(
      path.join(root, 'config.json'),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    );
  }
  return root;
}

test('broken JSON falls back to the default character', async (t) => {
  const root = await temporaryConfig(t, '{ definitely not json');
  const config = await loadConfig(root);
  assert.deepEqual(config.character, {
    figure: 'zenbot',
    skin: 'muse',
    zenbotRenderer: 'auto',
    calibration: { x: 0, y: 0, scale: 1 },
  });
});

test('invalid figure, skin and calibration are normalized safely', async (t) => {
  const root = await temporaryConfig(t, {
    character: {
      figure: 'unknown-figure',
      skin: 42,
      calibration: { x: 'left', y: Infinity, scale: 0 },
    },
  });
  const config = await loadConfig(root);
  assert.deepEqual(config.character, {
    figure: 'zenbot',
    skin: 'muse',
    zenbotRenderer: 'auto',
    calibration: { x: 0, y: 0, scale: 1 },
  });

  const partial = normalizeCalibration({ x: 4, y: Number.NaN, scale: 1.25 });
  assert.deepEqual(partial, { x: 4, y: 0, scale: 1.25 });
  assert.equal(normalizeCalibration(null).scale, 1);
});

test('a selected skin survives save and load', async (t) => {
  const root = await temporaryConfig(t);
  const config = structuredClone(DEFAULT_CONFIG);
  config.character = {
    figure: 'whale',
    skin: 'deepseek-cape',
    zenbotRenderer: 'auto',
    calibration: { x: -12, y: 5, scale: 1.1 },
  };
  await saveConfig(root, config);

  const restored = await loadConfig(root);
  assert.deepEqual(restored.character, config.character);
  const stored = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
  assert.deepEqual(stored.character, config.character);
});

test('loading preserves gateway token generation behavior', async (t) => {
  const root = await temporaryConfig(t, {
    gateway: { enabled: true, url: 'ws://127.0.0.1:4321/pet', token: '' },
  });
  const config = await loadConfig(root);
  assert.match(config.gateway.token, /^[a-f0-9]{64}$/);

  const stored = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
  assert.equal(stored.gateway.token, config.gateway.token);
});
