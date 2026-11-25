import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRig } from '../src/renderer/kit/rig.js';
import { createPet } from '../src/renderer/kit/body.js';
import { sampleZenbotGait, installZenbotGait, constrainZenbotGait } from '../src/renderer/characters/zenbot-gait.js';
import { installZenbotHair, anchorZenbotHair } from '../src/renderer/characters/zenbot-hair.js';
import {
  ZENBOT_RIG_ERROR_CODES,
  ZENBOT_RIG_REFERENCE,
  chooseZenbotRigExpression,
  createZenbotRigModel,
  listZenbotRigFiles,
  resolveZenbotRigExpression,
  validateZenbotRigManifest,
} from '../src/renderer/characters/zenbot-rig-manifest.js';
import {
  ZENBOT_RIG_MOTION_SECONDS,
  ZENBOT_RIG_PARAM_KEYS,
  createZenbotRigFigure,
  evaluateZenbotRigMotion,
  smoothZenbotRigPose,
  zenbotRigIdlePose,
} from '../src/renderer/figures/zenbot-rig.js';
import { ZENBOT_EXPRESSION_IDS, ZENBOT_MOTION_IDS } from '../src/renderer/characters/zenbot-manifest.js';
import { chooseZenbotMotion } from '../src/renderer/figures/zenbot.js';
import {
  adaptZenbotRigState,
  evaluateZenbotRig,
} from '../src/renderer/characters/zenbot-rig-motions.js';

