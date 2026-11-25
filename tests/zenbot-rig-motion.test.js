import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZENBOT_MOTION_IDS } from '../src/renderer/characters/zenbot-manifest.js';
import {
  ZENBOT_RIG_DEFORMER_IDS,
  ZENBOT_RIG_GESTURE_IDS,
  ZENBOT_RIG_LIMITS,
  ZENBOT_RIG_MOTION_IDS,
  ZENBOT_RIG_MOTION_SPECS,
  adaptZenbotRigState,
  createZenbotRigDeformerAdapter,
  evaluateZenbotRig,
  resolveZenbotRigMotion,
} from '../src/renderer/characters/zenbot-rig-motions.js';

const SPEC_URL = new URL('../assets/characters/zenbot/rig/motions/spec.json', import.meta.url);

function metadata() {
  return JSON.parse(readFileSync(SPEC_URL, 'utf8'));
}

function actionFrame(id) {
  if (id === 'stand') return { mode: 'wake' };
  if (id === 'jump') return { mode: 'crouch', jumpV: 720 };
  if (id === 'hop') return { mode: 'crouch', jumpV: 480 };
  if (['look', 'walk', 'run', 'sit', 'sleep', 'dizzy', 'dance'].includes(id)) return { mode: id };
  if (ZENBOT_RIG_GESTURE_IDS.includes(id)) return { gesture: { kind: id, k: 0.5 } };
  if (id === 'turn') return { mode: 'idle' };
  throw new Error(`no frame fixture for ${id}`);
}

function actionOptions(id) {
  return id === 'turn' ? { turn: true } : {};
}

function assertFiniteState(label, state) {
  assert.deepEqual(Object.keys(state), [...ZENBOT_RIG_DEFORMER_IDS], label);
  for (const id of ZENBOT_RIG_DEFORMER_IDS) {
    const item = state[id];
    assert.deepEqual(Object.keys(item), ['a', 'tx', 'ty', 'sx', 'sy'], `${label}.${id}`);
    for (const [field, value] of Object.entries(item)) {
      assert.equal(Number.isFinite(value), true, `${label}.${id}.${field}`);
    }
    assert.ok(item.sx > 0 && item.sx <= 4, `${label}.${id}.sx`);
    assert.ok(item.sy > 0 && item.sy <= 4, `${label}.${id}.sy`);
  }
}

function closeStates(actual, expected, epsilon = 1e-4) {
  for (const id of ZENBOT_RIG_DEFORMER_IDS) {
    for (const field of ['a', 'tx', 'ty', 'sx', 'sy']) {
      assert.ok(
        Math.abs(actual[id][field] - expected[id][field]) <= epsilon,
        `${id}.${field}: ${actual[id][field]} != ${expected[id][field]}`,
      );
    }
  }
}

test('motion module exports exactly the 18 contract ids and nine stable deformers', () => {
  assert.deepEqual(ZENBOT_RIG_MOTION_IDS, ZENBOT_MOTION_IDS);
  assert.equal(ZENBOT_RIG_MOTION_IDS.length, 18);
  assert.deepEqual(ZENBOT_RIG_DEFORMER_IDS, [
    'body',
    'chest',
    'head',
    'hair_back',
    'arm_l',
    'arm_r',
    'skirt',
    'leg_l',
    'leg_r',
  ]);
  assert.deepEqual(ZENBOT_RIG_GESTURE_IDS, ['nod', 'shake', 'spin', 'wave', 'bow', 'shiver', 'flap']);
  assert.deepEqual(Object.keys(ZENBOT_RIG_MOTION_SPECS), [...ZENBOT_RIG_MOTION_IDS]);
});

test('motion metadata matches code timings, loops, and gesture classification', () => {
  const spec = metadata();
  assert.equal(spec.schemaVersion, 1);
  assert.deepEqual(spec.deformers, [...ZENBOT_RIG_DEFORMER_IDS]);
  assert.deepEqual(Object.keys(spec.motions), [...ZENBOT_RIG_MOTION_IDS]);
  for (const id of ZENBOT_RIG_MOTION_IDS) {
    const code = ZENBOT_RIG_MOTION_SPECS[id];
    const doc = spec.motions[id];
    assert.equal(doc.seconds, code.seconds, id);
    assert.equal(doc.loop, code.loop, id);
    assert.equal(doc.gesture, code.gesture, id);
    assert.equal(Boolean(doc.lasting), Boolean(code.lasting), id);
  }
});

