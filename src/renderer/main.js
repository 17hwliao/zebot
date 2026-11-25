import { createPet } from './kit/body.js';
import { createTerminalBot } from './figures/terminal-bot.js';
import { mountMotionControls, performMotion } from './motion-demo.js';

const petG = document.getElementById('petG');
const shadowEl = document.getElementById('shadow');
const fxG = document.getElementById('fxG');
const bubbleEl = document.getElementById('bubble');
const voiceEl = document.getElementById('voice');

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const acceptance = params.get('acceptance') === '1';
if (preview) document.body.classList.add('preview');

const TERMINAL_LABEL = '终端机器人';
const TERMINAL_ACCENT = '#6ee7b7';
const ZENBOT_LABEL = 'zenbot';
const ZENBOT_ACCENT = '#63d8ff';
const FIGURE_NAMES = new Set(['zenbot', 'whale']);
const initialFigure = FIGURE_NAMES.has(params.get('figure')) ? params.get('figure') : 'zenbot';
const requestedBase = params.get('characterBase');
const XINGYIN_BASE = withTrailingSlash(
  requestedBase && !/\/zenbot\/?$/i.test(requestedBase) ? requestedBase : '/characters/xingyin/',
);
const ZENBOT_BASE = '/characters/zenbot/';
const CALIBRATE = params.get('calibrate') === '1' || params.get('calibrate') === 'true';
const requestedZenbotRenderer = params.get('zenbotRenderer');
const INITIAL_ZENBOT_RENDERER = requestedZenbotRenderer === 'rig' || requestedZenbotRenderer === 'auto'
  ? requestedZenbotRenderer
  : 'sprite';
const previewWordParam = params.get('previewWord') ?? '';
const PREVIEW_WORD = /^[a-z][a-z0-9-]*$/i.test(previewWordParam) ? previewWordParam : null;
const PREVIEW_WORD_AT = Math.max(250, Number(params.get('previewWordAt')) || 1200);

function baseForFigure(figure) {
  return figure === 'zenbot' ? ZENBOT_BASE : XINGYIN_BASE;
}

const stage = {
  W: window.innerWidth,
  H: window.innerHeight,
  floorY: window.innerHeight - 16,
  S: 1.18,
};

let update = {
  state: 'idle',
  expression: 'neutral',
  motion: null,
  bubble: null,
  speaking: false,
  roam: true,
  status: null,
};
let latestUpdate = { ...update };
let bubbleId = 0;
let bubbleHideTimer = null;
let transientBubbleTimer = null;
let previewWordTimer = null;
let previewWordAttempts = 0;

let character = {
  figure: initialFigure,
  skin: params.get('skin') || 'muse',
  zenbotRenderer: INITIAL_ZENBOT_RENDERER,
  label: initialFigure === 'terminal-bot'
    ? TERMINAL_LABEL
    : initialFigure === 'zenbot'
      ? ZENBOT_LABEL
      : '星音',
  accent: initialFigure === 'zenbot' ? ZENBOT_ACCENT : TERMINAL_ACCENT,
};
let calibration = parseCalibration(params.get('calibration'));
let mountedFigure = 'terminal-bot';
let xingyinFigure = null;
let xingyinModule = null;
let zenbotFigure = null;
let whaleFigure = null;
let motionControls = null;
let requestedMotion = null;
let zenbotModule = null;
let zenbotRigModule = null;
let mountedZenbotRenderer = 'sprite';
let body = null;
let frameStarted = false;
let pendingCharacter = null;
let figureReady = false;
let characterVersion = 0;
let calibrationSaveTimer = null;
let calibrationSaveChain = Promise.resolve();

function withTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseCalibration(raw) {
  let value = null;
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    value = null;
  }
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const scale = finite(source.scale, 1);
  return {
    x: finite(source.x, 0),
    y: finite(source.y, 0),
    scale: scale > 0 ? scale : 1,
  };
}

function hitTest(layout, point) {
  const hits = layout?.hit ?? [];
  for (const hit of hits) {
    const x = Array.isArray(hit) ? hit[0] : hit?.x;
    const y = Array.isArray(hit) ? hit[1] : hit?.y;
    const r = Array.isArray(hit) ? hit[2] : hit?.r;
    if (![x, y, r].every(Number.isFinite)) continue;
    if ((point.x - x) ** 2 + (point.y - y) ** 2 <= (r + 8) ** 2) return true;
  }
  return false;
}

