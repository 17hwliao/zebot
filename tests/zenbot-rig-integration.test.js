import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateZenbotRigManifest,
  createZenbotRigModel,
} from '../src/renderer/characters/zenbot-rig-manifest.js';
import {
  ZENBOT_RIG_MOTION_IDS,
  ZENBOT_RIG_DEFORMER_IDS,
  evaluateZenbotRig,
  adaptZenbotRigState,
} from '../src/renderer/characters/zenbot-rig-motions.js';
import { createZenbotRigFigure } from '../src/renderer/figures/zenbot-rig.js';
import { loadConfig, saveConfig, normalizeCharacterConfig } from '../src/main/config.js';
import { buildMenuModel, buildZenbotRendererItems } from '../src/main/menu-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RIG_ROOT = path.join(ROOT, 'assets/characters/zenbot/rig');
const SPRITE_MANIFEST_PATH = path.join(ROOT, 'assets/characters/zenbot/manifest.json');
const RIG_MANIFEST_PATH = path.join(RIG_ROOT, 'manifest.json');

function collectPngs(dir, prefix = '', out = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '_build') continue;
      collectPngs(path.join(dir, entry.name), rel, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      out.add(rel);
      out.add(entry.name);
    }
  }
  return out;
}

function createMockWebGLSurface() {
  const listeners = new Map();
  let contextLost = false;
  let loseContextCalls = 0;
  let lastRenderStates = null;

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    CLAMP_TO_EDGE: 0x812f,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    DYNAMIC_DRAW: 0x88e8,
    STATIC_DRAW: 0x88e4,
    COLOR_BUFFER_BIT: 0x4000,
    BLEND: 0x0be2,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    DST_COLOR: 0x0306,
    ZERO: 0,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    UNSIGNED_SHORT: 0x1403,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    getAttribLocation: (_p, n) => (n === 'aPos' ? 0 : 1),
    getUniformLocation: (_p, n) => ({ n }),
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    createTexture: () => ({}),
    bindTexture: () => {},
    pixelStorei: () => {},
    texImage2D: () => {},
    generateMipmap: () => {},
    texParameteri: () => {},
    activeTexture: () => {},
    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
    useProgram: () => {},
    enable: () => {},
    blendFunc: () => {},
    blendFuncSeparate: () => {},
    uniform4f: () => {},
    uniform1i: () => {},
    uniform1f: () => {},
    drawElements: () => {},
    deleteTexture: () => {},
    deleteBuffer: () => {},
    deleteProgram: () => {},
    deleteShader: () => {},
    isContextLost: () => contextLost,
    getExtension: (name) => (name === 'WEBGL_lose_context'
      ? { loseContext: () => { loseContextCalls += 1; contextLost = true; } }
      : null),
  };

  function makeNode(tag) {
    const attrs = new Map();
    const children = [];
    const node = {
      tagName: tag,
      style: {},
      parentNode: null,
      children,
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      removeAttribute(k) { attrs.delete(k); },
      append(...items) {
        for (const item of items) {
          if (item && typeof item === 'object') {
            item.parentNode = node;
            children.push(item);
          }
        }
      },
      replaceChildren() { children.length = 0; },
      remove() { node.parentNode = null; },
    };
    if (tag === 'canvas') {
      node.width = 0;
      node.height = 0;
      node.getContext = (kind) => (kind === 'webgl2' || kind === 'webgl' ? gl : null);
      node.addEventListener = (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      };
      node.removeEventListener = (type, fn) => {
        listeners.get(type)?.delete(fn);
      };
      node.dispatch = (type, event = { preventDefault() {} }) => {
        for (const fn of listeners.get(type) ?? []) fn(event);
      };
    }
    if (tag === 'img') {
      node.naturalWidth = 128;
      node.naturalHeight = 128;
      node.width = 128;
      node.height = 128;
      node.decode = () => Promise.resolve();
    }
    return node;
  }

  let createdCanvas = null;
  const document = {
    createElementNS: (_ns, tag) => makeNode(tag),
    createElement: (tag) => {
      const el = makeNode(tag);
      if (tag === 'canvas') createdCanvas = el;
      return el;
    },
  };
  return {
    document,
    petG: makeNode('g'),
    get canvas() { return createdCanvas; },
    get loseContextCalls() { return loseContextCalls; },
    setContextLost(v) { contextLost = v; },
    get lastRenderStates() { return lastRenderStates; },
  };
}

test('shipped on-disk zenbot rig manifest validates with full 18 parts, 19 expressions, 18 motions', () => {
  const rawRig = JSON.parse(fs.readFileSync(RIG_MANIFEST_PATH, 'utf8'));
  const rawSprite = JSON.parse(fs.readFileSync(SPRITE_MANIFEST_PATH, 'utf8'));
  const availableFiles = collectPngs(RIG_ROOT);

  const manifest = validateZenbotRigManifest(rawRig, {
    availableFiles,
    referenceManifest: rawSprite,
  });

  assert.equal(manifest.parts.length, 18);
  assert.equal(Object.keys(manifest.expressions).length, 19);
  assert.equal(Object.keys(manifest.motions).length, 18);
  assert.equal(manifest.coverage.complete, true);
  assert.deepEqual(manifest.coverage.expressions.missing, []);
  assert.deepEqual(manifest.coverage.motions.missing, []);

  const model = createZenbotRigModel(manifest);
  assert.equal(model.parts.length, 18);
  assert.ok(model.deformers.root);
  for (const id of ZENBOT_RIG_DEFORMER_IDS) {
    assert.ok(model.deformers[id], `missing deformer ${id}`);
  }
});

