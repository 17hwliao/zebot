import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWhaleFigure } from '../src/renderer/figures/whale.js';

const root = new URL('../assets/characters/whale/', import.meta.url);
const model = JSON.parse(readFileSync(new URL('model.json', root), 'utf8'));
const metadata = JSON.parse(readFileSync(new URL('figure.json', root), 'utf8'));

test('all whale colour/outfit combinations have decodable PNG headers for every referenced texture', () => {
  const features = [
    ...Object.keys(model.feat.sprites),
    ...['eyeL', 'eyeR'].flatMap((eye) => ['lash', 'ball', 'iris', ...(model.feat.eyes[eye].rim ? ['rim'] : [])].map((name) => `${eye}_${name}`)),
  ];
  const schemes = model.schemes.filter((scheme) => scheme.ready !== false);
  assert.equal(schemes.length, 8);
  assert.equal(model.outfits.length, 3);
  for (const scheme of schemes) {
    const directory = scheme.id === schemes[0].id ? '' : `schemes/${scheme.id}/`;
    const files = new Set(features.map((name) => `${directory}feat/${name}.png`));
    if (scheme.eyeHighlights) {
      files.add(`${directory}feat/eyeL_hl.png`);
      files.add(`${directory}feat/eyeR_hl.png`);
    }
    for (const outfit of model.outfits) {
      for (const part of outfit.parts ?? model.parts) files.add(part.src ?? `${directory}tex/${part.tex}.png`);
    }
    for (const file of files) {
      const buffer = readFileSync(new URL(file, root));
      assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file);
      assert.ok(buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0, file);
    }
  }
  assert.equal(metadata.id, 'whale');
  assert.ok(metadata.credits.length >= 2);
  assert.match(readFileSync(new URL('LICENSE', root), 'utf8'), /AGPL|AGPL-3|AFFERO/);
});

test('whale adapter retains the original figure and injects the local rig without changing upstream code', async () => {
  let received = null;
  const upstream = { draw() {}, dispose() {}, anchors: { bubble: [128, 18] } };
  const figure = await createWhaleFigure({
    documentUrl: 'http://127.0.0.1:1234/index.html',
    skin: 'deepseek-crew',
    async factory(base, options) {
      received = { base, options };
      return upstream;
    },
  });
  assert.equal(figure, upstream);
  assert.equal(received.base.href, 'http://127.0.0.1:1234/characters/whale/');
  assert.equal(received.options.scheme, 'deepseek-crew');
  assert.equal(received.options.raster, true);
  assert.equal(typeof received.options.kit.createRig, 'function');
});