function toStage(event) {
  return { x: event.clientX, y: event.clientY };
}

function showBubble(bubble) {
  if (transientBubbleTimer) {
    clearTimeout(transientBubbleTimer);
    transientBubbleTimer = null;
  }
  bubbleEl.textContent = bubble.text;
  bubbleEl.dataset.tone = bubble.tone ?? 'info';
  bubbleEl.classList.add('show');
  if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
  if (bubble.holdMs > 0) {
    bubbleHideTimer = setTimeout(hideBubble, bubble.holdMs + 250);
  }
}

function hideBubble() {
  bubbleEl.classList.remove('show');
  bubbleEl.textContent = '';
}

function showTransientBubble(text, tone = 'info', duration = 1200) {
  if (transientBubbleTimer) clearTimeout(transientBubbleTimer);
  if (bubbleHideTimer) {
    clearTimeout(bubbleHideTimer);
    bubbleHideTimer = null;
  }
  bubbleEl.textContent = text;
  bubbleEl.dataset.tone = tone;
  bubbleEl.classList.add('show');
  transientBubbleTimer = setTimeout(() => {
    transientBubbleTimer = null;
    if (update.bubble) showBubble(update.bubble);
    else hideBubble();
  }, duration);
}

function schedulePreviewWord(delay = null) {
  if (!PREVIEW_WORD || !body || previewWordTimer || previewWordAttempts >= 6) return;
  const waitMs = delay == null
    ? Math.max(0, PREVIEW_WORD_AT - performance.now())
    : Math.max(0, delay);
  previewWordTimer = setTimeout(() => {
    previewWordTimer = null;
    if (!body) return;
    previewWordAttempts += 1;
    body.setRoam('off');
    if (!body.doWord(PREVIEW_WORD)) {
      if (previewWordAttempts < 6) schedulePreviewWord(400);
      else console.warn(`[codex-pet] preview word was not accepted: ${PREVIEW_WORD}`);
      return;
    }
    if (preview) showTransientBubble(`动作预览：${PREVIEW_WORD}`, 'info', 2400);
  }, waitMs);
}

function applyUpdate(next) {
  if (!body || !figureReady) return;
  update = { ...update, ...next };
  if (next.expression) body.setExpr(next.expression);
  body.setListening(update.state === 'listening');
  body.setThinking(update.state === 'thinking');
  body.setStatus(update.status ?? null);
  body.setRoam(update.roam ? 'free' : 'off');
  if (next.motion) body.doWord(next.motion);
  voiceEl.classList.toggle('show', update.state === 'listening');

  if (next.bubble && next.bubble.id !== bubbleId) {
    bubbleId = next.bubble.id;
    showBubble(next.bubble);
  } else if (!next.bubble && bubbleId && !transientBubbleTimer) {
    bubbleId = 0;
    hideBubble();
  }
}

function receiveUpdate(next) {
  if (!next || typeof next !== 'object') return;
  latestUpdate = { ...latestUpdate, ...next };
  if (figureReady) applyUpdate(next);
}

function positionBubble() {
  if (!body) return;
  const layout = body.layout();
  const anchor = layout?.bubble ?? { x: stage.W / 2, y: stage.H - 220 };
  const half = bubbleEl.offsetWidth / 2;
  const x = Math.max(half + 8, Math.min(stage.W - half - 8, anchor.x));
  const y = Math.max(bubbleEl.offsetHeight + 10, anchor.y - 8);
  bubbleEl.style.left = `${x}px`;
  bubbleEl.style.top = `${y}px`;
}

function applyTheme(accent, eye = null) {
  const color = typeof accent === 'string' && accent ? accent : TERMINAL_ACCENT;
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty(
    '--skin-eye',
    typeof eye === 'string' && eye ? eye : color,
  );
}

function applyFigureTheme(figure) {
  const meta = figure?.skinMeta && typeof figure.skinMeta === 'object' ? figure.skinMeta : {};
  applyTheme(
    figure?.accent ?? meta.accent ?? character.accent,
    meta.eye ?? meta.eyeColor ?? figure?.accent ?? character.accent,
  );
}

