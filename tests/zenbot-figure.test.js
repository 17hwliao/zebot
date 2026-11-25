import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZENBOT_GESTURES,
  ZENBOT_PARTICLES,
  chooseZenbotExpression,
  chooseZenbotMotion,
  createZenbotFigure,
} from '../src/renderer/figures/zenbot.js';

test('zenbot figure module imports in Node and exposes its pure selectors', () => {
  assert.equal(typeof chooseZenbotExpression, 'function');
  assert.equal(typeof chooseZenbotMotion, 'function');
  assert.equal(typeof createZenbotFigure, 'function');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.deepEqual(ZENBOT_GESTURES, ['nod', 'shake', 'spin', 'wave', 'bow', 'shiver', 'flap']);
  assert.deepEqual(ZENBOT_PARTICLES, {
    heart: false,
    z: false,
    tear: false,
    note: false,
  });
});

test('expressions follow the kit face names and manifest aliases', () => {
  const aliases = {
    listening: 'neutral',
    sleep: 'sleepy',
    content: 'happy',
    waking: 'sleepy',
    dragged: 'scared',
  };
  assert.equal(chooseZenbotExpression('happy', aliases), 'happy');
  assert.equal(chooseZenbotExpression('listening', aliases), 'neutral');
  assert.equal(chooseZenbotExpression('sleep', aliases), 'sleepy');
  assert.equal(chooseZenbotExpression('waking', aliases), 'sleepy');
  assert.equal(chooseZenbotExpression('dragged', aliases), 'scared');
  assert.equal(chooseZenbotExpression('not-a-face', aliases), 'neutral');
  assert.equal(chooseZenbotExpression(undefined, aliases), 'neutral');
});

test('gestures win over the current body mode', () => {
  for (const kind of ZENBOT_GESTURES) {
    assert.equal(chooseZenbotMotion({ mode: 'walk', gesture: { kind, k: 0.4 } }), kind);
  }
});

test('body modes map to the matching zenbot keyframe', () => {
  assert.equal(chooseZenbotMotion({ mode: 'walk' }), 'walk');
  assert.equal(chooseZenbotMotion({ mode: 'run' }), 'run');
  assert.equal(chooseZenbotMotion({ mode: 'look' }), 'look');
  assert.equal(chooseZenbotMotion({ mode: 'sit' }), 'sit');
  assert.equal(chooseZenbotMotion({ mode: 'sleep' }), 'sleep');
  assert.equal(chooseZenbotMotion({ mode: 'dizzy' }), 'dizzy');
  assert.equal(chooseZenbotMotion({ mode: 'dance' }), 'dance');
  assert.equal(chooseZenbotMotion({ mode: 'air' }), 'jump');
  assert.equal(chooseZenbotMotion({ mode: 'wake' }), 'stand');
  assert.equal(chooseZenbotMotion({ mode: 'idle' }), null);
});

test('crouch distinguishes a full jump from a small hop by jump speed', () => {
  assert.equal(chooseZenbotMotion({ mode: 'crouch', jumpV: 720 }), 'jump');
  assert.equal(chooseZenbotMotion({ mode: 'crouch', jumpV: 480 }), 'hop');
  assert.equal(chooseZenbotMotion({ mode: 'crouch' }), 'hop');
});

test('a facing change asks for the turn keyframe when nothing else is playing', () => {
  assert.equal(chooseZenbotMotion({ mode: 'idle' }, { turn: true }), 'turn');
  assert.equal(chooseZenbotMotion({ mode: 'walk' }, { turn: true }), 'walk');
  assert.equal(chooseZenbotMotion({ mode: 'idle', gesture: { kind: 'nod', k: 0.2 } }, { turn: true }), 'nod');
});

test('factory rejects cleanly instead of touching document during Node import', async () => {
  await assert.rejects(createZenbotFigure(), /requires a DOM document/);
});