const ALIASES = {
  listening: 'neutral',
  sleep: 'sleepy',
  content: 'happy',
  waking: 'sleepy',
  squeeze: 'neutral',
  bowing: 'happy',
  dragged: 'scared',
  run: 'determined',
  dizzy: 'confused',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validFixture() {
  const expressions = {};
  for (const id of ZENBOT_EXPRESSION_IDS) {
    expressions[id] = id === 'happy'
      ? 'face_happy'
      : { file: `expressions/${id}.png` };
  }
  const motions = {};
  for (const id of ZENBOT_MOTION_IDS) motions[id] = { seconds: ZENBOT_RIG_MOTION_SECONDS[id] };

  return {
    schemaVersion: 1,
    id: 'zenbot-rig',
    name: 'zenbot',
    license: 'user-owned-local',
    source: 'assets/characters/zenbot/source/zenbot-master-trim.png',
    drawing: {
      logoHeight: 292,
      centerX: 128,
      feetY: 256,
      referenceCanvas: [1117, 1409],
      view: [0, 0, 256, 256],
    },
    defaults: {
      expression: 'neutral',
      bubbleAnchor: [128, -58],
      hit: [128, 118, 142],
      extent: [-28, -72, 284, 256],
      accent: '#63d8ff',
      eye: '#4fd6ff',
    },
    textures: {
      torso: 'parts/torso.png',
      face_happy: 'expressions/happy.png',
    },
    parts: [
      { id: 'hair_back', file: 'parts/hair_back.png', box: [40, -5, 180, 130], grid: [8, 8], parent: 'hair_back', z: 10 },
      { id: 'leg_l', file: 'parts/leg_l.png', box: [82, 202, 42, 58], grid: [5, 8], parent: 'leg_l', z: 20 },
      { id: 'leg_r', file: 'parts/leg_r.png', box: [132, 202, 42, 58], grid: [5, 8], parent: 'leg_r', z: 20 },
      { id: 'torso', tex: 'torso', box: [56, 142, 144, 84], grid: [10, 8], parent: 'chest', z: 36 },
      { id: 'skirt_front', file: 'parts/skirt_front.png', box: [56, 194, 144, 44], grid: [10, 4], parent: 'skirt', z: 40 },
      { id: 'arm_l', file: 'parts/arm_l.png', box: [40, 155, 52, 95], grid: [6, 10], parent: 'arm_l', z: 50 },
      { id: 'arm_r', file: 'parts/arm_r.png', box: [164, 155, 52, 95], grid: [6, 10], parent: 'arm_r', z: 50 },
      { id: 'face_base', file: 'parts/face_base.png', box: [45, 6, 166, 138], grid: [10, 10], parent: 'head', z: 60 },
    ],
    deformers: {
      root: { parent: null, pivot: [128, 256] },
      body: { parent: 'root', pivot: [128, 232] },
      skirt: { parent: 'body', pivot: [128, 204] },
      leg_l: { parent: 'skirt', pivot: [109, 219] },
      leg_r: { parent: 'skirt', pivot: [147, 219] },
      chest: { parent: 'body', pivot: [128, 210] },
      arm_l: { parent: 'chest', pivot: [88, 156] },
      arm_r: { parent: 'chest', pivot: [168, 156] },
      head: { parent: 'chest', pivot: [128, 96] },
      hair_back: { parent: 'head', pivot: [128, 78] },
    },
    expressions,
    expressionAliases: { ...ALIASES },
    motions,
    timing: {
      expressionFadeMs: 180,
      blinkCloseMs: 130,
      breathSeconds: 4.2,
      motionTailMs: 140,
      turnMs: 420,
    },
    fallback: {
      figure: 'sprite',
      manifest: 'assets/characters/zenbot/manifest.json',
    },
  };
}

function validFiles(raw = validFixture()) {
  return new Set(listZenbotRigFiles(validateZenbotRigManifest(raw)));
}

function expectCode(code, pattern) {
  return (error) => {
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  };
}

test('valid rig manifest is normalised with frozen coordinates and complete coverage', () => {
  const manifest = validateZenbotRigManifest(validFixture());
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.drawing.referenceCanvas, [1117, 1409]);
  assert.deepEqual(manifest.drawing.view, [0, 0, 256, 256]);
  assert.equal(manifest.drawing.centerX, ZENBOT_RIG_REFERENCE.centerX);
  assert.equal(manifest.drawing.feetY, ZENBOT_RIG_REFERENCE.feetY);
  assert.equal(manifest.drawing.logoHeight, ZENBOT_RIG_REFERENCE.logoHeight);
  assert.equal(manifest.parts.find((part) => part.id === 'face_base').tex, 'face_base');
  assert.deepEqual(manifest.parts.find((part) => part.id === 'torso').uvBox, [0, 0, 1, 1]);
  assert.equal(manifest.deformers.head.kind, 'rot');
  assert.deepEqual(manifest.deformers.head.pivot, [128, 96]);
  assert.equal(manifest.expressions.neutral.file, 'expressions/neutral.png');
  assert.equal(manifest.expressions.happy.file, 'expressions/happy.png');
  assert.equal(manifest.expressionAliases.sleep, 'sleepy');
  assert.equal(manifest.coverage.complete, true);
  assert.deepEqual(manifest.coverage.expressions.missing, []);
  assert.deepEqual(manifest.coverage.motions.missing, []);
  assert.equal(manifest.timing.expressionFadeMs, 180);

  const withoutDefaults = validFixture();
  delete withoutDefaults.defaults;
  const fallbackDefaults = validateZenbotRigManifest(withoutDefaults);
  assert.deepEqual(fallbackDefaults.defaults.bubbleAnchor, [128, -58]);
  assert.deepEqual(fallbackDefaults.defaults.hit, [128, 118, 142]);
  assert.deepEqual(fallbackDefaults.defaults.extent, [-28, -72, 284, 256]);
  assert.equal(fallbackDefaults.defaults.accent, '#63d8ff');
});

test('rig model keeps part order for equal z values and emits the kit schema', () => {
  const raw = validFixture();
  raw.parts[1].z = 36;
  raw.parts[2].z = 36;
  const manifest = validateZenbotRigManifest(raw);
  const model = createZenbotRigModel(manifest);
  assert.deepEqual(model.parts.map((part) => part.id), raw.parts.map((part) => part.id));
  assert.deepEqual(model.parts[3].box, [56, 142, 144, 84]);
  assert.deepEqual(model.parts[3].grid, [10, 8]);
  assert.equal(model.parts[3].tex, 'torso');
  assert.equal(model.parts[7].z, 60);
  assert.deepEqual(model.deformers.body.pivot, [128, 232]);
  assert.equal(model.deformers.root.parent, null);
});

