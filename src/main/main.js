import { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startStaticServer } from './server.js';
import {
  loadConfig,
  normalizeCalibration,
  normalizeCharacterConfig,
  publicConfig,
  saveConfig,
} from './config.js';
import {
  DEFAULT_SKIN,
  FIGURE_TERMINAL,
  FIGURE_XINGYIN,
  FIGURE_ZENBOT,
  FIGURE_WHALE,
  buildMenuModel,
  skinListFromManifest,
} from './menu-model.js';
import { PetRuntime } from './runtime.js';
import { VoiceService } from '../voice/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawArgs = process.argv.slice(1);
const args = new Set(rawArgs);
const MOCK = args.has('--mock');
const SCREENSHOT = args.has('--screenshot');
const ACCEPTANCE = args.has('--acceptance') && !SCREENSHOT;
const DEV = args.has('--dev');
const VOICE = args.has('--voice');
const CALIBRATE = args.has('--calibrate');
const SCREENSHOT_OUT = argValue('out');
const SCREENSHOT_DELAY = Math.max(200, Number(argValue('screenshot-delay')) || 5600);
const PREVIEW_WORD_RAW = argValue('preview-word')?.trim() || null;
const PREVIEW_WORD = PREVIEW_WORD_RAW && /^[a-z][a-z0-9-]*$/i.test(PREVIEW_WORD_RAW)
  ? PREVIEW_WORD_RAW
  : null;
if (PREVIEW_WORD_RAW && !PREVIEW_WORD) {
  console.warn(`[codex-pet] ignored invalid --preview-word value: ${PREVIEW_WORD_RAW}`);
}

const RENDERER_ROOT = path.join(__dirname, '../renderer');
const CHARACTERS_ROOT = path.join(__dirname, '../../assets/characters');
const XINGYIN_ROOT = path.join(CHARACTERS_ROOT, 'xingyin');
const XINGYIN_MANIFEST = path.join(XINGYIN_ROOT, 'manifest.json');
const XINGYIN_MANIFEST_MODULE = path.join(RENDERER_ROOT, 'characters/manifest.js');
const XINGYIN_BASE_URL = '/characters/xingyin/';
const ZENBOT_ROOT = path.join(CHARACTERS_ROOT, 'zenbot');
const ZENBOT_MANIFEST = path.join(ZENBOT_ROOT, 'manifest.json');
const ZENBOT_RIG_MANIFEST = path.join(ZENBOT_ROOT, 'rig/manifest.json');
const ZENBOT_MANIFEST_MODULE = path.join(RENDERER_ROOT, 'characters/zenbot-manifest.js');
const ZENBOT_BASE_URL = '/characters/zenbot/';
const WHALE_ROOT = path.join(CHARACTERS_ROOT, 'whale');
const TERMINAL_LABEL = '终端机器人';
const TERMINAL_ACCENT = '#6ee7b7';

function argValue(name) {
  const prefix = `--${name}=`;
  const found = rawArgs.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function figureName(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized === FIGURE_WHALE || normalized === FIGURE_ZENBOT
    ? normalized
    : null;
}

const FIGURE_OVERRIDE = args.has('--whale')
  ? FIGURE_WHALE
  : args.has('--zenbot') || args.has('--zenbot-rig')
    ? FIGURE_ZENBOT
    : figureName(argValue('figure')) ?? figureName(process.env.CODEX_PET_FIGURE);
const PREVIEW_SKIN = argValue('skin')?.trim() || null;
const ZENBOT_RENDERER_OVERRIDE = args.has('--zenbot-rig')
  ? 'rig'
  : ['sprite', 'rig', 'auto'].includes(argValue('zenbot-renderer'))
    ? argValue('zenbot-renderer')
    : null;

app.setAppUserModelId('local.codex.pet');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const requested = commandLine.find((argument) => argument.startsWith('--figure='))?.slice('--figure='.length);
    const figure = commandLine.includes('--whale') ? FIGURE_WHALE
      : commandLine.includes('--zenbot-rig') || commandLine.includes('--zenbot') ? FIGURE_ZENBOT
        : figureName(requested);
    if (figure) void applyCharacterSelection({ figure }, { persist: false });
    mainWindow.show();
    mainWindow.focus();
  });
}

