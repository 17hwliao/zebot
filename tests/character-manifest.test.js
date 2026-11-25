import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  getSkin,
  listCharacterAssets,
  resolvePoseAsset,
  validateCharacterManifest,
} from '../src/renderer/characters/manifest.js';

const ASSET_DIR = new URL('../assets/characters/xingyin/', import.meta.url);
const MANIFEST_URL = new URL('manifest.json', ASSET_DIR);
const SKIN_ORDER = [
  'muse',
  'amber-scholar',
  'azure-fan',
  'ink-fox',
  'ivory-dragon',
  'moon-piano',
  'noir-gold',
  'ocean-maid',
  'violet-stars',
];

function rawManifest() {
  return JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
}

function availableAssets(manifest) {
  return new Set(listCharacterAssets(manifest));
}

function fileBytes(file) {
  return readFileSync(new URL(file, ASSET_DIR));
}

function pngInfo(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    rgba: bytes[25] === 6,
  };
}

test('shipped Xingyin manifest validates with all nine skins and thirteen unique assets', () => {
  const raw = rawManifest();
  const files = availableAssets(raw);
  const manifest = validateCharacterManifest(raw, { availableFiles: files });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, 'xingyin');
  assert.equal(manifest.name, '星音');
  assert.equal(manifest.license, 'local-user-owned');
  assert.equal(manifest.defaultSkin, 'muse');
  assert.deepEqual(manifest.sourceCanvas, [1086, 1448]);
  assert.deepEqual(manifest.drawing, { logoHeight: 252, centerX: 128, feetY: 256 });
  assert.deepEqual(manifest.skins.map((skin) => skin.id), SKIN_ORDER);
  assert.equal(listCharacterAssets(manifest).length, 13);
  assert.equal(new Set(listCharacterAssets(manifest)).size, 13);

  const muse = getSkin(manifest, 'muse');
  assert.deepEqual(Object.keys(muse.assets).sort(), ['blink', 'idle', 'listening', 'shy', 'speakingClosed']);
  for (const asset of Object.values(muse.assets)) {
    assert.deepEqual(asset.crop, [0, 0, 1086, 1448]);
  }

  for (const skin of manifest.skins.slice(1)) {
    assert.deepEqual(Object.keys(skin.assets), ['idle']);
    assert.deepEqual(skin.assets.idle.crop, [0, 0, 543, 724]);
  }
});

test('copied PNGs retain their source checksums, dimensions, and RGBA colour type', () => {
  const raw = rawManifest();
  const files = listCharacterAssets(raw);
  assert.equal(Object.keys(raw.assetChecksums).length, 13);

  for (const file of files) {
    const bytes = fileBytes(file);
    const digest = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    assert.equal(digest, raw.assetChecksums[file], file);
    assert.deepEqual(pngInfo(bytes), { width: 1086, height: 1448, rgba: true }, file);
  }
});

test('a missing default idle drops that skin and falls back to the first valid skin', () => {
  const raw = rawManifest();
  const files = availableAssets(raw);
  files.delete('zenix-muse.png');

  const manifest = validateCharacterManifest(raw, { availableFiles: files });
  assert.equal(getSkin(manifest, 'muse'), null);
  assert.equal(manifest.defaultSkin, 'amber-scholar');
  assert.equal(manifest.skins[0].id, 'amber-scholar');
  assert.equal(manifest.skins.length, 8);
});

test('a missing optional pose is removed without removing its skin', () => {
  const raw = rawManifest();
  const files = availableAssets(raw);
  files.delete('zenix-muse-shy.png');

  const manifest = validateCharacterManifest(raw, { availableFiles: files });
  const muse = getSkin(manifest, 'muse');
  assert.ok(muse);
  assert.equal(muse.assets.shy, undefined);
  assert.deepEqual(muse.assets.idle.crop, [0, 0, 1086, 1448]);
});

test('duplicate skin ids, wrong schemaVersion, and structurally missing idle all throw', () => {
  const duplicate = rawManifest();
  duplicate.skins[1].id = 'muse';
  assert.throws(() => validateCharacterManifest(duplicate), /duplicate skin id/);

  const schema = rawManifest();
  schema.schemaVersion = 2;
  assert.throws(() => validateCharacterManifest(schema), /schemaVersion/);

  const noIdle = rawManifest();
  delete noIdle.skins[0].assets.idle;
  assert.throws(() => validateCharacterManifest(noIdle), /idle/);
});

test('unknown fields survive validation at every manifest level', () => {
  const raw = rawManifest();
  raw.compatibility = { future: ['root', 1] };
  raw.drawing.guide = 'preserved';
  raw.defaults.extraMetric = 7;
  raw.skins[0].vendorMetadata = { note: 'local' };
  raw.skins[0].assets.idle.pixelDensity = 2;
  raw.skins[0].assets.notes = 'not a pose';

  const manifest = validateCharacterManifest(raw);
  assert.deepEqual(manifest.compatibility, { future: ['root', 1] });
  assert.equal(manifest.drawing.guide, 'preserved');
  assert.equal(manifest.defaults.extraMetric, 7);
  assert.deepEqual(manifest.skins[0].vendorMetadata, { note: 'local' });
  assert.equal(manifest.skins[0].assets.idle.pixelDensity, 2);
  assert.equal(manifest.skins[0].assets.notes, 'not a pose');
  assert.notEqual(manifest, raw);
});

test('dangerous or non-PNG asset paths are rejected', () => {
  const unsafe = [
    '../evil.png',
    '/absolute.png',
    'C:\\absolute.png',
    'C:/absolute.png',
    'folder\\evil.png',
    'folder//evil.png',
    'folder/./evil.png',
    'folder/../evil.png',
    'image.jpg',
    '.png',
    'https://example.com/evil.png',
    'image.png?cache=1',
    'image.png#fragment',
    'folder/%2e%2e/evil.png',
  ];
  for (const file of unsafe) {
    const raw = rawManifest();
    raw.skins[0].assets.idle.file = file;
    assert.throws(() => validateCharacterManifest(raw), /asset|path|png|unsafe|relative|segment/i, file);
  }

  const stringForm = rawManifest();
  stringForm.skins[0].assets.idle = '../evil.png';
  assert.throws(() => validateCharacterManifest(stringForm), /asset|path|relative|segment/i);
});

test('without availableFiles validation is structural and does not claim a disk check', () => {
  const raw = rawManifest();
  raw.skins[0].assets.idle.file = 'not-present.png';
  const manifest = validateCharacterManifest(raw);
  assert.equal(getSkin(manifest, 'muse').assets.idle.file, 'not-present.png');
});

test('no available skin raises a clear error', () => {
  assert.throws(
    () => validateCharacterManifest(rawManifest(), { availableFiles: new Set() }),
    /no valid skins/,
  );
});

test('getSkin and resolvePoseAsset do not fall back between skins', () => {
  const manifest = validateCharacterManifest(rawManifest());
  const muse = getSkin(manifest, 'muse');
  const amber = getSkin(manifest, 'amber-scholar');

  assert.equal(getSkin(manifest, 'missing'), null);
  assert.equal(resolvePoseAsset(amber, 'blink'), null);
  assert.equal(resolvePoseAsset(amber, 'shy'), null);
  assert.deepEqual(resolvePoseAsset(muse, 'shy'), {
    file: 'zenix-muse-shy.png',
    crop: [0, 0, 1086, 1448],
  });
  assert.deepEqual(resolvePoseAsset(amber, 'idle'), {
    file: 'amber-scholar.png',
    crop: [0, 0, 543, 724],
  });
});
