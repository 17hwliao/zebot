import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseXingyinPose,
  createXingyinFigure,
} from '../src/renderer/figures/xingyin.js';

const OUTFIT_SKINS = [
  'amber-scholar',
  'azure-fan',
  'ink-fox',
  'ivory-dragon',
  'moon-piano',
  'noir-gold',
  'ocean-maid',
  'violet-stars',
];

test('the figure module imports in Node without a document and exposes its factory', () => {
  assert.equal(typeof chooseXingyinPose, 'function');
  assert.equal(typeof createXingyinFigure, 'function');
  assert.equal(typeof globalThis.document, 'undefined');
});

test('muse selects listening, shy, blink, and idle from the frame rules', () => {
  assert.equal(chooseXingyinPose('muse', { face: 'listening' }), 'listening');
  assert.equal(chooseXingyinPose('muse', { face: 'shy' }), 'shy');
  assert.equal(chooseXingyinPose('muse', { mode: 'sleep' }), 'blink');
  assert.equal(chooseXingyinPose({ id: 'muse' }, { face: 'sleep' }), 'blink');
  assert.equal(chooseXingyinPose('muse', { face: 'neutral', blink: 1 }), 'blink');
  assert.equal(chooseXingyinPose('muse', { face: 'neutral', blink: 0.49 }), 'idle');
  assert.equal(chooseXingyinPose('muse', { face: 'happy', mode: 'idle' }), 'idle');
  assert.equal(chooseXingyinPose('muse', { face: 'speaking', mode: 'speaking' }), 'idle');
  assert.equal(chooseXingyinPose('muse', undefined), 'idle');
});

test('every outfit skin stays on its own idle pose regardless of face or body state', () => {
  const frames = [
    { face: 'listening', mode: 'idle' },
    { face: 'shy', mode: 'idle' },
    { face: 'sleep', mode: 'sleep' },
    { face: 'neutral', mode: 'idle', blink: 1 },
    { face: 'happy', mode: 'walk' },
  ];
  for (const skin of OUTFIT_SKINS) {
    for (const frame of frames) {
      assert.equal(chooseXingyinPose(skin, frame), 'idle', `${skin} ${JSON.stringify(frame)}`);
    }
  }
});

test('factory rejects cleanly instead of touching document during Node import', async () => {
  await assert.rejects(createXingyinFigure(), /requires a DOM document/);
});