let mainWindow = null;
let tray = null;
let server = null;
let runtime = null;
let voice = null;
let config = null;
let latestUpdate = null;
let lastHit = false;
let characterQueue = Promise.resolve();

let characterCatalog = {
  valid: false,
  manifest: null,
  skins: [],
  defaultSkin: DEFAULT_SKIN,
};
let whaleCatalog = { valid: false, skins: [] };

let zenbotCatalog = {
  valid: false,
  manifest: null,
  label: 'zenbot',
  accent: '#63d8ff',
};

let zenbotRigCatalog = {
  valid: false,
  manifest: null,
};

let characterState = {
  figure: FIGURE_TERMINAL,
  skin: DEFAULT_SKIN,
  zenbotRenderer: 'sprite',
  label: TERMINAL_LABEL,
  accent: TERMINAL_ACCENT,
  calibration: { x: 0, y: 0, scale: 1 },
};

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function placeWindow(win) {
  const area = workArea();
  if (ACCEPTANCE) {
    const width = Math.min(900, area.width);
    const height = Math.min(620, area.height);
    win.setBounds({
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height,
    });
    return;
  }
  const height = Math.max(220, Math.min(config.window?.height ?? 420, area.height));
  win.setBounds({
    x: area.x,
    y: area.y + area.height - height,
    width: area.width,
    height,
  });
}

function createWindow() {
  const win = new BrowserWindow({
    show: false,
    transparent: !ACCEPTANCE,
    frame: ACCEPTANCE,
    resizable: ACCEPTANCE,
    movable: ACCEPTANCE,
    minimizable: ACCEPTANCE,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: !ACCEPTANCE,
    hasShadow: ACCEPTANCE,
    focusable: !SCREENSHOT,
    backgroundColor: ACCEPTANCE ? '#0b1118' : '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, 'floating');
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // Windows ignores this; macOS may accept it.
  }
  win.setIgnoreMouseEvents(!ACCEPTANCE, { forward: true });
  placeWindow(win);

  win.once('ready-to-show', () => {
    if (ACCEPTANCE) win.show();
    else win.showInactive();
    if (DEV && !SCREENSHOT) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.webContents.on('did-finish-load', () => {
    if (latestUpdate) win.webContents.send('pet:update', latestUpdate);
    if (SCREENSHOT) {
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage();
          const out = SCREENSHOT_OUT
            ? path.resolve(SCREENSHOT_OUT)
            : path.join(__dirname, '../../docs/preview.png');
          await fs.mkdir(path.dirname(out), { recursive: true });
          await fs.writeFile(out, image.toPNG());
          console.log(`[codex-pet] preview: ${out}`);
        } catch (error) {
          console.error('[codex-pet] screenshot failed', error);
        } finally {
          app.quit();
        }
      }, SCREENSHOT_DELAY);
    }
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (DEV || SCREENSHOT) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[codex-pet] renderer gone', details);
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on('blur', () => {
    if (SCREENSHOT || ACCEPTANCE) return;
    lastHit = false;
    win.setIgnoreMouseEvents(true, { forward: true });
  });

  return win;
}

async function collectAvailableFiles(root) {
  const files = new Set();
  async function visit(dir, prefix = '') {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(path.join(dir, entry.name), relative);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
        files.add(relative);
        files.add(entry.name);
      }
    }
  }
  await visit(root);
  return files;
}