function disposeStaleFigure(figure) {
  try {
    figure?.dispose?.();
  } catch (error) {
    console.error('[codex-pet] figure cleanup failed', error);
  }
}

async function loadXingyinFactory() {
  if (xingyinModule) return xingyinModule;
  const module = await import('./figures/xingyin.js');
  if (typeof module.createXingyinFigure !== 'function') {
    throw new Error('xingyin figure module has no createXingyinFigure export');
  }
  xingyinModule = module.createXingyinFigure;
  return xingyinModule;
}

async function createXingyinFor(next) {
  const createXingyinFigure = await loadXingyinFactory();
  const figure = await createXingyinFigure({
    baseUrl: baseForFigure('xingyin'),
    skin: next.skin,
    calibration: { ...calibration },
    calibrate: CALIBRATE,
    onError(error) {
      console.error('[codex-pet] xingyin asset error', error);
    },
  });
  if (!figure || typeof figure.draw !== 'function') {
    throw new Error('createXingyinFigure returned an invalid figure');
  }
  return figure;
}

async function loadZenbotFactory() {
  if (zenbotModule) return zenbotModule;
  const module = await import('./figures/zenbot.js');
  if (typeof module.createZenbotFigure !== 'function') {
    throw new Error('zenbot figure module has no createZenbotFigure export');
  }
  zenbotModule = module.createZenbotFigure;
  return zenbotModule;
}

async function loadZenbotRigFactory() {
  if (zenbotRigModule) return zenbotRigModule;
  const module = await import('./figures/zenbot-rig.js');
  if (typeof module.createZenbotRigFigure !== 'function') {
    throw new Error('zenbot rig module has no createZenbotRigFigure export');
  }
  zenbotRigModule = module.createZenbotRigFigure;
  return zenbotRigModule;
}

async function createZenbotSpriteFor() {
  const createZenbotFigure = await loadZenbotFactory();
  const figure = await createZenbotFigure({
    baseUrl: baseForFigure('zenbot'),
    calibration: { ...calibration },
    calibrate: CALIBRATE,
    onError(error) {
      console.error('[codex-pet] zenbot asset error', error);
    },
  });
  if (!figure || typeof figure.draw !== 'function') {
    throw new Error('createZenbotFigure returned an invalid figure');
  }
  return figure;
}

async function fallbackZenbotRigToSprite(failedFigure, expectedVersion, error) {
  if (
    expectedVersion !== characterVersion
    || mountedFigure !== 'zenbot'
    || zenbotFigure !== failedFigure
    || mountedZenbotRenderer !== 'rig'
  ) {
    disposeStaleFigure(failedFigure);
    return;
  }
  const fallbackVersion = ++characterVersion;
  console.error('[codex-pet] zenbot rig failed at runtime; falling back to sprite', error);
  try {
    const sprite = await createZenbotSpriteFor();
    if (fallbackVersion !== characterVersion || !body) {
      disposeStaleFigure(sprite);
      return;
    }
    zenbotFigure = sprite;
    xingyinFigure = null;
    mountedFigure = 'zenbot';
    mountedZenbotRenderer = 'sprite';
    body.setFigure(sprite);
    sprite.setCalibration?.({ ...calibration });
    applyFigureTheme(sprite);
    figureReady = true;
    applyUpdate(latestUpdate);
    showTransientBubble('zenbot rig 运行异常，已回退精灵', 'error', 2600);
  } catch (spriteError) {
    console.error('[codex-pet] zenbot sprite fallback failed; using terminal bot', spriteError);
    if (fallbackVersion !== characterVersion || !body) return;
    zenbotFigure = null;
    mountedZenbotRenderer = 'sprite';
    if (mountedFigure !== 'terminal-bot') {
      body.setFigure(createTerminalBot());
      mountedFigure = 'terminal-bot';
    }
    character = {
      ...character,
      figure: 'terminal-bot',
      label: TERMINAL_LABEL,
      accent: TERMINAL_ACCENT,
    };
    applyTheme(TERMINAL_ACCENT, TERMINAL_ACCENT);
    figureReady = true;
    applyUpdate(latestUpdate);
    showTransientBubble('zenbot 加载失败，已回退终端机器人', 'error', 3000);
  }
}

