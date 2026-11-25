export const CHARACTER_MANIFEST_SCHEMA_VERSION = 1;

const POSE_ORDER = ['idle', 'blink', 'listening', 'shy', 'speakingClosed'];
const HEX_ACCENT = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const WINDOWS_ABSOLUTE = /^[a-z]:/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const UNSAFE_FILE_CHARS = /[\u0000-\u001f<>:"|?*#]/;
const ENCODED_SEPARATOR = /%(?:2e|2f|5c)/i;

function fail(path, message, Type = TypeError) {
  throw new Type(`${path}: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isRecord(value)) return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) copy[key] = cloneValue(item);
  return copy;
}

function requiredRecord(value, path) {
  if (!isRecord(value)) fail(path, 'must be an object');
  return cloneValue(value);
}

function requiredString(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'must be a non-empty string');
  return value;
}

function requiredNumber(value, path) {
  if (!Number.isFinite(value)) fail(path, 'must be a finite number');
  return value;
}

function positiveNumber(value, path) {
  const number = requiredNumber(value, path);
  if (number <= 0) fail(path, 'must be greater than zero');
  return number;
}

function numberPair(value, path) {
  if (!Array.isArray(value) || value.length !== 2) fail(path, 'must be a two-number array');
  return [
    requiredNumber(value[0], `${path}[0]`),
    requiredNumber(value[1], `${path}[1]`),
  ];
}

function sourceCanvas(value, path) {
  const canvas = numberPair(value, path);
  if (canvas[0] <= 0 || canvas[1] <= 0) fail(path, 'dimensions must be greater than zero');
  return canvas;
}

function hitCircle(value, path) {
  if (!Array.isArray(value) || value.length !== 3) fail(path, 'must be a [x, y, radius] array');
  const hit = [
    requiredNumber(value[0], `${path}[0]`),
    requiredNumber(value[1], `${path}[1]`),
    positiveNumber(value[2], `${path}[2]`),
  ];
  return hit;
}

function extentBox(value, path) {
  if (!Array.isArray(value) || value.length !== 4) fail(path, 'must be an [x0, y0, x1, y1] array');
  const extent = value.map((item, index) => requiredNumber(item, `${path}[${index}]`));
  if (extent[0] >= extent[2] || extent[1] >= extent[3]) fail(path, 'must have x0 < x1 and y0 < y1');
  return extent;
}

function accentColor(value, path) {
  const accent = requiredString(value, path);
  if (!HEX_ACCENT.test(accent)) fail(path, 'must be a CSS hexadecimal colour');
  return accent;
}

function cropRect(value, path, canvas) {
  if (!Array.isArray(value) || value.length !== 4) fail(path, 'must be an [x, y, width, height] array');
  const crop = value.map((item, index) => requiredNumber(item, `${path}[${index}]`));
  if (crop[0] < 0 || crop[1] < 0) fail(path, 'x and y must not be negative');
  if (crop[2] <= 0 || crop[3] <= 0) fail(path, 'width and height must be greater than zero');
  if (crop[0] + crop[2] > canvas[0] || crop[1] + crop[3] > canvas[1]) {
    fail(path, 'must fit inside sourceCanvas');
  }
  return crop;
}

function assetFile(value, path) {
  const file = requiredString(value, path);
  if (!file.toLowerCase().endsWith('.png')) fail(path, 'must end with .png');
  if (file.split('/').at(-1).length <= 4) fail(path, 'must include a PNG filename');
  if (file.startsWith('/') || file.startsWith('\\') || WINDOWS_ABSOLUTE.test(file) || URL_SCHEME.test(file)) {
    fail(path, 'must be a relative asset path');
  }
  if (file.includes('\\')) fail(path, 'must use forward slashes, not backslashes');
  if (UNSAFE_FILE_CHARS.test(file) || ENCODED_SEPARATOR.test(file)) fail(path, 'contains an unsafe character');
  const segments = file.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(path, 'must not contain empty, current, or parent path segments');
  }
  return file;
}

function normalizeAsset(value, path, canvas) {
  if (typeof value === 'string') {
    return {
      file: assetFile(value, path),
      crop: [0, 0, canvas[0], canvas[1]],
    };
  }
  if (!isRecord(value)) fail(path, 'must be a PNG filename or an asset object');
  const asset = cloneValue(value);
  asset.file = assetFile(value.file, `${path}.file`);
  asset.crop = value.crop == null
    ? [0, 0, canvas[0], canvas[1]]
    : cropRect(value.crop, `${path}.crop`, canvas);
  return asset;
}

function availableFileSet(value) {
  if (value === undefined) return null;
  if (!value || typeof value.has !== 'function') {
    fail('options.availableFiles', 'must be a Set of asset filenames');
  }
  return value;
}

export function validateCharacterManifest(raw, { availableFiles } = {}) {
  if (!isRecord(raw)) fail('manifest', 'must be an object');
  if (raw.schemaVersion !== CHARACTER_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`manifest.schemaVersion: expected ${CHARACTER_MANIFEST_SCHEMA_VERSION}`);
  }

  const manifest = cloneValue(raw);
  manifest.id = requiredString(raw.id, 'manifest.id');
  manifest.name = requiredString(raw.name, 'manifest.name');
  manifest.license = requiredString(raw.license, 'manifest.license');
  manifest.sourceCanvas = sourceCanvas(raw.sourceCanvas, 'manifest.sourceCanvas');
  manifest.defaultSkin = requiredString(raw.defaultSkin, 'manifest.defaultSkin');

  const drawing = requiredRecord(raw.drawing, 'manifest.drawing');
  drawing.logoHeight = positiveNumber(raw.drawing.logoHeight, 'manifest.drawing.logoHeight');
  drawing.centerX = requiredNumber(raw.drawing.centerX, 'manifest.drawing.centerX');
  drawing.feetY = requiredNumber(raw.drawing.feetY, 'manifest.drawing.feetY');
  manifest.drawing = drawing;

  const defaults = requiredRecord(raw.defaults, 'manifest.defaults');
  defaults.bubbleAnchor = numberPair(raw.defaults.bubbleAnchor, 'manifest.defaults.bubbleAnchor');
  defaults.hit = hitCircle(raw.defaults.hit, 'manifest.defaults.hit');
  defaults.extent = extentBox(raw.defaults.extent, 'manifest.defaults.extent');
  defaults.accent = accentColor(raw.defaults.accent, 'manifest.defaults.accent');
  manifest.defaults = defaults;

  if (!Array.isArray(raw.skins)) fail('manifest.skins', 'must be an array');
  const files = availableFileSet(availableFiles);
  const seenIds = new Set();
  const skins = [];

  for (let index = 0; index < raw.skins.length; index += 1) {
    const source = raw.skins[index];
    const path = `manifest.skins[${index}]`;
    if (!isRecord(source)) fail(path, 'must be an object');

    const skin = cloneValue(source);
    skin.id = requiredString(source.id, `${path}.id`);
    skin.label = requiredString(source.label, `${path}.label`);
    skin.accent = accentColor(source.accent, `${path}.accent`);
    if (seenIds.has(skin.id)) fail(`${path}.id`, `duplicate skin id "${skin.id}"`, Error);
    seenIds.add(skin.id);

    const sourceAssets = requiredRecord(source.assets, `${path}.assets`);
    if (!Object.prototype.hasOwnProperty.call(sourceAssets, 'idle')) {
      fail(`${path}.assets.idle`, 'is required');
    }

    const assets = cloneValue(sourceAssets);
    for (const pose of POSE_ORDER) {
      if (!Object.prototype.hasOwnProperty.call(sourceAssets, pose)) continue;
      assets[pose] = normalizeAsset(sourceAssets[pose], `${path}.assets.${pose}`, manifest.sourceCanvas);
    }

    for (const pose of POSE_ORDER) {
      if (!assets[pose] || !files || files.has(assets[pose].file)) continue;
      delete assets[pose];
    }

    if (!assets.idle || (files && !files.has(assets.idle.file))) continue;
    skin.assets = assets;
    skins.push(skin);
  }

  if (skins.length === 0) {
    throw new Error('Character manifest has no valid skins with an available idle asset');
  }

  manifest.skins = skins;
  if (!skins.some((skin) => skin.id === manifest.defaultSkin)) {
    manifest.defaultSkin = skins[0].id;
  }
  return manifest;
}

export function listCharacterAssets(manifest) {
  const files = [];
  const seen = new Set();
  for (const skin of manifest?.skins ?? []) {
    for (const asset of Object.values(skin?.assets ?? {})) {
      const file = typeof asset === 'string' ? asset : asset?.file;
      if (typeof file !== 'string' || seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }
  return files;
}

export function getSkin(manifest, id) {
  return manifest?.skins?.find((skin) => skin?.id === id) ?? null;
}

export function resolvePoseAsset(skin, pose) {
  if (!skin?.assets || !Object.prototype.hasOwnProperty.call(skin.assets, pose)) return null;
  const asset = skin.assets[pose];
  if (typeof asset === 'string') return { file: asset };
  if (!isRecord(asset) || typeof asset.file !== 'string') return null;
  return cloneValue(asset);
}