async function loadCharacterCatalog() {
  try {
    const raw = JSON.parse(await fs.readFile(XINGYIN_MANIFEST, 'utf8'));
    const availableFiles = await collectAvailableFiles(XINGYIN_ROOT);
    const module = await import(pathToFileURL(XINGYIN_MANIFEST_MODULE).href);
    if (typeof module.validateCharacterManifest !== 'function') {
      throw new Error('manifest module has no validateCharacterManifest export');
    }
    const manifest = module.validateCharacterManifest(raw, { availableFiles });
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('validateCharacterManifest returned no manifest');
    }
    const skins = skinListFromManifest(manifest, module.getSkin);
    if (!skins.length) throw new Error('manifest has no usable skins');

    characterCatalog = {
      valid: true,
      manifest,
      skins,
      defaultSkin: typeof manifest.defaultSkin === 'string' ? manifest.defaultSkin : DEFAULT_SKIN,
    };
    console.log(`[codex-pet] xingyin manifest ready (${skins.length} skins)`);
    if (skins.length !== 9) {
      console.warn(`[codex-pet] xingyin exposes ${skins.length} skins; 9 were expected`);
    }
  } catch (error) {
    characterCatalog = {
      valid: false,
      manifest: null,
      skins: [],
      defaultSkin: DEFAULT_SKIN,
    };
    console.error(
      `[codex-pet] xingyin manifest unavailable, using terminal bot: ${error?.message ?? error}`,
    );
  }
}

async function loadZenbotCatalog() {
  try {
    const raw = JSON.parse(await fs.readFile(ZENBOT_MANIFEST, 'utf8'));
    const availableFiles = await collectAvailableFiles(ZENBOT_ROOT);
    const module = await import(pathToFileURL(ZENBOT_MANIFEST_MODULE).href);
    if (typeof module.validateZenbotManifest !== 'function') {
      throw new Error('zenbot manifest module has no validateZenbotManifest export');
    }
    const manifest = module.validateZenbotManifest(raw, { availableFiles });
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('validateZenbotManifest returned no manifest');
    }
    zenbotCatalog = {
      valid: true,
      manifest,
      label: typeof manifest.name === 'string' ? manifest.name : 'zenbot',
      accent: manifest.defaults?.accent ?? '#63d8ff',
    };
    const expressions = Object.keys(manifest.expressions ?? {}).length;
    const motions = Object.keys(manifest.motions ?? {}).length;
    console.log(`[codex-pet] zenbot manifest ready (${expressions} expressions, ${motions} motions)`);
    if (expressions !== 19 || motions !== 18) {
      console.warn(`[codex-pet] zenbot exposes ${expressions}/${motions}; 19/18 were expected`);
    }
  } catch (error) {
    zenbotCatalog = {
      valid: false,
      manifest: null,
      label: 'zenbot',
      accent: '#63d8ff',
    };
    console.error(`[codex-pet] zenbot manifest unavailable: ${error?.message ?? error}`);
  }
}

async function loadZenbotRigCatalog() {
  try {
    const raw = JSON.parse(await fs.readFile(ZENBOT_RIG_MANIFEST, 'utf8'));
    if (raw?.schemaVersion !== 1) throw new Error('rig manifest schemaVersion must be 1');
    if (raw?.id !== 'zenbot-rig') throw new Error('rig manifest id must be "zenbot-rig"');
    if (!Array.isArray(raw.parts) || !raw.parts.length) throw new Error('rig manifest has no parts');
    if (!raw.deformers || typeof raw.deformers !== 'object') throw new Error('rig manifest has no deformers');
    zenbotRigCatalog = { valid: true, manifest: raw };
    console.log(
      `[codex-pet] zenbot rig manifest ready (${raw.parts.length} parts, `
      + `${Object.keys(raw.expressions ?? {}).length} expressions)`,
    );
  } catch (error) {
    zenbotRigCatalog = { valid: false, manifest: null };
    if (error?.code === 'ENOENT') {
      console.log('[codex-pet] zenbot rig not installed; sprite remains the only renderer');
    } else {
      console.error(`[codex-pet] zenbot rig manifest unavailable: ${error?.message ?? error}`);
    }
  }
}