async function createZenbotRigFor(expectedVersion) {
  const createZenbotRigFigure = await loadZenbotRigFactory();
  const holder = { figure: null };
  const figure = await createZenbotRigFigure({
    baseUrl: '/characters/zenbot/rig/',
    calibration: { ...calibration },
    calibrate: CALIBRATE,
    raster: preview,
    onError(error) {
      console.error('[codex-pet] zenbot rig error', error);
    },
    onFailure(error) {
      void fallbackZenbotRigToSprite(holder.figure, expectedVersion, error);
    },
  });
  if (!figure || typeof figure.draw !== 'function') {
    throw new Error('createZenbotRigFigure returned an invalid figure');
  }
  holder.figure = figure;
  const draw = figure.draw.bind(figure);
  figure.draw = (group, face, frame) => draw(group, face, {
    ...frame,
    gaitPhase: body ? body.pet.phase / (Math.PI * 2) : undefined,
    velX: body?.pet.velX,
  });
  return figure;
}

async function createWhaleFor(next) {
  const { createWhaleFigure } = await import('./figures/whale.js');
  return createWhaleFigure({ skin: next.skin, raster: true });
}

async function mountWhale(next) {
  const version = ++characterVersion;
  figureReady = false;
  try {
    const figure = await createWhaleFor(next);
    if (version !== characterVersion) {
      disposeStaleFigure(figure);
      return;
    }
    body.setFigure(figure);
    whaleFigure = figure;
    zenbotFigure = null;
    xingyinFigure = null;
    mountedFigure = 'whale';
    character = { ...next, figure: 'whale', label: 'DeepSeek 鲸鱼娘' };
    figureReady = true;
    applyFigureTheme(figure);
    applyUpdate(latestUpdate);
    motionControls?.syncCharacter(character);
  } catch (error) {
    if (version !== characterVersion) return;
    console.error('[codex-pet] whale failed; returning to zenbot', error);
    await mountZenbot({ ...next, figure: 'zenbot', label: ZENBOT_LABEL, zenbotRenderer: 'auto' });
    showTransientBubble('鲸鱼娘加载失败，已切回 zenbot', 'error', 3000);
  }
}

async function createZenbotFor(next = character, expectedVersion = characterVersion) {
  const requested = next.zenbotRenderer === 'rig' || next.zenbotRenderer === 'auto'
    ? next.zenbotRenderer
    : 'sprite';
  if (requested !== 'sprite') {
    try {
      return { figure: await createZenbotRigFor(expectedVersion), renderer: 'rig' };
    } catch (error) {
      console.warn(`[codex-pet] zenbot ${requested} renderer unavailable; falling back to sprite`, error);
      if (requested === 'rig') {
        showTransientBubble('zenbot rig 加载失败，已回退精灵', 'error', 2600);
      }
    }
  }
  return { figure: await createZenbotSpriteFor(), renderer: 'sprite' };
}

function useTerminal({ notify = false } = {}) {
  const wasReady = figureReady;
  characterVersion += 1;
  if (body && mountedFigure !== 'terminal-bot') {
    body.setFigure(createTerminalBot());
    mountedFigure = 'terminal-bot';
  }
  xingyinFigure = null;
  zenbotFigure = null;
  character = {
    ...character,
    figure: 'terminal-bot',
    label: TERMINAL_LABEL,
    accent: TERMINAL_ACCENT,
  };
  applyTheme(TERMINAL_ACCENT, TERMINAL_ACCENT);
  figureReady = true;
  if (!wasReady) applyUpdate(latestUpdate);
  if (notify) showTransientBubble(`已换上：${TERMINAL_LABEL}`, 'info', 1200);
}

async function mountXingyin(next, { notify = false } = {}) {
  const version = ++characterVersion;
  figureReady = false;
  try {
    const figure = await createXingyinFor(next);
    if (version !== characterVersion) {
      disposeStaleFigure(figure);
      return false;
    }

    xingyinFigure = figure;
    zenbotFigure = null;
    body.setSkin(next.skin);
    body.setFigure(figure);
    mountedFigure = 'xingyin';
    figure.setCalibration?.({ ...calibration });
    character = {
      ...next,
      figure: 'xingyin',
      label: next.label || figure.skinMeta?.label || next.skin,
      accent: figure.accent ?? next.accent,
    };
    applyFigureTheme(figure);
    figureReady = true;
    applyUpdate(latestUpdate);
    if (notify) showTransientBubble(`已换上：${character.label}`, 'info', 1200);
    return true;
  } catch (error) {
    console.error('[codex-pet] failed to create xingyin; falling back to terminal bot', error);
    if (version !== characterVersion) return false;
    xingyinFigure = null;
    if (mountedFigure !== 'terminal-bot') {
      body.setFigure(createTerminalBot());
      mountedFigure = 'terminal-bot';
    }
    character = {
      ...character,
      figure: 'terminal-bot',
      label: TERMINAL_LABEL,
      accent: TERMINAL_ACCENT,
    };
    applyTheme(TERMINAL_ACCENT, TERMINAL_ACCENT);
    figureReady = true;
    applyUpdate(latestUpdate);
    showTransientBubble('星音加载失败，已回退终端机器人', 'error', 3000);
    return false;
  }
}

