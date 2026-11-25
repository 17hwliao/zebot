import test from 'node:test';
import assert from 'node:assert/strict';
import { createPet } from '../src/renderer/kit/body.js';
import { createMotionDemo, performMotion } from '../src/renderer/motion-demo.js';
import { evaluateZenbotRig } from '../src/renderer/characters/zenbot-rig-motions.js';
import { normalizeCharacterConfig } from '../src/main/config.js';

function createBody() {
  const samples = [];
  const node = () => ({ setAttribute() {}, innerHTML: '', textContent: '' });
  const body = createPet({ petG: node(), shadowEl: node(), fxG: node() }, {
    bounds: () => ({ W: 1400, H: 620, floorY: 604, S: 1.18 }),
    startX: 350,
    roam: 'off',
    sfx: { play() {} },
    figure: {
      draw(group, face, frame) { samples.push({ ...frame, legs: structuredClone(frame.legs) }); },
    },
  });
  return { body, samples };
}

test('walk moves the real kit body across the stage while alternating its feet', () => {
  const { body, samples } = createBody();
  const start = body.pet.x;
  assert.equal(performMotion(body, 'walk'), true);
  for (let index = 0; index < 100; index += 1) {
    body.step(1 / 60);
    body.render();
  }
  assert.ok(body.pet.x > start + 100);
  assert.ok(samples.some((frame) => frame.legs[0][2] - frame.legs[0][0] > 4));
  assert.ok(samples.some((frame) => frame.legs[0][2] - frame.legs[0][0] < -4));
  assert.equal(body.roam, 'off');
});

test('automatic demo starts with walking without waiting for idle or wake events', () => {
  const { body } = createBody();
  const demo = createMotionDemo(body);
  demo.tick(0);
  demo.tick(16);
  assert.equal(body.pet.mode, 'walk');
  demo.play('run');
  demo.tick(32);
  assert.equal(body.pet.mode, 'run');
  assert.equal(demo.automatic, false);
  assert.equal(demo.play('../unsafe'), false);
});

test('zenbot feet follow the kit gait phase even when mode clocks differ', () => {
  for (const mode of ['walk', 'run']) {
    const first = evaluateZenbotRig({ mode, modeT: 0.5 }, 1, { gaitPhase: 0.25 });
    const later = evaluateZenbotRig({ mode, modeT: 1.7 }, 5, { gaitPhase: 0.25 });
    assert.equal(first.deformers.leg_l.a, later.deformers.leg_l.a);
    assert.equal(first.motion.phase, 0.25);
    const other = evaluateZenbotRig({ mode, modeT: 0.5 }, 1, { gaitPhase: 0.75 });
    assert.ok(first.deformers.leg_l.a * other.deformers.leg_l.a < 0);
  }
});

test('old star and robot preferences migrate to the dynamic zenbot', () => {
  for (const figure of ['xingyin', 'terminal-bot']) {
    const migrated = normalizeCharacterConfig({ figure, zenbotRenderer: 'sprite' });
    assert.equal(migrated.figure, 'zenbot');
    assert.equal(migrated.zenbotRenderer, 'auto');
  }
});