function preferredSkinId() {
  const skins = characterCatalog.valid ? characterCatalog.skins : [];
  const preferred = skins.find((skin) => skin.id === characterCatalog.defaultSkin);
  if (preferred) return preferred.id;
  const muse = skins.find((skin) => skin.id === 'muse');
  return muse?.id ?? skins[0]?.id ?? DEFAULT_SKIN;
}

async function loadWhaleCatalog() {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(WHALE_ROOT, 'figure.json'), 'utf8'));
    const model = JSON.parse(await fs.readFile(path.join(WHALE_ROOT, 'model.json'), 'utf8'));
    if (raw.id !== 'whale' || !Array.isArray(model.parts)) throw new Error('invalid whale model');
    const schemes = raw.axes.find((axis) => axis.id === 'scheme').options;
    const outfits = raw.axes.find((axis) => axis.id === 'outfit').options;
    const skins = schemes.filter((scheme) => model.schemes.some((item) => item.id === scheme.id && item.ready !== false))
      .flatMap((scheme) => outfits.map((outfit) => ({
        id: `${scheme.id}-${outfit.id}`,
        label: `${scheme.name.zh ?? scheme.name.en} · ${outfit.name.zh ?? outfit.name.en}`,
        accent: scheme.accent,
      })));
    whaleCatalog = { valid: skins.length > 0, skins };
    console.log(`[codex-pet] whale ready (${skins.length} colour/outfit combinations)`);
  } catch (error) {
    whaleCatalog = { valid: false, skins: [] };
    console.error('[codex-pet] whale unavailable', error.message);
  }
}

function resolveSkinId(requested) {
  if (!characterCatalog.valid || !characterCatalog.skins.length) return DEFAULT_SKIN;
  const found = characterCatalog.skins.find((skin) => skin.id === requested);
  if (found) return found.id;
  const fallback = preferredSkinId();
  if (requested) {
    console.warn(`[codex-pet] skin "${requested}" is unavailable; using "${fallback}"`);
  }
  return fallback;
}

function characterFrom(figure, skin, calibration, zenbotRenderer = 'sprite') {
  const normalizedCalibration = normalizeCalibration(calibration);
  const normalizedRenderer = zenbotRenderer === 'rig' || zenbotRenderer === 'auto'
    ? zenbotRenderer
    : 'sprite';
  if (figure === FIGURE_ZENBOT && zenbotCatalog.valid) {
    return {
      figure: FIGURE_ZENBOT,
      skin: normalizeCharacterConfig({ skin }).skin,
      zenbotRenderer: normalizedRenderer,
      label: zenbotCatalog.label,
      accent: zenbotCatalog.accent,
      calibration: normalizedCalibration,
    };
  }
  if (figure === FIGURE_WHALE && whaleCatalog.valid) {
    const meta = whaleCatalog.skins.find((item) => item.id === skin)
      ?? whaleCatalog.skins.find((item) => item.id === 'deepseek-maid')
      ?? whaleCatalog.skins[0];
    return {
      figure: FIGURE_WHALE,
      skin: meta.id,
      zenbotRenderer: normalizedRenderer,
      label: 'DeepSeek 鲸鱼娘',
      accent: meta?.accent ?? TERMINAL_ACCENT,
      calibration: normalizedCalibration,
    };
  }
  return {
    figure: FIGURE_TERMINAL,
    skin: normalizeCharacterConfig({ skin }).skin,
    zenbotRenderer: normalizedRenderer,
    label: TERMINAL_LABEL,
    accent: TERMINAL_ACCENT,
    calibration: normalizedCalibration,
  };
}