async function mountZenbot(next, { notify = false } = {}) {
  const version = ++characterVersion;
  figureReady = false;
  try {
    const created = await createZenbotFor(next, version);
    const figure = created.figure;
    if (version !== characterVersion) {
      disposeStaleFigure(figure);
      return false;
    }

    zenbotFigure = figure;
    xingyinFigure = null;
    body.setFigure(figure);
    whaleFigure = null;
    mountedFigure = 'zenbot';
    mountedZenbotRenderer = created.renderer;
    figure.setCalibration?.({ ...calibration });
    character = {
      ...next,
      figure: 'zenbot',
      zenbotRenderer: next.zenbotRenderer ?? 'sprite',
      label: next.label || figure.skinMeta?.label || ZENBOT_LABEL,
      accent: figure.accent ?? next.accent,
    };
    applyFigureTheme(figure);
    figureReady = true;
    applyUpdate(latestUpdate);
    motionControls?.syncCharacter(character);
    if (notify) showTransientBubble(`已换上：${character.label}`, 'info', 1200);
    return true;
  } catch (error) {
    console.error('[codex-pet] failed to create zenbot; falling back to terminal bot', error);
    if (version !== characterVersion) return false;
    zenbotFigure = null;
    if (mountedFigure !== 'terminal-bot') {
      body.setFigure(createTerminalBot());
      mountedFigure = 'terminal-bot';
    }
    character = {
      ...character,
      figure: 'terminal-bot',
      label: TERMINAL_LABEL,
      accent: TERMINAL_ACCENT,
    };
    applyTheme(TERMINAL_ACCENT, TERMINAL_ACCENT);
    figureReady = true;
    applyUpdate(latestUpdate);
    showTransientBubble('zenbot 加载失败，已回退终端机器人', 'error', 3000);
    return false;
  }
}

async function switchCharacter(next) {
  if (!next || typeof next !== 'object') return;
  const figure = next.figure === 'whale' ? 'whale' : 'zenbot';
  const skin = typeof next.skin === 'string' && next.skin ? next.skin : character.skin;
  const label = typeof next.label === 'string' && next.label
    ? next.label
    : figure === 'terminal-bot'
      ? TERMINAL_LABEL
      : figure === 'zenbot'
        ? ZENBOT_LABEL
        : '星音';
  const accent = typeof next.accent === 'string' && next.accent
    ? next.accent
    : figure === 'terminal-bot'
      ? TERMINAL_ACCENT
      : figure === 'zenbot'
        ? ZENBOT_ACCENT
        : character.accent;
  const zenbotRenderer = next.zenbotRenderer === 'rig' || next.zenbotRenderer === 'auto'
    ? next.zenbotRenderer
    : next.zenbotRenderer === 'sprite'
      ? 'sprite'
      : character.zenbotRenderer ?? 'sprite';
  const rendererChanged = figure === 'zenbot' && (
    zenbotRenderer !== character.zenbotRenderer
    || (zenbotRenderer === 'sprite' && mountedZenbotRenderer !== 'sprite')
    || (zenbotRenderer !== 'sprite' && mountedZenbotRenderer !== 'rig')
  );
  const selected = { figure, skin, zenbotRenderer, label, accent };

  if (figure === 'terminal-bot') {
    useTerminal({ notify: true });
    return;
  }

  character = selected;
  applyTheme(accent, accent);
  if (figure === 'whale') {
    await mountWhale(selected);
    return;
  }
  if (figure === 'zenbot') {
    if (zenbotFigure && mountedFigure === 'zenbot' && !rendererChanged) {
      characterVersion += 1;
      figureReady = true;
      applyFigureTheme(zenbotFigure);
      showTransientBubble(`已换上：${label}`, 'info', 1200);
      return;
    }
    await mountZenbot(selected, { notify: true });
    return;
  }
  if (xingyinFigure && mountedFigure === 'xingyin') {
    characterVersion += 1;
    body.setSkin(skin);
    figureReady = true;
    applyFigureTheme(xingyinFigure);
    showTransientBubble(`已换上：${label}`, 'info', 1200);
    return;
  }
  await mountXingyin(selected, { notify: true });
}