test('all 18 actions select and produce finite, contract-shaped deformer states', () => {
  const paramKeys = [
    'breath', 'blink', 'gazeX', 'gazeY', 'talk',
    'bodyY', 'bodyRot', 'headRot', 'armLRot', 'armRRot',
    'hairSway', 'skirtSway', 'legL', 'legR', 'squash', 'turn', 'faceMix',
  ];
  for (const id of ZENBOT_RIG_MOTION_IDS) {
    const spec = ZENBOT_RIG_MOTION_SPECS[id];
    const elapsed = spec.seconds * 0.45;
    const frame = { ...actionFrame(id), modeT: elapsed, motionT: elapsed };
    const state = evaluateZenbotRig(frame, elapsed, actionOptions(id));
    assert.equal(state.motion.id, id, id);
    assert.equal(state.motion.duration, spec.seconds, id);
    assertFiniteState(id, state.deformers);
    assert.ok(Number.isFinite(state.expression.mix));
    assert.ok(Number.isFinite(state.expression.blink));
    assert.ok(Number.isFinite(state.mouth.open));
    for (const key of paramKeys) assert.equal(Number.isFinite(state.params[key]), true, `${id}.${key}`);
  }
});

test('explicit motion ids cover short actions that normally arrive as gestures', () => {
  for (const id of ZENBOT_RIG_GESTURE_IDS) {
    const state = evaluateZenbotRig({ mode: 'idle' }, 0.3, { motion: id, motionT: 0.3 });
    assert.equal(state.motion.id, id);
    assert.equal(state.motion.layer, 'gesture');
  }
});

test('crouch distinguishes a full jump from a hop, and jump is visibly higher', () => {
  const jump = evaluateZenbotRig({ mode: 'crouch', jumpV: 720, modeT: 0.37 }, 0.37);
  const hop = evaluateZenbotRig({ mode: 'crouch', jumpV: 480, modeT: 0.27 }, 0.27);
  assert.equal(jump.motion.id, 'jump');
  assert.equal(hop.motion.id, 'hop');
  assert.ok(jump.deformers.body.ty < -30, `jump body ty ${jump.deformers.body.ty}`);
  assert.ok(hop.deformers.body.ty > -16, `hop body ty ${hop.deformers.body.ty}`);
  assert.ok(jump.deformers.body.ty < hop.deformers.body.ty - 12);
  assert.ok(jump.deformers.arm_l.a > hop.deformers.arm_l.a + 15);
});

test('crouch to air and air to land keep the jump phase continuous', () => {
  const crouch = evaluateZenbotRig({ mode: 'crouch', jumpV: 720, modeT: 0.155 }, 0.155);
  const air = evaluateZenbotRig({ mode: 'air', jumpV: 720, modeT: 0 }, 0.155);
  assert.equal(air.motion.id, 'jump');
  assert.ok(Math.abs(air.deformers.body.ty - crouch.deformers.body.ty) < 0.5);
  assert.ok(Math.abs(air.deformers.body.sy - crouch.deformers.body.sy) < 0.01);

  const falling = evaluateZenbotRig({ mode: 'air', jumpV: 720, modeT: 0.4 }, 0.555);
  const landing = evaluateZenbotRig({ mode: 'land', jumpV: 720, modeT: 0 }, 0.555);
  assert.equal(landing.motion.id, 'jump');
  assert.ok(Math.abs(landing.deformers.body.ty - falling.deformers.body.ty) < 6);
});