test('unsafe paths and malformed geometry are rejected with the manifest error code', () => {
  const cases = [
    (raw) => { raw.textures.torso = '../torso.png'; },
    (raw) => { raw.textures.torso = 'C:/torso.png'; },
    (raw) => { raw.parts[1].file = 'parts\\leg_l.png'; },
    (raw) => { raw.expressions.wink = { file: '/expressions/wink.png' }; },
    (raw) => { raw.expressions.happy = 'missing_texture'; },
    (raw) => { raw.source = 42; },
    (raw) => { raw.drawing.referenceCanvas = [1000, 1409]; },
    (raw) => { raw.drawing.centerX = 127; },
    (raw) => { raw.drawing.feetY = 255; },
    (raw) => { raw.drawing.view = [0, 0, 0, 256]; },
    (raw) => { raw.parts[0].box[2] = 0; },
    (raw) => { raw.parts[0].box[3] = -1; },
    (raw) => { raw.parts[0].grid = [0, 8]; },
    (raw) => { raw.parts[0].grid = [2.5, 8]; },
    (raw) => { raw.parts[0].uvBox = [0, 0, 1.2, 1]; },
    (raw) => { raw.parts[0].alpha = 2; },
    (raw) => { raw.parts[0].parent = 'not_a_deformer'; },
    (raw) => { raw.parts[0].id = 'face_base'; },
    (raw) => { raw.deformers.chest.parent = 'not_a_deformer'; },
    (raw) => { raw.deformers.body.parent = 'head'; },
    (raw) => { raw.deformers.root.kind = 'bend'; },
    (raw) => { raw.parts = raw.parts.filter((part) => part.id !== 'face_base'); },
    (raw) => { delete raw.expressions.neutral; },
  ];
  for (const mutate of cases) {
    const raw = validFixture();
    mutate(raw);
    assert.throws(
      () => validateZenbotRigManifest(raw),
      expectCode(ZENBOT_RIG_ERROR_CODES.MANIFEST),
      mutate.toString(),
    );
  }
});

test('availableFiles filters optional expressions, warns on a missing face file, and rejects missing parts', () => {
  const files = validFiles();
  files.delete('expressions/happy.png');
  const filtered = validateZenbotRigManifest(validFixture(), { availableFiles: files });
  assert.equal(filtered.expressions.happy, undefined);
  assert.ok(filtered.coverage.expressions.missing.includes('happy'));
  assert.ok(filtered.warnings.some((warning) => warning.code === 'RIG_MANIFEST_MISSING_EXPRESSION'));

  const faceFiles = validFiles();
  faceFiles.delete('parts/face_base.png');
  const faceFallback = validateZenbotRigManifest(validFixture(), { availableFiles: faceFiles });
  assert.equal(faceFallback.parts.find((part) => part.id === 'face_base').file, 'expressions/neutral.png');
  assert.ok(faceFallback.warnings.some((warning) => warning.code === 'RIG_MANIFEST_MISSING_FACE_FILE'));

  const partFiles = validFiles();
  partFiles.delete('parts/torso.png');
  assert.throws(
    () => validateZenbotRigManifest(validFixture(), { availableFiles: partFiles }),
    expectCode(ZENBOT_RIG_ERROR_CODES.MANIFEST, /not available/),
  );
});

test('aliases must match the sprite manifest exactly', () => {
  const expected = validFixture().expressionAliases;

  const changed = validFixture();
  changed.expressionAliases.sleep = 'happy';
  assert.throws(
    () => validateZenbotRigManifest(changed, { expectedAliases: expected }),
    expectCode(ZENBOT_RIG_ERROR_CODES.MANIFEST, /sprite manifest alias/),
  );

  const missing = validFixture();
  delete missing.expressionAliases.content;
  assert.throws(
    () => validateZenbotRigManifest(missing, { expectedAliases: expected }),
    expectCode(ZENBOT_RIG_ERROR_CODES.MANIFEST),
  );

  const extra = validFixture();
  extra.expressionAliases.cheerful = 'happy';
  assert.throws(
    () => validateZenbotRigManifest(extra, { expectedAliases: expected }),
    expectCode(ZENBOT_RIG_ERROR_CODES.MANIFEST),
  );

  const unknown = validFixture();
  unknown.expressionAliases.sleep = 'not-a-face';
  assert.throws(
    () => validateZenbotRigManifest(unknown),
    expectCode(ZENBOT_RIG_ERROR_CODES.MANIFEST),
  );
});

test('missing individual expressions and motions are recorded without failing the rig', () => {
  const raw = validFixture();
  delete raw.expressions.happy;
  delete raw.motions.dance;
  const manifest = validateZenbotRigManifest(raw);
  assert.deepEqual(manifest.coverage.expressions.missing, ['happy']);
  assert.deepEqual(manifest.coverage.motions.missing, ['dance']);
  assert.equal(manifest.coverage.complete, false);
  assert.ok(manifest.warnings.some((warning) => warning.code === 'RIG_MANIFEST_MISSING_EXPRESSION'));
  assert.ok(manifest.warnings.some((warning) => warning.code === 'RIG_MANIFEST_MISSING_MOTION'));
});

