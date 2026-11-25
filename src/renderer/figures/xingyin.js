import {
  getSkin,
  resolvePoseAsset,
  validateCharacterManifest,
} from '../characters/manifest.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CROSSFADE_SECONDS = 0.15;
const IMAGE_CACHE_LIMIT = 6;
const BLINK_PEAK = 0.5;
const RETRY_DELAY_SECONDS = 2.5;
const OPTIONAL_POSES = ['blink', 'listening', 'shy'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function copyJson(value) {
  if (Array.isArray(value)) return value.map(copyJson);
  if (!value || typeof value !== 'object') return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) copy[key] = copyJson(item);
  return copy;
}

function svgNode(doc, name, attrs = {}) {
  const node = doc.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(key, String(value));
  }
  return node;
}

function setAttr(node, name, value) {
  const text = String(value);
  if (node.getAttribute(name) !== text) node.setAttribute(name, text);
}

function joinUrl(baseUrl, file) {
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${file}`;
}

function assetUrl(baseUrl, asset) {
  return joinUrl(baseUrl, asset.file);
}

function publicSkin(skin) {
  return { id: skin.id, label: skin.label, accent: skin.accent };
}

function normalizeCalibration(value = {}) {
  const x = value.x == null ? 0 : Number(value.x);
  const y = value.y == null ? 0 : Number(value.y);
  const scale = value.scale == null ? 1 : Number(value.scale);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('calibration x and y must be finite numbers');
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('calibration scale must be greater than zero');
  return { x, y, scale };
}

function choosePoseId(skin, frame = {}) {
  const id = typeof skin === 'string' ? skin : skin?.id;
  if (id !== 'muse') return 'idle';
  if (frame.face === 'listening') return 'listening';
  if (frame.face === 'shy') return 'shy';
  if (frame.mode === 'sleep' || frame.face === 'sleep' || finiteOr(frame.blink, 0) >= BLINK_PEAK) return 'blink';
  return 'idle';
}

export function chooseXingyinPose(skin, frame) {
  return choosePoseId(skin, frame);
}

function decodeHtmlImage(doc, url) {
  return new Promise((resolve, reject) => {
    const img = doc.createElement('img');
    img.decoding = 'async';
    img.onerror = () => reject(new Error(`failed to load image: ${url}`));
    img.src = url;
    if (typeof img.decode === 'function') {
      img.decode().then(() => resolve(img), reject);
      return;
    }
    img.onload = () => resolve(img);
  });
}

function createLayer(doc, className) {
  const element = svgNode(doc, 'g', { class: className, opacity: 0, 'pointer-events': 'none' });
  const viewport = svgNode(doc, 'svg', {
    preserveAspectRatio: 'xMidYMid meet',
    overflow: 'hidden',
  });
  const image = svgNode(doc, 'image', { preserveAspectRatio: 'none' });
  viewport.append(image);
  element.append(viewport);
  return { element, viewport, image, url: null };
}

function createGuide(doc, manifest) {
  const [centerX, feetY] = [manifest.drawing.centerX, manifest.drawing.feetY];
  const [hitX, hitY, hitRadius] = manifest.defaults.hit;
  const [bubbleX, bubbleY] = manifest.defaults.bubbleAnchor;
  const group = svgNode(doc, 'g', {
    class: 'xingyin-calibration',
    display: 'none',
    'pointer-events': 'none',
  });
  const common = {
    fill: 'none',
    stroke: '#ff806b',
    'stroke-width': 1.5,
    'vector-effect': 'non-scaling-stroke',
  };
  group.append(
    svgNode(doc, 'line', {
      ...common,
      x1: centerX,
      y1: feetY - manifest.drawing.logoHeight - 28,
      x2: centerX,
      y2: feetY + 10,
      'stroke-dasharray': '5 4',
    }),
    svgNode(doc, 'line', {
      ...common,
      x1: centerX - 120,
      y1: feetY,
      x2: centerX + 120,
      y2: feetY,
    }),
    svgNode(doc, 'circle', {
      ...common,
      cx: hitX,
      cy: hitY,
      r: hitRadius,
      opacity: 0.55,
    }),
    svgNode(doc, 'circle', {
      ...common,
      cx: bubbleX,
      cy: bubbleY,
      r: 5,
      fill: '#ff806b',
    }),
    svgNode(doc, 'line', {
      ...common,
      x1: bubbleX - 10,
      y1: bubbleY,
      x2: bubbleX + 10,
      y2: bubbleY,
    }),
    svgNode(doc, 'line', {
      ...common,
      x1: bubbleX,
      y1: bubbleY - 10,
      x2: bubbleX,
      y2: bubbleY + 10,
    }),
  );
  return group;
}

export async function createXingyinFigure(options = {}) {
  const {
    baseUrl = '/characters/xingyin/',
    skin: requestedSkin = 'muse',
    calibration: initialCalibration = { x: 0, y: 0, scale: 1 },
    calibrate = false,
    onError = () => {},
  } = options;

  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('baseUrl must be a non-empty string');
  if (typeof document === 'undefined') throw new Error('createXingyinFigure requires a DOM document');
  if (typeof fetch !== 'function') throw new Error('createXingyinFigure requires fetch');

  const doc = document;
  let lastError = null;
  const reportError = (error) => {
    lastError = error instanceof Error ? error : new Error(String(error));
    try {
      onError(lastError);
    } catch {}
  };

  const manifestUrl = joinUrl(baseUrl, 'manifest.json');
  let rawManifest;
  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`failed to fetch ${manifestUrl}: HTTP ${response.status}`);
    rawManifest = await response.json();
  } catch (error) {
    reportError(error);
    throw error;
  }

  let manifest;
  try {
    manifest = validateCharacterManifest(rawManifest);
  } catch (error) {
    reportError(error);
    throw error;
  }

  let calibration = normalizeCalibration(initialCalibration);
  let currentSkin = getSkin(manifest, requestedSkin);
  if (!currentSkin) {
    const error = new Error(`unknown Xingyin skin: ${requestedSkin}`);
    reportError(error);
    currentSkin = getSkin(manifest, manifest.defaultSkin);
  }
  if (!currentSkin) throw new Error('Xingyin manifest has no usable default skin');

  const root = svgNode(doc, 'g', { class: 'xingyin-figure', 'aria-hidden': 'true' });
  const calibrationGroup = svgNode(doc, 'g', { class: 'xingyin-calibration-root' });
  const motionGroup = svgNode(doc, 'g', { class: 'xingyin-motion' });
  const halo = svgNode(doc, 'ellipse', {
    cx: manifest.drawing.centerX,
    cy: manifest.drawing.feetY - manifest.drawing.logoHeight * 0.66,
    rx: manifest.drawing.logoHeight * 0.25,
    ry: manifest.drawing.logoHeight * 0.09,
    fill: 'none',
    'stroke-width': 3,
    opacity: 0,
    display: 'none',
    'pointer-events': 'none',
  });
  const layerA = createLayer(doc, 'xingyin-layer xingyin-layer-a');
  const layerB = createLayer(doc, 'xingyin-layer xingyin-layer-b');
  const guide = createGuide(doc, manifest);
  motionGroup.append(halo, layerA.element, layerB.element);
  calibrationGroup.append(motionGroup, guide);
  root.append(calibrationGroup);

  const cache = new Map();
  const failedAt = new Map();
  let useClock = 0;
  let disposed = false;
  let displayTime = 0;
  let lastFrameTime = 0;
  let desiredUrl = '';
  let pendingUrl = '';
  let visibleUrl = '';
  let previousUrl = '';
  let transition = null;
  let currentLayer = layerA;
  let dragTilt = 0;
  let appliedAccent = '';
  let appliedGuide = null;

  function protectedUrls() {
    const keys = new Set([visibleUrl, previousUrl, desiredUrl, pendingUrl]);
    if (transition) {
      if (transition.fromUrl) keys.add(transition.fromUrl);
      if (transition.toUrl) keys.add(transition.toUrl);
    }
    keys.delete('');
    return keys;
  }

  function trimCache() {
    if (cache.size <= IMAGE_CACHE_LIMIT) return;
    const protectedKeys = protectedUrls();
    const candidates = [...cache.entries()]
      .filter(([url, entry]) => !protectedKeys.has(url) && entry.ready)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (cache.size > IMAGE_CACHE_LIMIT && candidates.length) {
      const [url, entry] = candidates.shift();
      cache.delete(url);
      if (entry.img) entry.img.removeAttribute('src');
    }
  }

  function loadImage(asset) {
    const url = assetUrl(baseUrl, asset);
    let entry = cache.get(url);
    if (entry?.ready) {
      entry.lastUsed = ++useClock;
      return Promise.resolve(entry);
    }
    if (entry?.promise) {
      entry.lastUsed = ++useClock;
      return entry.promise;
    }
    if (failedAt.has(url)) {
      const error = new Error(`image previously failed: ${url}`);
      return Promise.reject(error);
    }

    entry = {
      url,
      img: null,
      ready: false,
      lastUsed: ++useClock,
      promise: null,
    };
    cache.set(url, entry);
    entry.promise = decodeHtmlImage(doc, url).then((img) => {
      if (disposed) throw new Error('Xingyin figure disposed during image load');
      entry.img = img;
      entry.ready = true;
      failedAt.delete(url);
      trimCache();
      return entry;
    }).catch((error) => {
      cache.delete(url);
      failedAt.set(url, lastFrameTime + RETRY_DELAY_SECONDS);
      throw error;
    });
    trimCache();
    return entry.promise;
  }

  function configureLayer(layer, asset) {
    const [cropX, cropY, cropWidth, cropHeight] = asset.crop;
    const height = manifest.drawing.logoHeight;
    const width = height * (cropWidth / cropHeight);
    const x = manifest.drawing.centerX - width / 2;
    const y = manifest.drawing.feetY - height;
    layer.element.classList.add('xingyin-layer');
    setAttr(layer.viewport, 'x', x);
    setAttr(layer.viewport, 'y', y);
    setAttr(layer.viewport, 'width', width);
    setAttr(layer.viewport, 'height', height);
    setAttr(layer.viewport, 'viewBox', `${cropX} ${cropY} ${cropWidth} ${cropHeight}`);
    setAttr(layer.image, 'x', 0);
    setAttr(layer.image, 'y', 0);
    setAttr(layer.image, 'width', manifest.sourceCanvas[0]);
    setAttr(layer.image, 'height', manifest.sourceCanvas[1]);
    const url = assetUrl(baseUrl, asset);
    setAttr(layer.image, 'href', url);
    layer.url = url;
  }

  function settleTransition() {
    if (!transition) return;
    setAttr(transition.inLayer.element, 'opacity', 1);
    setAttr(transition.outLayer.element, 'opacity', 0);
    currentLayer = transition.inLayer;
    visibleUrl = transition.toUrl;
    previousUrl = transition.fromUrl;
    transition = null;
    trimCache();
  }

  function beginTransition(asset) {
    if (disposed) return;
    settleTransition();
    const nextLayer = currentLayer === layerA ? layerB : layerA;
    configureLayer(nextLayer, asset);
    setAttr(currentLayer.element, 'opacity', 1);
    setAttr(nextLayer.element, 'opacity', 0);
    transition = {
      outLayer: currentLayer,
      inLayer: nextLayer,
      fromUrl: visibleUrl,
      toUrl: assetUrl(baseUrl, asset),
      startTime: null,
    };
    pendingUrl = '';
    trimCache();
  }

  function cancelTransition() {
    if (!transition) return;
    setAttr(transition.outLayer.element, 'opacity', 1);
    setAttr(transition.inLayer.element, 'opacity', 0);
    transition = null;
    trimCache();
  }

  function syncAsset(asset) {
    const url = assetUrl(baseUrl, asset);
    desiredUrl = url;
    if (url === visibleUrl) {
      cancelTransition();
      return;
    }
    if (transition?.toUrl === url || pendingUrl === url) return;
    const cached = cache.get(url);
    if (cached?.ready) {
      beginTransition(asset);
      return;
    }
    const retryAt = failedAt.get(url);
    if (retryAt != null && lastFrameTime < retryAt) return;

    pendingUrl = url;
    loadImage(asset).then(() => {
      if (disposed || desiredUrl !== url) return;
      pendingUrl = '';
      lastError = null;
      beginTransition(asset);
    }).catch((error) => {
      if (disposed || desiredUrl !== url) return;
      pendingUrl = '';
      reportError(error);
    });
  }

  function calibratedPoint(x, y) {
    return [
      manifest.drawing.centerX + calibration.x + (x - manifest.drawing.centerX) * calibration.scale,
      manifest.drawing.feetY + calibration.y + (y - manifest.drawing.feetY) * calibration.scale,
    ];
  }

  function updateGuide() {
    const visible = !!calibrate;
    if (appliedGuide === visible) return;
    appliedGuide = visible;
    setAttr(guide, 'display', visible ? 'inline' : 'none');
  }

  function updateCalibrationTransform() {
    const { centerX, feetY } = manifest.drawing;
    setAttr(
      calibrationGroup,
      'transform',
      `translate(${calibration.x} ${calibration.y}) translate(${centerX} ${feetY}) scale(${calibration.scale}) translate(${-centerX} ${-feetY})`,
    );
  }

  function updateHalo(face) {
    if (currentSkin.accent !== appliedAccent) {
      appliedAccent = currentSkin.accent;
      setAttr(halo, 'stroke', appliedAccent);
    }
    const listening = face === 'listening';
    setAttr(halo, 'display', listening ? 'inline' : 'none');
    if (!listening) {
      setAttr(halo, 'opacity', 0);
      return;
    }
    setAttr(halo, 'opacity', (0.32 + Math.sin(displayTime * 4.2) * 0.12).toFixed(3));
  }

  function updateMotion(frame, dt) {
    const mode = frame.mode ?? 'idle';
    const sit = clamp(finiteOr(Number(frame.sit), 0), 0, 1);
    const talk = clamp(finiteOr(Number(frame.talk), 0), 0, 1);
    const sleep = mode === 'sleep';
    let bob = 0;
    if (mode === 'walk') bob = -Math.abs(Math.sin(displayTime * 10.5)) * 1.6;
    else if (mode === 'run') bob = -Math.abs(Math.sin(displayTime * 17.5)) * 2.6;
    const talkBob = (Math.sin(displayTime * 24) * 0.45 + Math.sin(displayTime * 31.5) * 0.2) * talk;
    const breath = Math.sin(displayTime * (sleep ? 1.45 : 2.15)) * (sleep ? 0.008 : 0.0025);
    const targetDragTilt = mode === 'drag' ? clamp(finiteOr(frame.lean, 0) * 0.32, -5, 5) : 0;
    dragTilt += (targetDragTilt - dragTilt) * (1 - Math.exp(-6 * dt));
    const sleepTilt = sleep ? Math.sin(displayTime * 0.85) * 1.25 : 0;
    const rotation = dragTilt + sleepTilt;
    const scaleX = (1 + sit * 0.018) * (1 - breath * 0.28);
    const scaleY = (1 - sit * 0.085) * (1 + breath);
    const { centerX, feetY } = manifest.drawing;
    setAttr(
      motionGroup,
      'transform',
      `translate(0 ${(bob + talkBob).toFixed(3)}) translate(${centerX} ${feetY}) rotate(${rotation.toFixed(3)}) scale(${scaleX.toFixed(5)} ${scaleY.toFixed(5)}) translate(${-centerX} ${-feetY})`,
    );
  }

  function updateTransition() {
    if (!transition) return;
    if (transition.startTime == null) transition.startTime = displayTime;
    const progress = clamp((displayTime - transition.startTime) / CROSSFADE_SECONDS, 0, 1);
    setAttr(transition.outLayer.element, 'opacity', (1 - progress).toFixed(4));
    setAttr(transition.inLayer.element, 'opacity', progress.toFixed(4));
    if (progress >= 1) settleTransition();
  }

  const defaultSkin = getSkin(manifest, manifest.defaultSkin);
  const defaultIdle = resolvePoseAsset(defaultSkin, 'idle');
  if (!defaultIdle) throw new Error('Xingyin default skin has no idle asset');
  try {
    await loadImage(defaultIdle);
  } catch (error) {
    reportError(error);
    throw error;
  }

  const initialIdle = resolvePoseAsset(currentSkin, 'idle');
  if (!initialIdle) throw new Error(`Xingyin skin ${currentSkin.id} has no idle asset`);
  if (assetUrl(baseUrl, initialIdle) !== assetUrl(baseUrl, defaultIdle)) {
    try {
      await loadImage(initialIdle);
    } catch (error) {
      reportError(error);
      throw error;
    }
  }

  configureLayer(currentLayer, initialIdle);
  setAttr(currentLayer.element, 'opacity', 1);
  setAttr((currentLayer === layerA ? layerB : layerA).element, 'opacity', 0);
  visibleUrl = assetUrl(baseUrl, initialIdle);
  desiredUrl = visibleUrl;
  updateCalibrationTransform();
  updateGuide();
  trimCache();

  if (currentSkin.id === 'muse') {
    for (const pose of OPTIONAL_POSES) {
      const asset = resolvePoseAsset(currentSkin, pose);
      if (!asset) continue;
      loadImage(asset).catch((error) => {
        if (!disposed) reportError(error);
      });
    }
  }

  function draw(petG, face, frame = {}) {
    if (disposed) return;
    if (!petG) throw new Error('draw requires a parent SVG group');
    if (root.parentNode !== petG) petG.append(root);

    const t = Number.isFinite(Number(frame.t)) ? Number(frame.t) : displayTime;
    const previousTime = lastFrameTime;
    lastFrameTime = t;
    displayTime = Math.max(displayTime, t);
    const dt = clamp(lastFrameTime - previousTime, 0, 0.05);

    updateCalibrationTransform();
    updateGuide();

    const faceName = typeof frame.face === 'string' ? frame.face : typeof face === 'string' ? face : null;
    const pose = choosePoseId(currentSkin, faceName == null ? frame : { ...frame, face: faceName });
    const target = resolvePoseAsset(currentSkin, pose) ?? resolvePoseAsset(currentSkin, 'idle');
    if (!target) {
      const error = new Error(`Xingyin skin ${currentSkin.id} has no drawable asset`);
      reportError(error);
      return;
    }
    syncAsset(target);
    updateHalo(faceName);
    updateMotion(frame, dt);
    updateTransition();
  }

  function setSkin(id) {
    if (disposed) return false;
    const next = getSkin(manifest, id);
    if (!next) {
      reportError(new Error(`unknown Xingyin skin: ${id}`));
      return false;
    }
    if (next === currentSkin) {
      const idle = resolvePoseAsset(next, 'idle');
      if (idle) failedAt.delete(assetUrl(baseUrl, idle));
      desiredUrl = '';
      return true;
    }
    currentSkin = next;
    desiredUrl = '';
    pendingUrl = '';
    const idle = resolvePoseAsset(next, 'idle');
    if (idle) failedAt.delete(assetUrl(baseUrl, idle));
    return true;
  }

  function setCalibration(next = {}) {
    calibration = normalizeCalibration({
      x: next.x == null ? calibration.x : next.x,
      y: next.y == null ? calibration.y : next.y,
      scale: next.scale == null ? calibration.scale : next.scale,
    });
    updateCalibrationTransform();
    return { ...calibration };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    transition = null;
    desiredUrl = '';
    pendingUrl = '';
    visibleUrl = '';
    previousUrl = '';
    for (const entry of cache.values()) entry.img?.removeAttribute('src');
    cache.clear();
    failedAt.clear();
    lastError = null;
    layerA.image.removeAttribute('href');
    layerB.image.removeAttribute('href');
    layerA.element.replaceChildren();
    layerB.element.replaceChildren();
    root.replaceChildren();
    root.remove();
  }

  return {
    draw,
    setSkin,
    get skin() { return currentSkin.id; },
    get skins() { return manifest.skins.map(publicSkin); },
    get anchors() { return { bubble: calibratedPoint(...manifest.defaults.bubbleAnchor) }; },
    get extent() {
      const [x0, y0, x1, y1] = manifest.defaults.extent;
      const points = [
        calibratedPoint(x0, y0),
        calibratedPoint(x1, y0),
        calibratedPoint(x0, y1),
        calibratedPoint(x1, y1),
      ];
      return [
        Math.min(...points.map((point) => point[0])),
        Math.min(...points.map((point) => point[1])),
        Math.max(...points.map((point) => point[0])),
        Math.max(...points.map((point) => point[1])),
      ];
    },
    get hits() {
      const [x, y, radius] = manifest.defaults.hit;
      return [[...calibratedPoint(x, y), radius * calibration.scale]];
    },
    get gestures() { return []; },
    get accent() { return currentSkin.accent; },
    get skinMeta() { return copyJson(currentSkin); },
    get calibration() { return { ...calibration }; },
    get colors() {
      return {
        get z() { return currentSkin.accent; },
      };
    },
    setCalibration,
    dispose,
  };
}