test('all 18 motions adapt cleanly to the real on-disk rig manifest with zero missing deformers', () => {
  const rawRig = JSON.parse(fs.readFileSync(RIG_MANIFEST_PATH, 'utf8'));
  const manifest = validateZenbotRigManifest(rawRig);

  for (const motionId of ZENBOT_RIG_MOTION_IDS) {
    const state = evaluateZenbotRig({ mode: 'idle', face: 'neutral' }, 0.35, {
      manifest,
      motion: motionId,
      motionT: 0.35,
    });
    const adapted = adaptZenbotRigState(state, manifest, { strict: true });
    assert.deepEqual(adapted.missingDeformers, [], motionId);
    for (const id of ZENBOT_RIG_DEFORMER_IDS) {
      assert.ok(adapted.deformers[id], `${motionId} missing ${id}`);
    }
  }
});

test('50 rapid rig create/draw/dispose switches release WebGL contexts cleanly without leaks', async () => {
  const rawRig = JSON.parse(fs.readFileSync(RIG_MANIFEST_PATH, 'utf8'));
  const rawSprite = JSON.parse(fs.readFileSync(SPRITE_MANIFEST_PATH, 'utf8'));
  let totalLostContexts = 0;

  for (let i = 0; i < 50; i += 1) {
    const surface = createMockWebGLSurface();
    const rig = await createZenbotRigFigure({
      document: surface.document,
      baseUrl: '/characters/zenbot/rig/',
      manifest: rawRig,
      spriteManifest: rawSprite,
      loadReferenceManifest: false,
      pixelRatio: 1,
    });
    assert.equal(rig.renderer, 'rig');
    assert.equal(rig.groupTilt('walk', 10, 5), 0);
    assert.equal(rig.groupTilt('drag', 10, 5), 4.5);
    rig.draw(surface.petG, 'neutral', { mode: i % 2 === 0 ? 'idle' : 'walk', modeT: 0.2, t: i * 0.1 });
    assert.equal(rig.stats.draws, 1);
    rig.dispose();
    assert.equal(rig.state, 'disposed');
    totalLostContexts += surface.loseContextCalls;
  }
  assert.equal(totalLostContexts, 50);
});

test('WebGL context loss recovers when restored before timeout, and fires onFailure after timeout', async () => {
  const rawRig = JSON.parse(fs.readFileSync(RIG_MANIFEST_PATH, 'utf8'));
  const rawSprite = JSON.parse(fs.readFileSync(SPRITE_MANIFEST_PATH, 'utf8'));
  const surface = createMockWebGLSurface();
  let failures = 0;

  const rig = await createZenbotRigFigure({
    document: surface.document,
    baseUrl: '/characters/zenbot/rig/',
    manifest: rawRig,
    spriteManifest: rawSprite,
    loadReferenceManifest: false,
    contextLossTimeoutMs: 60,
    onFailure: () => { failures += 1; },
  });

  // 1. Recoverable context loss
  surface.setContextLost(true);
  surface.canvas.dispatch('webglcontextlost');
  assert.equal(rig.state, 'lost');
  surface.setContextLost(false);
  surface.canvas.dispatch('webglcontextrestored');
  assert.equal(rig.state, 'ready');
  assert.equal(failures, 0);

  // 2. Unrecoverable context loss -> timeout -> onFailure
  surface.setContextLost(true);
  surface.canvas.dispatch('webglcontextlost');
  await new Promise((r) => setTimeout(r, 110));
  assert.equal(rig.state, 'failed');
  assert.equal(failures, 1);
  rig.dispose();
});

test('zenbotRenderer config normalization, persistence, and menu availability', async () => {
  assert.equal(normalizeCharacterConfig({}).zenbotRenderer, 'auto');
  assert.equal(normalizeCharacterConfig({ figure: 'zenbot', zenbotRenderer: 'rig' }).zenbotRenderer, 'rig');
  assert.equal(normalizeCharacterConfig({ zenbotRenderer: 'auto' }).zenbotRenderer, 'auto');
  assert.equal(normalizeCharacterConfig({ zenbotRenderer: 'invalid' }).zenbotRenderer, 'auto');

  const tmpDir = fs.mkdtempSync(path.join(ROOT, '.tmp-config-test-'));
  try {
    await saveConfig(tmpDir, { character: { figure: 'zenbot', skin: 'muse', zenbotRenderer: 'auto' } });
    const loaded = await loadConfig(tmpDir);
    assert.equal(loaded.character.figure, 'zenbot');
    assert.equal(loaded.character.zenbotRenderer, 'auto');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const disabledItems = buildZenbotRendererItems({ zenbotRenderer: 'sprite', rigAvailable: false });
  assert.equal(disabledItems.find((x) => x.id === 'sprite').enabled, true);
  assert.equal(disabledItems.find((x) => x.id === 'rig').enabled, false);
  assert.equal(disabledItems.find((x) => x.id === 'auto').enabled, false);

  const menu = buildMenuModel({ figure: 'zenbot', zenbotRenderer: 'rig', rigAvailable: true });
  assert.ok(menu.some((x) => x.id === 'change-zenbot-renderer'));
});