test('expression selection follows aliases and falls back to neutral', () => {
  const manifest = validateZenbotRigManifest(validFixture());
  assert.equal(chooseZenbotRigExpression('happy', manifest), 'happy');
  assert.equal(chooseZenbotRigExpression('listening', manifest), 'neutral');
  assert.equal(chooseZenbotRigExpression('sleep', manifest), 'sleepy');
  assert.equal(chooseZenbotRigExpression('dragged', manifest), 'scared');
  assert.equal(chooseZenbotRigExpression('not-a-face', manifest), 'neutral');
  assert.equal(chooseZenbotRigExpression(undefined, manifest), 'neutral');

  const raw = validFixture();
  delete raw.expressions.happy;
  delete raw.expressions.content;
  const missing = validateZenbotRigManifest(raw);
  assert.equal(chooseZenbotRigExpression('happy', missing), 'neutral');
  assert.deepEqual(resolveZenbotRigExpression('happy', missing), {
    requested: 'happy',
    target: 'happy',
    id: 'neutral',
    file: 'expressions/neutral.png',
    fallback: true,
  });
});

test('all 18 actions have the same selection rules as the sprite figure', () => {
  const cases = {
    stand: [{ mode: 'wake' }, {}],
    jump: [{ mode: 'crouch', jumpV: 720 }, {}],
    hop: [{ mode: 'crouch', jumpV: 480 }, {}],
    look: [{ mode: 'look' }, {}],
    turn: [{ mode: 'idle' }, { turn: true }],
    nod: [{ mode: 'idle', gesture: { kind: 'nod', k: 0.2 } }, {}],
    shake: [{ mode: 'idle', gesture: { kind: 'shake', k: 0.2 } }, {}],
    spin: [{ mode: 'idle', gesture: { kind: 'spin', k: 0.2 } }, {}],
    sit: [{ mode: 'sit' }, {}],
    sleep: [{ mode: 'sleep' }, {}],
    dizzy: [{ mode: 'dizzy' }, {}],
    walk: [{ mode: 'walk' }, {}],
    run: [{ mode: 'run' }, {}],
    wave: [{ mode: 'idle', gesture: { kind: 'wave', k: 0.2 } }, {}],
    bow: [{ mode: 'idle', gesture: { kind: 'bow', k: 0.2 } }, {}],
    shiver: [{ mode: 'idle', gesture: { kind: 'shiver', k: 0.2 } }, {}],
    flap: [{ mode: 'crouch', jumpV: 540, gesture: { kind: 'flap', k: 0.2 } }, {}],
    dance: [{ mode: 'dance' }, {}],
  };
  for (const [expected, [frame, options]] of Object.entries(cases)) {
    assert.equal(chooseZenbotMotion(frame, options), expected);
  }
});

test('every action evaluates to finite rig parameters and distinct motion cues', () => {
  const timing = { breathSeconds: 4.2 };
  for (const motion of ZENBOT_MOTION_IDS) {
    const frame = {
      mode: motion === 'jump' || motion === 'hop' || motion === 'flap' ? 'crouch' : 'idle',
      modeT: 0.4,
      gesture: { kind: motion, k: 0.5 },
      talk: 0.3,
      look: [3, -2],
      facing: 1,
      jumpV: 700,
      airKind: 'jump',
    };
    const pose = evaluateZenbotRigMotion(motion, frame, 1.2, { timing, turnK: 0.6 });
    for (const key of ZENBOT_RIG_PARAM_KEYS) {
      assert.equal(Number.isFinite(pose[key]), true, `${motion}.${key}`);
    }
    assert.ok(pose.bodyScaleX > 0.1 || motion === 'spin');
  }

  const wave = evaluateZenbotRigMotion('wave', {
    mode: 'idle',
    gesture: { kind: 'wave', k: 0.5 },
  }, 1, { timing });
  assert.ok(wave.armRRot < -40);

  const spin = evaluateZenbotRigMotion('spin', {
    mode: 'idle',
    gesture: { kind: 'spin', k: 0.5 },
  }, 1, { timing });
  assert.ok(spin.bodyScaleX < -0.5);

  const nod = evaluateZenbotRigMotion('nod', {
    mode: 'idle',
    gesture: { kind: 'nod', k: 0.125 },
  }, 1, { timing });
  assert.ok(Math.abs(nod.headRot) > 1);

  const walk = evaluateZenbotRigMotion('walk', { mode: 'walk', modeT: 0.15 }, 1, { timing });
  assert.ok(walk.legL * walk.legR < 0);

  const turn = evaluateZenbotRigMotion('turn', { mode: 'idle' }, 1, { timing, turnK: 0.8 });
  assert.ok(turn.bodyRot > 1);
});