test('short gestures win over the active mode while the gait keeps running', () => {
  const walk = evaluateZenbotRig({ mode: 'walk', modeT: 0.4, facing: 1 }, 1.2);
  const wave = evaluateZenbotRig({
    mode: 'walk',
    modeT: 0.4,
    facing: 1,
    gesture: { kind: 'wave', k: 0.42 },
  }, 1.2);

  assert.equal(wave.motion.id, 'wave');
  assert.equal(wave.motion.gestureId, 'wave');
  assert.equal(wave.motion.baseId, 'walk');
  assert.equal(wave.motion.layer, 'gesture');
  assert.ok(wave.deformers.arm_r.a < walk.deformers.arm_r.a - 60);
  assert.equal(wave.deformers.leg_l.a, walk.deformers.leg_l.a, 'wave preserves the walk leg trajectory');
  assert.equal(wave.deformers.leg_r.a, walk.deformers.leg_r.a, 'wave preserves the walk leg trajectory');
  assert.equal(wave.motion.phase, walk.motion.phase);
});

test('nod and bow override upper-body channels without cancelling walk legs', () => {
  const walk = evaluateZenbotRig({ mode: 'walk', modeT: 0.5 }, 1);
  for (const kind of ['nod', 'bow']) {
    const state = evaluateZenbotRig({
      mode: 'walk',
      modeT: 0.5,
      gesture: { kind, k: 0.45 },
    }, 1);
    assert.equal(state.motion.id, kind);
    assert.equal(state.motion.baseId, 'walk');
    assert.ok(Math.abs(state.deformers.head.a) > 0.5);
    assert.equal(state.deformers.leg_l.a, walk.deformers.leg_l.a);
    assert.equal(state.deformers.leg_r.a, walk.deformers.leg_r.a);
  }
});

test('walk and run loops repeat exactly one gait period apart', () => {
  for (const id of ['walk', 'run']) {
    const cadence = ZENBOT_RIG_MOTION_SPECS[id].cadence;
    const first = evaluateZenbotRig({ mode: id, modeT: 0.37 }, 3.125, {
      motion: id,
      motionT: 0.37,
      phase: 0.13,
    });
    const next = evaluateZenbotRig({ mode: id, modeT: 0.37 }, 3.125, {
      motion: id,
      motionT: 0.37 + 1 / cadence,
      phase: 0.13,
    });
    closeStates(first.deformers, next.deformers);
    assert.ok(Math.abs(first.motion.phase - next.motion.phase) < 1e-5);
  }
});

test('walk and run gait curves stay continuous across dense frame samples', () => {
  for (const id of ['walk', 'run']) {
    const cadence = ZENBOT_RIG_MOTION_SPECS[id].cadence;
    const period = 1 / cadence;
    let previous = null;
    let maxDelta = 0;
    for (let index = 0; index <= 400; index += 1) {
      const elapsed = (period * index) / 400;
      const state = evaluateZenbotRig({ mode: id, modeT: elapsed }, 0, {
        motion: id,
        motionT: elapsed,
      });
      if (previous) {
        for (const deformer of ZENBOT_RIG_DEFORMER_IDS) {
          for (const field of ['a', 'tx', 'ty', 'sx', 'sy']) {
            maxDelta = Math.max(
              maxDelta,
              Math.abs(state.deformers[deformer][field] - previous.deformers[deformer][field]),
            );
          }
        }
      }
      previous = state;
    }
    assert.ok(maxDelta < 2.5, `${id} max sample delta ${maxDelta}`);
  }
});

test('walk and run ramp in from idle and accept a runtime gait fade', () => {
  for (const id of ['walk', 'run']) {
    const start = evaluateZenbotRig({ mode: id, modeT: 0 }, 4);
    assert.ok(Math.abs(start.deformers.leg_l.a) < 0.1);
    assert.ok(Math.abs(start.deformers.leg_r.a) < 0.1);
    assert.equal(start.motion.gaitWeight, 0);

    const faded = evaluateZenbotRig({ mode: id, modeT: 0.6, phase: 0.31 }, 4, { gaitWeight: 0 });
    assert.ok(Math.abs(faded.deformers.leg_l.a) < 0.1);
    assert.ok(Math.abs(faded.deformers.leg_r.a) < 0.1);
    assert.equal(faded.motion.gaitWeight, 0);
  }
});

