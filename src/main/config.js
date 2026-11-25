import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_CONFIG = {
  adapter: 'codex-session',
  window: {
    height: 420,
  },
  gateway: {
    enabled: false,
    url: 'ws://127.0.0.1:3426/pet',
    token: '',
  },
  voice: {
    enabled: false,
    modelsDir: '',
    keywordsFile: '',
    autostart: false,
  },
  privacy: {
    persistAudio: false,
    showFullAgentText: false,
  },
  character: {
    figure: 'zenbot',
    skin: 'muse',
    zenbotRenderer: 'auto',
    calibration: { x: 0, y: 0, scale: 1 },
  },
};

function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object'
      ? merge(base[key], value)
      : value;
  }
  return out;
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeCalibration(value) {
  const calibration = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const scale = finite(calibration.scale, 1);
  return {
    x: finite(calibration.x, 0),
    y: finite(calibration.y, 0),
    scale: scale > 0 ? scale : 1,
  };
}

export function normalizeCharacterConfig(value) {
  const character = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const figure = character.figure === 'whale' || character.figure === 'zenbot'
    ? character.figure
    : 'zenbot';
  const zenbotRenderer = ['zenbot', 'whale'].includes(character.figure) && ['sprite', 'rig', 'auto'].includes(character.zenbotRenderer)
    ? character.zenbotRenderer
    : 'auto';
  const skin = typeof character.skin === 'string'
    && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(character.skin)
    ? character.skin
    : 'muse';
  return {
    figure,
    skin,
    zenbotRenderer,
    calibration: normalizeCalibration(character.calibration),
  };
}

export async function loadConfig(userData) {
  const file = path.join(userData, 'config.json');
  let stored = {};
  try {
    stored = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    stored = {};
  }
  const config = merge(DEFAULT_CONFIG, stored);
  config.character = normalizeCharacterConfig(config.character);
  if (config.gateway.enabled && !config.gateway.token) {
    config.gateway.token = crypto.randomBytes(32).toString('hex');
    await saveConfig(userData, config);
  }
  return config;
}

export async function saveConfig(userData, config) {
  const file = path.join(userData, 'config.json');
  const next = {
    ...config,
    character: normalizeCharacterConfig(config?.character),
  };
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

export function publicConfig(config) {
  const copy = structuredClone(config);
  if (copy.gateway) delete copy.gateway.token;
  return copy;
}