test('pose smoothing stays finite and moves toward the target', () => {
  const timing = { breathSeconds: 4.2 };
  const previous = zenbotRigIdlePose(0, {}, timing);
  const target = evaluateZenbotRigMotion('wave', {
    mode: 'idle',
    modeT: 0,
    gesture: { kind: 'wave', k: 0.5 },
  }, 0, { timing });
  const next = smoothZenbotRigPose(previous, target, 0.05, 22);
  for (const key of ZENBOT_RIG_PARAM_KEYS) assert.equal(Number.isFinite(next[key]), true, key);
  assert.ok(
    Math.abs(next.armRRot - target.armRRot) < Math.abs(previous.armRRot - target.armRRot),
  );
});

test('the motion worker state adapts to the normalised rig manifest', () => {
  const manifest = validateZenbotRigManifest(validFixture());
  const state = evaluateZenbotRig({
    mode: 'walk',
    modeT: 0.5,
    face: 'happy',
    talk: 0.4,
    look: [2, -1],
    gesture: { kind: 'wave', k: 0.5 },
  }, 2, { manifest, blink: 0.25 });
  const adapted = adaptZenbotRigState(state, manifest);
  assert.equal(state.motion.gestureId, 'wave');
  assert.equal(state.expression.face, 'happy');
  assert.equal(Number.isFinite(state.mouth.openUnits), true);
  for (const id of ['body', 'chest', 'head', 'hair_back', 'arm_l', 'arm_r', 'skirt', 'leg_l', 'leg_r']) {
    assert.equal(adapted.deformers[id].a != null, true, id);
    assert.equal(Number.isFinite(adapted.deformers[id].sx), true, `${id}.sx`);
  }
  assert.ok(adapted.deformers.arm_r.a < -20);

  const turnState = evaluateZenbotRig({ mode: 'idle' }, 0.2, {
    manifest,
    motion: 'turn',
    motionT: 0.2,
  });
  const turnAdapted = adaptZenbotRigState(turnState, manifest);
  assert.equal(turnState.motion.id, 'turn');
  assert.ok(turnAdapted.deformers.body.sx < 0.9);
});

test('factory rejects in Node without a DOM and without a usable WebGL surface', async () => {
  await assert.rejects(
    createZenbotRigFigure(),
    (error) => error.code === ZENBOT_RIG_ERROR_CODES.DOM,
  );

  const document = createHeadlessDocument();
  await assert.rejects(
    createZenbotRigFigure({
      document,
      manifest: validFixture(),
      loadReferenceManifest: false,
    }),
    (error) => error.code === ZENBOT_RIG_ERROR_CODES.WEBGL,
  );
});