test('independent walk and run phases differ in amplitude but stay bounded', () => {
  let walkPeak = 0;
  let runPeak = 0;
  for (let index = 0; index < 100; index += 1) {
    const time = index / 40;
    const walk = evaluateZenbotRig({ mode: 'walk', modeT: time }, time);
    const run = evaluateZenbotRig({ mode: 'run', modeT: time }, time);
    walkPeak = Math.max(walkPeak, Math.abs(walk.deformers.leg_l.a));
    runPeak = Math.max(runPeak, Math.abs(run.deformers.leg_l.a));
  }
  assert.ok(walkPeak > 7 && walkPeak < 8);
  assert.ok(runPeak > 12 && runPeak < 14);
});

test('gait arms oppose the same-side leg at half its angle and follow actual kit feet', () => {
  const idle = evaluateZenbotRig({ mode: 'idle' }, 1);
  for (const mode of ['walk', 'run']) {
    for (let index = 0; index < 160; index += 1) {
      const phase = index / 160;
      const state = evaluateZenbotRig({ mode, modeT: 1 }, 1, { gaitPhase: phase });
      for (const side of ['l', 'r']) {
        const leg = state.deformers[`leg_${side}`].a;
        const arm = state.deformers[`arm_${side}`].a - idle.deformers[`arm_${side}`].a;
        assert.ok(Math.abs(arm + leg * 0.5) < 1e-4);
        assert.ok(Math.abs(arm) < (mode === 'run' ? 7 : 4));
      }
    }
    const planted = evaluateZenbotRig({ mode, modeT: 1, legs: [[104, 212, 104, 241], [150, 212, 150, 241]] }, 1, { gaitPhase: 0.25 });
    assert.equal(planted.deformers.leg_l.a, 0);
    assert.equal(planted.deformers.leg_r.a, 0);
    assert.equal(planted.deformers.arm_l.a, idle.deformers.arm_l.a);
    assert.equal(planted.deformers.arm_r.a, idle.deformers.arm_r.a);
  }
});

test('talk mouth is clamped, rate-limited, and deterministic at boundaries', () => {
  const silent = evaluateZenbotRig({ mode: 'idle', talk: -2 }, 1.25);
  const quiet = evaluateZenbotRig({ mode: 'idle', talk: 0 }, 1.25);
  const talking = evaluateZenbotRig({ mode: 'idle', talk: 1 }, 1.25);
  const over = evaluateZenbotRig({ mode: 'idle', talk: 99 }, 1.25);
  assert.equal(silent.mouth.open, 0);
  assert.equal(quiet.mouth.open, 0);
  assert.ok(talking.mouth.open > 0 && talking.mouth.open <= 1);
  assert.equal(over.mouth.open, talking.mouth.open);
  assert.ok(talking.mouth.openUnits <= ZENBOT_RIG_LIMITS.mouthUnits);
  assert.equal(talking.mouth.height, talking.mouth.openUnits);
  assert.equal(talking.mouth.width, 42 + talking.mouth.open * 8);

  const slow = evaluateZenbotRig({ mode: 'idle', talk: 1 }, 1.25, { talkHz: 1 });
  const fast = evaluateZenbotRig({ mode: 'idle', talk: 1 }, 1.25, { talkHz: 30 });
  assert.equal(slow.mouth.rate, 8);
  assert.equal(fast.mouth.rate, 12);
});

test('blink is deterministic, bounded, and accepts caller-supplied random input', () => {
  const options = { blink: { seed: 7, period: 2, closeSeconds: 0.2, jitter: 0.9 } };
  let peak = 0;
  let found = false;
  for (let index = 0; index <= 400; index += 1) {
    const time = index / 100;
    const a = evaluateZenbotRig({ mode: 'idle' }, time, options);
    const b = evaluateZenbotRig({ mode: 'idle' }, time, options);
    assert.ok(a.expression.blink >= 0 && a.expression.blink <= 1);
    assert.equal(a.expression.blink, b.expression.blink);
    peak = Math.max(peak, a.expression.blink);
    if (a.expression.blink > 0.1) found = true;
  }
  assert.equal(found, true);
  assert.ok(peak > 0.8);

  assert.equal(evaluateZenbotRig({ mode: 'idle', blink: 0.42 }, 9).expression.blink, 0.42);
  assert.equal(evaluateZenbotRig({ mode: 'idle', eyeClose: 0.73 }, 9).expression.blink, 0.73);
  assert.equal(evaluateZenbotRig({ mode: 'idle' }, 9, { blink: false }).expression.blink, 0);
  assert.equal(evaluateZenbotRig({ mode: 'idle' }, 9, { blink: () => 0.6 }).expression.blink, 0.6);
});