function initialCharacter() {
  const stored = normalizeCharacterConfig(config.character);
  let figure = FIGURE_OVERRIDE ?? stored.figure;
  if (figure === FIGURE_WHALE && !whaleCatalog.valid) figure = FIGURE_ZENBOT;
  if (figure === FIGURE_XINGYIN && !characterCatalog.valid) {
    console.warn('[codex-pet] xingyin requested but unavailable; starting terminal bot');
    figure = FIGURE_TERMINAL;
  }
  if (figure === FIGURE_ZENBOT && !zenbotCatalog.valid) {
    console.warn('[codex-pet] zenbot requested but unavailable; starting terminal bot');
    figure = FIGURE_TERMINAL;
  }
  const requestedSkin = PREVIEW_SKIN ?? stored.skin;
  const requestedRenderer = ZENBOT_RENDERER_OVERRIDE ?? stored.zenbotRenderer;
  if (ZENBOT_RENDERER_OVERRIDE && !zenbotRigCatalog.valid) {
    console.warn(`[codex-pet] zenbot renderer "${ZENBOT_RENDERER_OVERRIDE}" requested without a valid rig`);
  }
  if (ZENBOT_RENDERER_OVERRIDE) {
    console.log(`[codex-pet] preview zenbot renderer: ${ZENBOT_RENDERER_OVERRIDE} (not persisted)`);
  }
  const character = characterFrom(figure, requestedSkin, stored.calibration, requestedRenderer);
  if (PREVIEW_SKIN && character.figure === FIGURE_XINGYIN && character.skin !== PREVIEW_SKIN) {
    console.warn(`[codex-pet] preview skin "${PREVIEW_SKIN}" is unavailable`);
  }
  if (PREVIEW_SKIN) {
    console.log(`[codex-pet] preview skin: ${character.skin} (not persisted)`);
  }
  return character;
}

function characterEvent() {
  return {
    figure: characterState.figure,
    skin: characterState.skin,
    zenbotRenderer: characterState.zenbotRenderer,
    label: characterState.label,
    accent: characterState.accent,
  };
}

function sendCharacter() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('pet:character', characterEvent());
}

function menuState(surface) {
  return {
    surface,
    visible: mainWindow?.isVisible() ?? false,
    figure: characterState.figure,
    skin: characterState.skin,
    zenbotRenderer: characterState.zenbotRenderer,
    skins: characterState.figure === FIGURE_WHALE ? whaleCatalog.skins : [],
    manifestReady: whaleCatalog.valid,
    starAvailable: characterCatalog.valid,
    zenbotAvailable: zenbotCatalog.valid,
    whaleAvailable: whaleCatalog.valid,
    rigAvailable: zenbotRigCatalog.valid,
    onToggleWindow: () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else mainWindow.showInactive();
    },
    onWake: () => runtime?.input({ type: 'voice.wake', keyword: surface }),
    onSelectSkin: (skin) => {
      void applyCharacterSelection({ figure: FIGURE_WHALE, skin });
    },
    onMotion: (word) => mainWindow?.webContents.send('pet:motion', word),
    onSelectFigure: (figure) => {
      void applyCharacterSelection({ figure, skin: characterState.skin });
    },
    onSelectZenbotRenderer: (zenbotRenderer) => {
      void applyCharacterSelection({ zenbotRenderer });
    },
    onQuit: () => app.quit(),
  };
}

function accentImage(accent) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(accent ?? '');
  if (!match) return undefined;
  const hex = match[1].length === 3
    ? match[1].split('').map((part) => part + part).join('')
    : match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const size = 12;
  const radius = 5;
  const bitmap = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - 5.5, y - 5.5);
      const alpha = Math.max(0, Math.min(1, radius + 1 - distance));
      const offset = (y * size + x) * 4;
      bitmap[offset] = Math.round(blue * alpha);
      bitmap[offset + 1] = Math.round(green * alpha);
      bitmap[offset + 2] = Math.round(red * alpha);
      bitmap[offset + 3] = Math.round(255 * alpha);
    }
  }
  try {
    return nativeImage.createFromBitmap(bitmap, { width: size, height: size, scaleFactor: 1 });
  } catch {
    return undefined;
  }
}

function electronMenu(items) {
  return items.map((item) => {
    const { accent, ...entry } = item;
    if (Array.isArray(entry.submenu)) entry.submenu = electronMenu(entry.submenu);
    if (accent) {
      const icon = accentImage(accent);
      if (icon) entry.icon = icon;
    }
    return entry;
  });
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  try {
    tray.setContextMenu(Menu.buildFromTemplate(electronMenu(buildMenuModel(menuState('tray')))));
  } catch (error) {
    console.error('[codex-pet] failed to rebuild tray menu', error);
  }
}

