import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ZENBOT_EXPRESSION_IDS,
  ZENBOT_MOTION_IDS,
  listZenbotAssets,
  resolveZenbotAsset,
  validateZenbotManifest,
} from '../src/renderer/characters/zenbot-manifest.js';

const ROOT = new URL('../assets/characters/zenbot/', import.meta.url);
const MANIFEST_URL = new URL('manifest.json', ROOT);

function rawManifest() {
  return JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
}

function availableFiles() {
  const files = new Set();
  for (const group of ['expressions', 'motions']) {
    for (const name of readdirSync(new URL(`${group}/`, ROOT))) {
      if (name.toLowerCase().endsWith('.png')) files.add(`${group}/${name}`);
    }
  }
  return files;
}

function pngInfo(path) {
  const bytes = readFileSync(new URL(path, ROOT));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], path);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    rgba: bytes[25] === 6,
  };
}

test('shipped zenbot manifest validates with 19 expressions and 18 motions', () => {
  const raw = rawManifest();
  const files = availableFiles();
  const manifest = validateZenbotManifest(raw, { availableFiles: files });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, 'zenbot');
  assert.equal(manifest.name, 'zenbot');
  assert.equal(manifest.license, 'user-owned-local');
  assert.equal(manifest.defaultExpression, 'neutral');
  assert.equal(manifest.defaultMotion, 'stand');
  assert.deepEqual(manifest.drawing.referenceCanvas, [1117, 1409]);
  assert.equal(manifest.drawing.logoHeight, 292);
  assert.deepEqual(manifest.defaults.hit, [128, 118, 142]);
  assert.deepEqual(Object.keys(manifest.expressions), ZENBOT_EXPRESSION_IDS);
  assert.deepEqual(Object.keys(manifest.motions), ZENBOT_MOTION_IDS);
  assert.equal(listZenbotAssets(manifest).length, 37);
  assert.equal(new Set(listZenbotAssets(manifest)).size, 37);
});

test('every zenbot sprite exists as an RGBA PNG', () => {
  const manifest = validateZenbotManifest(rawManifest(), { availableFiles: availableFiles() });
  for (const file of listZenbotAssets(manifest)) {
    const info = pngInfo(file);
    assert.equal(info.rgba, true, file);
    assert.ok(info.width > 0 && info.height > 0, file);
  }
});

test('motion normalization records the generated scale drift and turn offset', () => {
  const manifest = validateZenbotManifest(rawManifest());
  assert.equal(manifest.motions.hop.scale, 1.24);
  assert.equal(manifest.motions.flap.scale, 1.18);
  assert.equal(manifest.motions.turn.offsetX, 10);
  assert.equal(manifest.motions.sit.lasting, true);
  assert.equal(manifest.motions.sleep.lasting, true);
  assert.equal(manifest.motions.walk.seconds, 12);
  assert.equal(manifest.motions.dance.seconds, 3.4);
});

test('expression aliases resolve body poses that zenbot does not draw separately', () => {
  const manifest = validateZenbotManifest(rawManifest());
  assert.equal(manifest.expressionAliases.sleep, 'sleepy');
  assert.equal(manifest.expressionAliases.waking, 'sleepy');
  assert.equal(manifest.expressionAliases.dragged, 'scared');
  assert.equal(manifest.expressionAliases.run, 'determined');
  assert.equal(resolveZenbotAsset(manifest, 'expression', 'happy').file, 'expressions/happy.png');
  assert.equal(resolveZenbotAsset(manifest, 'motion', 'flap').file, 'motions/flap.png');
});

test('a missing motion is dropped when disk availability is known', () => {
  const files = availableFiles();
  files.delete('motions/hop.png');
  const manifest = validateZenbotManifest(rawManifest(), { availableFiles: files });
  assert.equal(manifest.motions.hop, undefined);
  assert.equal(manifest.motions.stand.file, 'motions/stand.png');
});

test('a missing neutral expression or stand motion fails loudly', () => {
  const noNeutral = availableFiles();
  noNeutral.delete('expressions/neutral.png');
  assert.throws(
    () => validateZenbotManifest(rawManifest(), { availableFiles: noNeutral }),
    /neutral expression/,
  );

  const noStand = availableFiles();
  noStand.delete('motions/stand.png');
  assert.throws(
    () => validateZenbotManifest(rawManifest(), { availableFiles: noStand }),
    /stand motion/,
  );
});

test('unsafe sprite paths and wrong schemas are rejected', () => {
  const schema = rawManifest();
  schema.schemaVersion = 2;
  assert.throws(() => validateZenbotManifest(schema), /schemaVersion/);

  for (const file of ['../evil.png', '/absolute.png', 'C:\\evil.png', 'image.jpg', 'folder/%2e%2e/evil.png']) {
    const raw = rawManifest();
    raw.expressions.happy.file = file;
    assert.throws(() => validateZenbotManifest(raw), /asset|path|png|unsafe|relative|segment/i, file);
  }
});

test('aliases and preload entries pointing at missing assets are removed', () => {
  const raw = rawManifest();
  raw.expressionAliases.sleep = 'not-an-expression';
  raw.timing.preload = ['expression:happy', 'motion:nope', 'bad-key'];
  const manifest = validateZenbotManifest(raw);
  assert.equal(manifest.expressionAliases.sleep, undefined);
  assert.deepEqual(manifest.timing.preload, ['expression:happy']);
});

test('unknown fields survive validation at every level', () => {
  const raw = rawManifest();
  raw.vendor = { note: 'local' };
  raw.drawing.guide = 'kept';
  raw.defaults.extra = 7;
  raw.expressions.happy.pixelDensity = 2;
  raw.motions.wave.future = true;
  const manifest = validateZenbotManifest(raw);
  assert.deepEqual(manifest.vendor, { note: 'local' });
  assert.equal(manifest.drawing.guide, 'kept');
  assert.equal(manifest.defaults.extra, 7);
  assert.equal(manifest.expressions.happy.pixelDensity, 2);
  assert.equal(manifest.motions.wave.future, true);
  assert.notEqual(manifest, raw);
});