test('gaze clamps to the rig contract and blends with scripted look motion', () => {
  const over = evaluateZenbotRig({ mode: 'idle', look: [99, -99] }, 0.2);
  const under = evaluateZenbotRig({ mode: 'idle', look: [-99, 99] }, 0.2);
  assert.equal(over.expression.gazeX, 5);
  assert.equal(over.expression.gazeY, -4);
  assert.equal(under.expression.gazeX, -5);
  assert.equal(under.expression.gazeY, 4);

  const look = evaluateZenbotRig({ mode: 'look', modeT: 1.2, look: [0, 0] }, 1.2);
  assert.ok(Math.abs(look.expression.gazeX) <= 5);
  assert.ok(Math.abs(look.expression.gazeY) <= 4);
  assert.ok(look.expression.gazeWeight > 0.5);
});

test('hair and skirt secondary sway stay inside baseline limits', () => {
  for (const id of ['walk', 'run', 'dance', 'dizzy', 'wave']) {
    for (let index = 0; index < 160; index += 1) {
      const time = index / 40;
      const state = evaluateZenbotRig({
        mode: id,
        modeT: time,
        facing: -1,
        swing: 40,
      }, time, { motion: id, motionT: time, velocityX: -1500 });
      assert.ok(state.deformers.hair_back.a >= -ZENBOT_RIG_LIMITS.hairSway);
      assert.ok(state.deformers.hair_back.a <= ZENBOT_RIG_LIMITS.hairSway);
      assert.ok(state.deformers.skirt.a >= -ZENBOT_RIG_LIMITS.skirtSway);
      assert.ok(state.deformers.skirt.a <= ZENBOT_RIG_LIMITS.skirtSway);
    }
  }
});

test('evaluation is deterministic and never reads Math.random', () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random must not be used by rig motion evaluation');
  };
  try {
    for (const id of ZENBOT_RIG_MOTION_IDS) {
      const time = 2.345;
      const frame = { ...actionFrame(id), modeT: 0.37, talk: 0.6, look: [2, -1] };
      const first = evaluateZenbotRig(frame, time, actionOptions(id));
      const second = evaluateZenbotRig(frame, time, actionOptions(id));
      assert.deepEqual(first, second, id);
    }
  } finally {
    Math.random = original;
  }
});

test('frame-rate data does not change a sample at the same monotonic time', () => {
  const a = evaluateZenbotRig({
    mode: 'walk',
    modeT: 0.83,
    t: 8.4,
    dt: 0.016,
    talk: 0.4,
    blink: 0.2,
  }, 8.4);
  const b = evaluateZenbotRig({
    mode: 'walk',
    modeT: 0.83,
    t: 8.4,
    dt: 0.033,
    talk: 0.4,
    blink: 0.2,
  }, 8.4);
  assert.deepEqual(a, b);
  assert.deepEqual(evaluateZenbotRig({ mode: 'idle', t: 4.5 }), evaluateZenbotRig({ mode: 'idle', t: 4.5 }, 4.5));
  assert.equal(evaluateZenbotRig({ mode: 'idle' }, -4).time, 0);
});

test('lasting sit and sleep hold their pose after the introduction', () => {
  for (const id of ['sit', 'sleep']) {
    const intro = evaluateZenbotRig({ mode: id, modeT: 0.8 }, 2, { motion: id, motionT: 0.8 });
    const held = evaluateZenbotRig({ mode: id, modeT: 12 }, 2, { motion: id, motionT: 12 });
    assert.equal(held.motion.id, id);
    assert.ok(Math.abs(held.deformers.body.ty - intro.deformers.body.ty) < 0.3);
    assert.ok(Math.abs(held.deformers.leg_l.a - intro.deformers.leg_l.a) < 0.3);
  }
});