function scheduleCalibrationSave() {
  if (!CALIBRATE || typeof window.pet?.saveCalibration !== 'function') return;
  if (calibrationSaveTimer) clearTimeout(calibrationSaveTimer);
  calibrationSaveTimer = setTimeout(() => {
    calibrationSaveTimer = null;
    const snapshot = { ...calibration };
    calibrationSaveChain = calibrationSaveChain
      .then(() => window.pet.saveCalibration(snapshot))
      .catch((error) => console.error('[codex-pet] calibration persistence failed', error));
  }, 160);
}

function adjustCalibration(event) {
  if (!CALIBRATE || (mountedFigure !== 'xingyin' && mountedFigure !== 'zenbot')) return false;
  const step = event.shiftKey ? 10 : 2;
  let changed = true;
  switch (event.key) {
    case 'ArrowLeft':
      calibration = { ...calibration, x: calibration.x - step };
      break;
    case 'ArrowRight':
      calibration = { ...calibration, x: calibration.x + step };
      break;
    case 'ArrowUp':
      calibration = { ...calibration, y: calibration.y - step };
      break;
    case 'ArrowDown':
      calibration = { ...calibration, y: calibration.y + step };
      break;
    case '+':
    case '=':
      calibration = { ...calibration, scale: round(calibration.scale + .02) };
      break;
    case '-':
    case '_':
      calibration = { ...calibration, scale: Math.max(.05, round(calibration.scale - .02)) };
      break;
    case '0':
      calibration = { x: 0, y: 0, scale: 1 };
      break;
    default:
      changed = false;
  }
  if (!changed) return false;
  xingyinFigure?.setCalibration?.({ ...calibration });
  zenbotFigure?.setCalibration?.({ ...calibration });
  scheduleCalibrationSave();
  return true;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function createBody(figure) {
  const instance = createPet(
    { petG, shadowEl, fxG },
    {
      figure,
      skin: character.skin,
      bounds: () => stage,
      enter: 'drop',
      roam: 'off',
      startX: stage.W * .5,
      sfx: { play() {} },
      onEvent(kind, detail) {
        if (kind === 'touch' && detail?.kind) {
          window.pet?.input({ type: 'pet.touch', kind: detail.kind });
        }
        if (kind === 'arrived' && detail?.walkId) {
          // The kit owns the walk; the runtime only needs the final position if
          // a gateway later wants to mirror it.
        }
      },
    },
  );
  instance.setExpr('neutral');
  instance.setRoam('free');
  return instance;
}

let last = performance.now();
function frame(now) {
  if (!body) return;
  const dt = Math.min(.05, Math.max(.001, (now - last) / 1000));
  last = now;
  motionControls?.tick(now);
  if (requestedMotion && performMotion(body, requestedMotion)) requestedMotion = null;
  body.step(dt);
  body.render();
  if (update.speaking) body.talk();
  positionBubble();
  window.pet?.setHit(hitTest(body.layout(), lastPointer));
  requestAnimationFrame(frame);
}

let lastPointer = { x: -1e6, y: -1e6 };
let hit = false;

window.addEventListener('mousemove', (event) => {
  if (!body) return;
  lastPointer = toStage(event);
  body.pointerMove(lastPointer);
  const nextHit = hitTest(body.layout(), lastPointer);
  if (nextHit !== hit) {
    hit = nextHit;
    window.pet?.setHit(hit);
  }
}, { passive: true });

window.addEventListener('mousedown', (event) => {
  if (!body) return;
  if (event.button !== 0) return;
  const point = toStage(event);
  if (!hitTest(body.layout(), point)) return;
  body.pointerDown(point);
  event.preventDefault();
});

window.addEventListener('mouseup', (event) => {
  if (!body) return;
  if (event.button !== 0) return;
  body.pointerUp(toStage(event));
});

window.addEventListener('mouseleave', () => {
  if (!body) return;
  body.pointerLeave();
  lastPointer = { x: -1e6, y: -1e6 };
  if (hit) {
    hit = false;
    window.pet?.setHit(false);
  }
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.pet?.menu();
});

window.addEventListener('keydown', (event) => {
  if (adjustCalibration(event)) event.preventDefault();
});

window.addEventListener('resize', () => {
  stage.W = window.innerWidth;
  stage.H = window.innerHeight;
  stage.floorY = window.innerHeight - 16;
  body?.resize();
});

window.pet?.onUpdate(receiveUpdate);
window.pet?.onMotion((word) => { requestedMotion = word; });
window.pet?.onCharacter((next) => {
  if (!body) {
    pendingCharacter = next;
    return;
  }
  void switchCharacter(next);
});

async function initializeCharacter() {
  const initVersion = ++characterVersion;
  let initialError = null;
  let figure = null;
  if (initialFigure === 'whale') {
    try {
      figure = await createWhaleFor(character);
    } catch (error) {
      initialError = error;
      figure = (await createZenbotFor({ ...character, zenbotRenderer: 'auto' }, initVersion)).figure;
    }
  } else if (initialFigure === 'xingyin') {
    try {
      figure = await createXingyinFor(character);
    } catch (error) {
      initialError = error;
      console.error('[codex-pet] failed to create xingyin; falling back to terminal bot', error);
    }
  } else if (initialFigure === 'zenbot') {
    try {
      const created = await createZenbotFor(character, initVersion);
      figure = created.figure;
      mountedZenbotRenderer = created.renderer;
    } catch (error) {
      initialError = error;
      console.error('[codex-pet] failed to create zenbot; falling back to terminal bot', error);
    }
  }

  if (figure) {
    if (initialFigure === 'whale' && !initialError) {
      whaleFigure = figure;
      mountedFigure = 'whale';
    } else if (initialFigure === 'zenbot' || initialFigure === 'whale') {
      zenbotFigure = figure;
      xingyinFigure = null;
      mountedFigure = 'zenbot';
    } else {
      xingyinFigure = figure;
      zenbotFigure = null;
      mountedFigure = 'xingyin';
    }
    character = {
      ...character,
      figure: mountedFigure,
      label: figure.skinMeta?.label || character.label,
      accent: figure.accent ?? character.accent,
    };
    body = createBody(figure);
    if (initialFigure === 'xingyin') body.setSkin(character.skin);
    figure.setCalibration?.({ ...calibration });
    applyFigureTheme(figure);
  } else {
    xingyinFigure = null;
    zenbotFigure = null;
    mountedFigure = 'terminal-bot';
    character = {
      ...character,
      figure: 'terminal-bot',
      label: TERMINAL_LABEL,
      accent: TERMINAL_ACCENT,
    };
    body = createBody(createTerminalBot());
    applyTheme(TERMINAL_ACCENT, TERMINAL_ACCENT);
  }

  figureReady = true;
  applyUpdate(latestUpdate);
  if (!frameStarted) {
    frameStarted = true;
    requestAnimationFrame(frame);
  }
  if (initialError) {
    const name = initialFigure === 'zenbot' ? 'zenbot' : '星音';
    showTransientBubble(`${name} 加载失败，已回退终端机器人`, 'error', 3000);
  }

  if (pendingCharacter) {
    const next = pendingCharacter;
    pendingCharacter = null;
    await switchCharacter(next);
  }
  if (acceptance) {
    body.setRoam('off');
    motionControls = mountMotionControls(body, {
      character,
      getCharacter: () => character,
      selectCharacter: (next) => window.pet.selectCharacter(next),
    });
  }
  if (PREVIEW_WORD) {
    const activeFigure = mountedFigure === 'zenbot'
      ? zenbotFigure
      : mountedFigure === 'xingyin'
        ? xingyinFigure
        : null;
    try {
      await activeFigure?.preloadWord?.(PREVIEW_WORD);
    } catch (error) {
      console.warn(`[codex-pet] preview word preload failed: ${PREVIEW_WORD}`, error);
    }
  }
  schedulePreviewWord();
}

void initializeCharacter();