test('factory mounts on a mock WebGL surface, draws, and reports unrecoverable context loss', async () => {
  const { document, canvases } = createMockGlDocument();
  const failures = [];
  const errors = [];
  const figure = await createZenbotRigFigure({
    document,
    manifest: validFixture(),
    loadReferenceManifest: false,
    contextLossTimeoutMs: 60,
    onError: (error) => errors.push(error),
    onFailure: (error) => failures.push(error),
  });

  assert.equal(figure.renderer, 'rig');
  assert.equal(figure.state, 'ready');
  assert.equal(figure.stats.parts, 8);
  assert.equal(figure.stats.motionEngine, 'zenbot-rig-motions');
  assert.equal(figure.complete, true);
  assert.deepEqual(figure.coverage.expressions.missing, []);
  assert.deepEqual(figure.warnings, []);
  assert.equal(figure.skinMeta.label, 'zenbot');
  assert.deepEqual(figure.anchors.bubble, [128, -58]);
  assert.deepEqual(figure.hits, [[128, 118, 142]]);
  assert.deepEqual(figure.extent, [-28, -72, 284, 256]);
  assert.equal(figure.gestures.includes('wave'), true);
  assert.equal(figure.particles.heart, false);
  assert.equal(figure.colors.z, '#63d8ff');

  const petG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const frame = {
    t: 0,
    face: 'neutral',
    mode: 'idle',
    modeT: 0,
    talk: 0,
    facing: 1,
    gesture: null,
    jumpV: 0,
    airKind: 'jump',
  };
  figure.draw(petG, 'neutral', frame);
  figure.draw(petG, 'happy', { ...frame, t: 0.02, face: 'happy' });
  await new Promise((resolve) => setImmediate(resolve));
  figure.draw(petG, 'happy', { ...frame, t: 0.1, face: 'happy' });
  figure.draw(petG, 'happy', { ...frame, t: 0.25, face: 'happy' });
  figure.draw(petG, 'happy', { ...frame, t: 0.4, face: 'happy' });
  assert.ok(figure.stats.draws >= 4);
  assert.ok(figure.stats.cachedTextures >= figure.stats.parts);

  await figure.preloadWord('nod');
  await figure.preloadWord('happy');
  await assert.rejects(figure.preloadWord('not-a-word'), /unknown zenbot rig preview word/);
  assert.deepEqual(figure.setCalibration({ x: 2, y: 3, scale: 0.9 }), { x: 2, y: 3, scale: 0.9 });
  assert.deepEqual(figure.calibration, { x: 2, y: 3, scale: 0.9 });

  const canvas = canvases[0];
  canvas.emit('webglcontextlost', { preventDefault() {} });
  assert.equal(figure.state, 'lost');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(figure.state, 'failed');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, ZENBOT_RIG_ERROR_CODES.CONTEXT_LOST);
  assert.ok(errors.some((error) => error.code === ZENBOT_RIG_ERROR_CODES.CONTEXT_LOST));

  figure.draw(petG, 'neutral', { ...frame, t: 0.5 });
  figure.dispose();
  assert.equal(figure.state, 'disposed');
});

test('factory falls back to the built-in motion layer when the motion library is disabled', async () => {
  const { document } = createMockGlDocument();
  const figure = await createZenbotRigFigure({
    document,
    manifest: validFixture(),
    loadReferenceManifest: false,
    useMotionLibrary: false,
  });
  assert.equal(figure.stats.motionEngine, 'builtin');
  const petG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  figure.draw(petG, 'neutral', {
    t: 0.5,
    face: 'neutral',
    mode: 'walk',
    modeT: 0.5,
    talk: 0.2,
    facing: 1,
    gesture: null,
    blink: 0.3,
    jumpV: 0,
    airKind: 'jump',
  });
  assert.ok(figure.stats.draws >= 1);
  figure.dispose();
  assert.equal(figure.state, 'disposed');
});

test('real zenbot gait keeps soles horizontal and grounded, hips attached, and skirt independent', () => {
  const raw = JSON.parse(readFileSync(new URL('../assets/characters/zenbot/rig/manifest.json', import.meta.url), 'utf8'));
  const manifest = validateZenbotRigManifest(raw);
  const model = createZenbotRigModel(manifest);
  const contacts = installZenbotGait(model);
  const { document } = createMockGlDocument();
  const rig = createRig(document.createElement('canvas'), model);
  for (const mode of ['walk', 'run']) {
    for (let index = 0; index <= 160; index += 1) {
      const phase = index / 160;
      const frame = { mode, modeT: 1, facing: 1 };
      const states = adaptZenbotRigState(evaluateZenbotRig(frame, 1, { gaitPhase: phase }), manifest).deformers;
      states.body = { a: 3, tx: 1.5, ty: 2, sx: 0.99, sy: 1.01 };
      states.skirt = { a: 18, tx: 7, ty: -3 };
      const feet = sampleZenbotGait(frame, phase * Math.PI * 2, mode === 'run');
      constrainZenbotGait(rig, states, contacts, feet);
      const heights = contacts.map((contact, side) => {
        const sole = rig.point(contact.id, states, 130, contact.sole);
        const edge = rig.point(contact.id, states, 145, contact.sole);
        assert.ok(Math.abs(sole[0] - 130 - feet[side].dx) < 1e-6);
        assert.ok(Math.abs(sole[1] - (256 - feet[side].lift)) < 1e-6);
        assert.ok(Math.abs(edge[1] - sole[1]) < 1e-6, 'sole stays horizontal');
        assert.ok(Math.abs(edge[0] - sole[0] - 15) < 1e-6, 'shoe stays rigid');
        const hipX = model.deformers[contact.id].pivot[0];
        const hip = rig.point(contact.id, states, hipX, contact.hip);
        const bodyHip = rig.point('body', states, hipX, contact.hip);
        assert.deepEqual(hip, bodyHip, 'hip remains attached to the pelvis');
        return sole[1];
      });
      assert.ok(Math.abs(Math.max(...heights) - 256) < 1e-6, 'at least one support sole is on the floor');
      assert.ok(heights.every(height => height <= 256 + 1e-6), 'feet never penetrate the floor');
    }
  }
  rig.dispose();
});