test('sitting-to-standing continuity uses the kit sit amount instead of snapping', () => {
  const sit = evaluateZenbotRig({ mode: 'sit', modeT: 0.8, sit: 1 }, 2);
  const stand = evaluateZenbotRig({ mode: 'wake', modeT: 0, sit: 1 }, 2);
  assert.ok(Math.abs(stand.deformers.body.ty - sit.deformers.body.ty) < 0.3);
  assert.ok(Math.abs(stand.deformers.leg_l.a - sit.deformers.leg_l.a) < 0.3);
  assert.ok(Math.abs(stand.deformers.leg_r.a - sit.deformers.leg_r.a) < 0.3);
  assert.ok(stand.deformers.body.ty > 7);
});

test('manifest adapter maps canonical names, aliases, and missing deformers', () => {
  const state = evaluateZenbotRig({ mode: 'walk', modeT: 0.5 }, 1);
  const exactManifest = {
    deformers: Object.fromEntries(ZENBOT_RIG_DEFORMER_IDS.map((id) => [id, { kind: 'rot' }])),
  };
  const exact = adaptZenbotRigState(state, exactManifest);
  assert.deepEqual(Object.keys(exact.deformers), [...ZENBOT_RIG_DEFORMER_IDS]);
  assert.deepEqual(exact.missingDeformers, []);
  for (const id of ZENBOT_RIG_DEFORMER_IDS) {
    assert.equal(exact.deformerMapping[id], id);
    assert.deepEqual(exact.deformers[id], state.deformers[id]);
  }

  const partialManifest = {
    motionBindings: {
      deformers: {
        body: 'body_main',
        head: 'head_main',
        leg_l: 'thigh_l',
      },
    },
    deformers: {
      body_main: { kind: 'rot' },
      head_main: { kind: 'rot' },
      thigh_l: { kind: 'rot' },
      chest: { kind: 'rot' },
    },
  };
  const partial = adaptZenbotRigState(state, partialManifest);
  assert.deepEqual(Object.keys(partial.deformers).sort(), ['body_main', 'chest', 'head_main', 'thigh_l']);
  assert.equal(partial.deformerMapping.body, 'body_main');
  assert.equal(partial.deformerMapping.leg_l, 'thigh_l');
  assert.ok(partial.missingDeformers.includes('arm_r'));
  assert.throws(() => adaptZenbotRigState(state, partialManifest, { strict: true }), /missing motion deformers/);

  const canonicalMetadataManifest = {
    deformers: {
      torso: { kind: 'rot', canonicalId: 'body' },
      chest: { kind: 'rot' },
    },
  };
  const metadataAdapted = adaptZenbotRigState(state, canonicalMetadataManifest);
  assert.equal(metadataAdapted.deformerMapping.body, 'torso');
  assert.deepEqual(metadataAdapted.deformers.torso, state.deformers.body);

  const reusable = createZenbotRigDeformerAdapter(exactManifest);
  assert.deepEqual(reusable(state).deformers, exact.deformers);

  const identity = adaptZenbotRigState(state);
  assert.deepEqual(identity.deformers, state.deformers);
  assert.deepEqual(identity.missingDeformers, []);
});

test('motion resolution follows contract priority and facing-change fallback', () => {
  assert.equal(resolveZenbotRigMotion({ mode: 'air' }).id, 'jump');
  assert.equal(resolveZenbotRigMotion({ mode: 'land' }).id, 'jump');
  assert.equal(resolveZenbotRigMotion({ mode: 'wake' }).id, 'stand');
  assert.equal(resolveZenbotRigMotion({ mode: 'crouch', jumpV: 650 }).id, 'jump');
  assert.equal(resolveZenbotRigMotion({ mode: 'crouch', jumpV: 649 }).id, 'hop');
  assert.equal(resolveZenbotRigMotion({ mode: 'idle' }, { turn: true }).id, 'turn');
  assert.equal(
    resolveZenbotRigMotion({ mode: 'idle', facing: -1 }, { previousFacing: 1 }).id,
    'turn',
  );
  assert.equal(
    resolveZenbotRigMotion({ mode: 'walk', facing: -1 }, { previousFacing: 1 }).id,
    'walk',
  );
  assert.equal(
    resolveZenbotRigMotion({ mode: 'walk', gesture: { kind: 'nod', k: 0.3 } }, { turn: true }).id,
    'nod',
  );
});