function showMenu() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const menu = Menu.buildFromTemplate(electronMenu(buildMenuModel(menuState('context'))));
  menu.popup({ window: mainWindow });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/tray.png');
  try {
    const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('Codex Pet');
    rebuildTrayMenu();
    tray.on('click', () => (mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.showInactive()));
  } catch (error) {
    console.warn('[codex-pet] tray unavailable', error.message);
  }
}

function queueCharacterTask(task) {
  const run = characterQueue.then(task, task);
  characterQueue = run.catch(() => {});
  return run;
}

function applyCharacterSelection(patch = {}, { persist = true } = {}) {
  return queueCharacterTask(async () => {
    const previous = characterState;
    try {
      const figure = patch.figure ?? previous.figure;
      if (figure !== FIGURE_WHALE && figure !== FIGURE_ZENBOT) {
        throw new Error(`unknown figure "${figure}"`);
      }
      if (figure === FIGURE_WHALE && !whaleCatalog.valid) {
        throw new Error('whale model is not available');
      }
      if (figure === FIGURE_ZENBOT && !zenbotCatalog.valid) {
        throw new Error('zenbot manifest is not available');
      }
      const skin = typeof patch.skin === 'string' ? patch.skin : previous.skin;
      const requestedRenderer = typeof patch.zenbotRenderer === 'string'
        ? patch.zenbotRenderer
        : previous.zenbotRenderer;
      const next = characterFrom(figure, skin, previous.calibration, requestedRenderer);

      if (persist) {
        const nextConfig = {
          ...config,
          character: {
            figure: next.figure,
            skin: next.skin,
            zenbotRenderer: next.zenbotRenderer,
            calibration: normalizeCalibration(next.calibration),
          },
        };
        await saveConfig(app.getPath('userData'), nextConfig);
        config.character = nextConfig.character;
      }

      characterState = next;
      rebuildTrayMenu();
      sendCharacter();
      return { ok: true, character: characterEvent() };
    } catch (error) {
      console.error('[codex-pet] character selection failed; restored previous state', error);
      characterState = previous;
      rebuildTrayMenu();
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
}

function cycleSkin() {
  if (!whaleCatalog.valid || !whaleCatalog.skins.length) return;
  const skins = whaleCatalog.skins;
  const index = skins.findIndex((skin) => skin.id === characterState.skin);
  const next = skins[(index + 1) % skins.length];
  void applyCharacterSelection({ figure: FIGURE_WHALE, skin: next.id });
}

function calibrationPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { x, y, scale } = value;
  if (![x, y, scale].every((number) => typeof number === 'number' && Number.isFinite(number))) {
    return null;
  }
  if (scale <= 0) return null;
  return normalizeCalibration({ x, y, scale });
}

function persistCalibration(value) {
  return queueCharacterTask(async () => {
    const calibration = calibrationPayload(value);
    if (!calibration) throw new Error('invalid calibration payload');

    const persisted = normalizeCharacterConfig(config.character);
    const nextConfig = {
      ...config,
      character: { ...persisted, calibration },
    };
    await saveConfig(app.getPath('userData'), nextConfig);
    config.character = nextConfig.character;
    characterState = { ...characterState, calibration };
    return calibration;
  });
}

async function boot() {
  config = await loadConfig(app.getPath('userData'));
  if (VOICE) config.voice.enabled = true;
  await loadWhaleCatalog();
  await loadZenbotCatalog();
  await loadZenbotRigCatalog();
  characterState = initialCharacter();

  server = await startStaticServer(RENDERER_ROOT, {
    // Keep the figure's source module at /characters/manifest.js visible.
    // A broader asset mount would shadow src/renderer/characters/.
    mounts: {
      '/characters/xingyin/': XINGYIN_ROOT,
      '/characters/zenbot/': ZENBOT_ROOT,
      '/characters/whale/': WHALE_ROOT,
    },
  });
  mainWindow = createWindow();

  runtime = new PetRuntime({
    config,
    mock: MOCK,
  });
  runtime.on('update', (update) => {
    latestUpdate = update;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pet:update', update);
  });
  if (!ACCEPTANCE) runtime.start();

  voice = new VoiceService({
    config: config.voice,
    keywordsFile: config.voice.keywordsFile || path.join(__dirname, '../../assets/keywords.txt'),
    onKeyword: (keyword) => runtime?.input({ type: 'voice.wake', keyword }),
    onCommand: (text) => runtime?.input({ type: 'voice.command', text }),
  });
  voice.on('status', (status) => {
    const detail = status.detail ? ` (${status.detail})` : '';
    console.log(`[codex-pet] voice: ${status.state} — ${status.message}${detail}`);
  });
  if (config.voice?.enabled) voice.start();

  ipcMain.on('pet:hit', (_event, hit) => {
    if (!mainWindow || SCREENSHOT || ACCEPTANCE) return;
    const next = Boolean(hit);
    if (next === lastHit) return;
    lastHit = next;
    mainWindow.setIgnoreMouseEvents(!next, { forward: true });
  });
  ipcMain.on('pet:input', (_event, event) => {
    if (event && typeof event.type === 'string') runtime?.input(event);
  });
  ipcMain.on('pet:menu', () => showMenu());
  ipcMain.on('pet:quit', () => app.quit());
  ipcMain.handle('pet:config', () => publicConfig(config));
  ipcMain.handle('pet:select-character', (_event, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false };
    return applyCharacterSelection({ figure: patch.figure, skin: patch.skin, zenbotRenderer: patch.zenbotRenderer });
  });
  ipcMain.handle('pet:save-calibration', async (_event, calibration) => {
    try {
      return await persistCalibration(calibration);
    } catch (error) {
      console.error('[codex-pet] calibration save failed', error);
      throw new Error('calibration save failed');
    }
  });

  const url = new URL(server.url);
  url.pathname = '/index.html';
  url.searchParams.set('figure', characterState.figure);
  url.searchParams.set('skin', characterState.skin);
  url.searchParams.set('zenbotRenderer', characterState.zenbotRenderer);
  url.searchParams.set(
    'characterBase',
    characterState.figure === FIGURE_ZENBOT ? ZENBOT_BASE_URL : XINGYIN_BASE_URL,
  );
  url.searchParams.set('calibrate', CALIBRATE ? '1' : '0');
  url.searchParams.set('calibration', JSON.stringify(characterState.calibration));
  if (SCREENSHOT || ACCEPTANCE) url.searchParams.set('preview', '1');
  if (ACCEPTANCE) url.searchParams.set('acceptance', '1');
  if (PREVIEW_WORD) {
    url.searchParams.set('previewWord', PREVIEW_WORD);
    url.searchParams.set(
      'previewWordAt',
      String(SCREENSHOT ? Math.max(600, SCREENSHOT_DELAY - 450) : 1200),
    );
  }
  await mainWindow.loadURL(url.toString());

  createTray();

  globalShortcut.register('CommandOrControl+Alt+Space', () => {
    runtime?.input({ type: 'voice.wake', keyword: 'hotkey' });
  });
  globalShortcut.register('CommandOrControl+Alt+S', cycleSkin);
  globalShortcut.register('CommandOrControl+Alt+P', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.showInactive();
  });
  globalShortcut.register('CommandOrControl+Alt+Q', () => app.quit());

  screen.on('display-metrics-changed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) placeWindow(mainWindow);
  });
}

if (gotLock) app.whenReady().then(boot).catch((error) => {
  console.error('[codex-pet] failed to start', error);
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  runtime?.stop();
  voice?.stop();
  tray?.destroy();
  server?.close();
});

app.on('window-all-closed', () => {
  if (!SCREENSHOT) app.quit();
});
