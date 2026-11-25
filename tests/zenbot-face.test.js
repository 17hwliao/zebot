import test from 'node:test';
import assert from 'node:assert/strict';
import { createZenbotFaceAnimator } from '../src/renderer/figures/zenbot-face.js';

function fixture() {
  const draws = [];
  const context = {
    drawImage(...args) { draws.push(args); },
    save() {}, restore() {}, scale() {}, globalAlpha: 1,
    beginPath() {}, ellipse() {}, fill() {},
  };
  const canvas = { getContext: () => context };
  const base = { width: 449, height: 613 };
  const closed = { width: 449, height: 613 };
  const animator = createZenbotFaceAnimator({ createElement: () => canvas }, closed);
  return { animator, base, closed, canvas, draws };
}

test('blink and speech visibly composite own expression patches instead of unused parameters', () => {
  const { animator, base, closed, canvas, draws } = fixture();
  assert.equal(animator.render(base, { face: 'neutral', blink: 1, talk: 1, time: 1 }), canvas);
  assert.equal(draws.filter(([image]) => image === closed).length, 2);
  assert.equal(canvas.width, 449);
  assert.equal(canvas.height, 613);
});

test('unchanged face does not reupload and returning to rest restores the source', () => {
  const { animator, base } = fixture();
  assert.equal(animator.render(base, { face: 'neutral', blink: 0, talk: 0, time: 0 }), base);
  assert.equal(animator.render(base, { face: 'neutral', blink: 0, talk: 0, time: 1 }), null);
  animator.render(base, { face: 'neutral', blink: 1, talk: 0, time: 2 });
  assert.equal(animator.render(base, { face: 'neutral', blink: 0, talk: 0, time: 3 }), base);
});

test('special expressions retain their own eyes and mouth', () => {
  const { animator, base, closed, draws } = fixture();
  for (const face of ['wink', 'love', 'cry', 'sleepy']) {
    assert.equal(animator.render(base, { face, blink: 1, talk: 1, time: 1 }), base);
  }
  assert.equal(draws.filter(([image]) => image === closed).length, 2);
});