test('hair crown follows the head exactly while only lower lengths sway', () => {
  const raw = JSON.parse(readFileSync(new URL('../assets/characters/zenbot/rig/manifest.json', import.meta.url), 'utf8'));
  const manifest = validateZenbotRigManifest(raw);
  const model = createZenbotRigModel(manifest);
  const binding = installZenbotHair(model);
  const { document } = createMockGlDocument();
  const rig = createRig(document.createElement('canvas'), model);
  for (const mode of ['walk', 'run', 'dance', 'dizzy']) {
    for (let index = 0; index < 80; index += 1) {
      const time = index / 20;
      const states = adaptZenbotRigState(evaluateZenbotRig({ mode, modeT: time, swing: 40 }, time, { velocityX: 300 }), manifest).deformers;
      anchorZenbotHair(states, binding);
      for (const pointY of [-33, 0, 30, 64, 90, binding.anchorY]) {
        for (const pointX of [80, 140, 190]) {
          assert.deepEqual(rig.point('hair_back', states, pointX, pointY), rig.point('head', states, pointX, pointY));
        }
      }
    }
  }
  const states = { hair_back: { a: 3.5 } };
  anchorZenbotHair(states, binding);
  const tip = rig.point('hair_back', states, 80, 190);
  assert.ok(Math.hypot(tip[0] - 80, tip[1] - 190) > 5, 'lower hair retains visible sway');
  const neck = rig.point('hair_back', states, 80, binding.anchorY + 0.001);
  assert.ok(Math.hypot(neck[0] - 80, neck[1] - binding.anchorY - 0.001) < 1e-6, 'transition starts continuously');
  rig.dispose();
});

test('real kit and renderer survive walk, run, stopping and jump with either motion engine', async () => {
  const raw = JSON.parse(readFileSync(new URL('../assets/characters/zenbot/rig/manifest.json', import.meta.url), 'utf8'));
  for (const useMotionLibrary of [true, false]) {
    const { document } = createMockGlDocument();
    const errors = [];
    const figure = await createZenbotRigFigure({ document, manifest: raw, loadReferenceManifest: false,
      useMotionLibrary, onError: error => errors.push(error.message) });
    let body;
    const draw = figure.draw;
    figure.draw = (group, face, frame) => draw(group, face, { ...frame, gaitPhase: body.pet.phase / (Math.PI * 2) });
    const node = () => document.createElementNS('http://www.w3.org/2000/svg', 'g');
    body = createPet({ petG: node(), shadowEl: node(), fxG: node() }, {
      bounds: () => ({ W: 1400, H: 620, floorY: 604, S: 1.18 }),
      startX: 350, roam: 'off', sfx: { play() {} }, figure,
    });
    const advance = count => {
      for (let index = 0; index < count; index += 1) { body.step(1 / 60); body.render(); }
    };
    body.walkTo(900, false);
    advance(80);
    assert.equal(body.pet.mode, 'walk');
    body.walkTo(400, true);
    advance(20);
    assert.equal(body.pet.mode, 'run');
    body.walkTo(body.pet.x, false);
    advance(60);
    assert.equal(body.pet.mode, 'idle');
    body.doWord('jump');
    advance(70);
    assert.equal(figure.state, 'ready');
    assert.ok(figure.stats.draws >= 230);
    assert.deepEqual(errors, []);
    figure.dispose();
  }
});

function createHeadlessDocument() {
  const node = (tag) => ({
    tag,
    attrs: new Map(),
    children: [],
    parentNode: null,
    setAttribute(name, value) { this.attrs.set(name, String(value)); },
    getAttribute(name) { return this.attrs.get(name) ?? null; },
    removeAttribute(name) { this.attrs.delete(name); },
    append(...nodes) {
      for (const child of nodes) {
        child.parentNode = this;
        this.children.push(child);
      }
    },
    appendChild(child) { this.append(child); },
    replaceChildren(...nodes) {
      this.children = [];
      for (const child of nodes) {
        child.parentNode = this;
        this.children.push(child);
      }
    },
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    },
    addEventListener() {},
    removeEventListener() {},
  });
  return {
    createElementNS(_namespace, tag) {
      return node(tag);
    },
    createElement(tag) {
      const element = node(tag);
      if (tag === 'canvas') {
        element.width = 0;
        element.height = 0;
        element.style = {};
        element.getContext = () => null;
      }
      return element;
    },
  };
}

function createMockGlDocument() {
  const canvases = [];
  const gl = createMockGl();

  const node = (tag) => ({
    tag,
    attrs: new Map(),
    children: [],
    parentNode: null,
    style: {},
    setAttribute(name, value) { this.attrs.set(name, String(value)); },
    getAttribute(name) { return this.attrs.get(name) ?? null; },
    removeAttribute(name) { this.attrs.delete(name); },
    append(...nodes) {
      for (const child of nodes) {
        child.parentNode = this;
        this.children.push(child);
      }
    },
    appendChild(child) { this.append(child); },
    replaceChildren(...nodes) {
      this.children = [];
      for (const child of nodes) {
        child.parentNode = this;
        this.children.push(child);
      }
    },
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    },
    addEventListener() {},
    removeEventListener() {},
  });

  const document = {
    createElementNS(_namespace, tag) {
      return node(tag);
    },
    createElement(tag) {
      if (tag === 'canvas') {
        const canvas = node(tag);
        canvas.width = 0;
        canvas.height = 0;
        canvas.style = {};
        canvas.getContext = (type) => (type === 'webgl' ? gl : null);
        const listeners = new Map();
        canvas.addEventListener = (type, callback) => {
          if (!listeners.has(type)) listeners.set(type, []);
          listeners.get(type).push(callback);
        };
        canvas.removeEventListener = (type, callback) => {
          const group = listeners.get(type);
          if (!group) return;
          const index = group.indexOf(callback);
          if (index >= 0) group.splice(index, 1);
        };
        canvas.emit = (type, event) => {
          for (const callback of listeners.get(type) ?? []) callback(event);
        };
        canvases.push(canvas);
        return canvas;
      }
      if (tag === 'img') {
        return {
          naturalWidth: 2,
          naturalHeight: 2,
          width: 2,
          height: 2,
          decoding: 'async',
          src: '',
          decode: () => Promise.resolve(),
          removeAttribute() {},
        };
      }
      return node(tag);
    },
  };

  return { document, canvases, gl };
}

function createMockGl() {
  const constants = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6,
    DYNAMIC_DRAW: 7,
    STATIC_DRAW: 8,
    FLOAT: 9,
    UNSIGNED_SHORT: 10,
    TRIANGLES: 11,
    RGBA: 12,
    UNSIGNED_BYTE: 13,
    TEXTURE_2D: 14,
    TEXTURE0: 15,
    TEXTURE1: 16,
    TEXTURE_MIN_FILTER: 17,
    TEXTURE_MAG_FILTER: 18,
    LINEAR: 19,
    LINEAR_MIPMAP_LINEAR: 20,
    TEXTURE_WRAP_S: 21,
    TEXTURE_WRAP_T: 22,
    CLAMP_TO_EDGE: 23,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 24,
    COLOR_BUFFER_BIT: 25,
    BLEND: 26,
    ONE: 27,
    ONE_MINUS_SRC_ALPHA: 28,
    DST_COLOR: 29,
    ZERO: 30,
  };
  const gl = {
    ...constants,
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({}),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    getAttribLocation: (_program, name) => (name === 'aPos' ? 0 : 1),
    getUniformLocation: () => ({}),
    createBuffer: () => ({}),
    bindBuffer() {},
    bufferData() {},
    bufferSubData() {},
    createTexture: () => ({}),
    bindTexture() {},
    pixelStorei() {},
    texImage2D() {},
    generateMipmap() {},
    texParameteri() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    activeTexture() {},
    useProgram() {},
    enable() {},
    blendFunc() {},
    blendFuncSeparate() {},
    uniform4f() {},
    uniform1i() {},
    uniform1f() {},
    viewport() {},
    clearColor() {},
    clear() {},
    drawElements() {},
    deleteTexture() {},
    deleteBuffer() {},
    deleteProgram() {},
    deleteShader() {},
    getExtension: () => null,
    isContextLost: () => false,
  };
  return gl;
}
