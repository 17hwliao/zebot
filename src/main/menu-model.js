export const FIGURE_XINGYIN = 'xingyin';
export const FIGURE_ZENBOT = 'zenbot';
export const FIGURE_WHALE = 'whale';
export const FIGURE_TERMINAL = 'terminal-bot';
export const DEFAULT_SKIN = 'muse';
export const ZENBOT_RENDERERS = ['sprite', 'rig', 'auto'];

function firstText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) ?? null;
}

function skinMeta(manifest, id, getSkin) {
  let resolved = null;
  if (typeof getSkin === 'function') {
    try {
      resolved = getSkin(manifest, id);
    } catch {
      resolved = null;
    }
  }
  if (resolved && typeof resolved === 'object' && resolved.skin && typeof resolved.skin === 'object') {
    return resolved.skin;
  }
  return resolved && typeof resolved === 'object' ? resolved : null;
}

function normalizeSkin(id, value, manifest, getSkin) {
  const direct = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const resolved = skinMeta(manifest, id, getSkin) ?? {};
  const meta = { ...direct, ...resolved };
  const theme = meta.theme && typeof meta.theme === 'object' ? meta.theme : {};
  const palette = meta.palette && typeof meta.palette === 'object' ? meta.palette : {};
  const label = firstText(
    meta.label,
    meta.displayName,
    meta.display,
    meta.title,
    meta.name,
    direct.label,
    id,
  ) ?? id;
  const accent = firstText(
    meta.accent,
    meta.accentColor,
    theme.accent,
    palette.accent,
    meta.color,
  );
  const eye = firstText(
    meta.eye,
    meta.eyeColor,
    theme.eye,
    palette.eye,
    accent,
  );
  return { id, label, ...(accent ? { accent } : {}), ...(eye ? { eye } : {}) };
}

export function skinListFromManifest(manifest, getSkin = null) {
  const source = manifest && typeof manifest === 'object' ? manifest.skins : null;
  if (!source) return [];

  let entries;
  if (Array.isArray(source)) {
    entries = source.map((value, index) => {
      if (typeof value === 'string') return [value, null];
      const id = firstText(value?.id, value?.key, value?.skin, value?.name);
      return [id ?? String(index), value];
    });
  } else if (typeof source === 'object') {
    entries = Object.entries(source).map(([id, value]) => [id, value]);
  } else {
    return [];
  }

  const seen = new Set();
  const skins = [];
  for (const [id, value] of entries) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    skins.push(normalizeSkin(id, value, manifest, getSkin));
  }
  return skins;
}

function characterOf(state = {}) {
  const character = state.character && typeof state.character === 'object' ? state.character : {};
  return {
    figure: state.figure ?? character.figure ?? FIGURE_ZENBOT,
    skin: state.skin ?? character.skin ?? DEFAULT_SKIN,
    zenbotRenderer: state.zenbotRenderer ?? character.zenbotRenderer ?? 'sprite',
    skins: Array.isArray(state.skins) ? state.skins : [],
    manifestReady: Boolean(state.manifestReady),
  };
}

export function buildSkinItems(state = {}) {
  const current = characterOf(state);
  const select = typeof state.onSelectSkin === 'function' ? state.onSelectSkin : null;
  return current.skins.map((skin) => {
    const id = typeof skin === 'string' ? skin : skin.id;
    const meta = typeof skin === 'string' ? { id: skin, label: skin } : skin;
    return {
      id,
      type: 'radio',
      label: meta.label ?? id,
      checked: current.figure === FIGURE_XINGYIN && current.skin === id,
      ...(meta.accent ? { accent: meta.accent } : {}),
      ...(select ? { click: () => select(id) } : {}),
    };
  });
}

export function buildFigureItems(state = {}) {
  const current = characterOf(state);
  const select = typeof state.onSelectFigure === 'function' ? state.onSelectFigure : null;
  const zenbotAvailable = state.zenbotAvailable !== false;
  const whaleAvailable = state.whaleAvailable !== false;
  const item = (figure, label, enabled = true) => ({
    id: figure,
    type: 'radio',
    label,
    checked: current.figure === figure,
    enabled,
    ...(select ? { click: () => select(figure) } : {}),
  });
  return [
    item(FIGURE_ZENBOT, 'zenbot', zenbotAvailable),
    item(FIGURE_WHALE, 'DeepSeek 鲸鱼娘', whaleAvailable),
  ];
}

export function buildZenbotRendererItems(state = {}) {
  const current = characterOf(state);
  const select = typeof state.onSelectZenbotRenderer === 'function'
    ? state.onSelectZenbotRenderer
    : null;
  const rigAvailable = state.rigAvailable !== false;
  const items = [
    ['sprite', '精灵（稳定）'],
    ['rig', 'Rig（实验）'],
    ['auto', '自动（优先 Rig）'],
  ];
  return items.map(([id, label]) => ({
    id,
    type: 'radio',
    label,
    checked: current.zenbotRenderer === id,
    enabled: id === 'sprite' || rigAvailable,
    ...(select ? { click: () => select(id) } : {}),
  }));
}

export function buildMenuModel(state = {}) {
  const current = characterOf(state);
  const surface = state.surface === 'tray' ? 'tray' : 'context';
  const manifestReady = current.manifestReady;
  const menu = [
    {
      id: 'visibility',
      label: surface === 'tray'
        ? '显示 / 隐藏'
        : state.visible === false ? '显示桌宠' : '隐藏桌宠',
      ...(typeof state.onToggleWindow === 'function' ? { click: state.onToggleWindow } : {}),
    },
    {
      id: 'wake',
      label: surface === 'tray' ? '唤醒' : '唤醒一下',
      ...(typeof state.onWake === 'function' ? { click: state.onWake } : {}),
    },
    { type: 'separator' },
  ];

  if (current.figure === FIGURE_WHALE && manifestReady && current.skins.length > 0) {
    menu.push({
      id: 'change-skin',
      label: '鲸鱼娘配色 / 服装',
      submenu: current.skins.map((skin) => ({
        id: skin.id,
        type: 'radio',
        label: skin.label,
        checked: current.skin === skin.id,
        ...(typeof state.onSelectSkin === 'function' ? { click: () => state.onSelectSkin(skin.id) } : {}),
      })),
    });
  }

  menu.push(
    {
      id: 'motion',
      label: '动作',
      submenu: [
        ['walk', '走路'], ['run', '跑步'], ['stand', '站立'], ['jump', '跳跃'],
        ['hop', '小跳'], ['look', '张望'], ['turn', '转身'], ['nod', '点头'],
        ['shake', '摇头'], ['spin', '旋转'], ['sit', '坐下'], ['sleep', '睡觉'],
        ['dizzy', '眩晕'], ['wave', '招手'], ['bow', '鞠躬'], ['shiver', '发抖'],
        ['flap', '扑腾'], ['dance', '跳舞'],
      ].map(([id, label]) => ({
        id,
        label,
        ...(typeof state.onMotion === 'function' ? { click: () => state.onMotion(id) } : {}),
      })),
    },
    {
      id: 'change-figure',
      label: '形象',
      submenu: buildFigureItems(state),
    },
    ...(current.figure === FIGURE_ZENBOT
      ? [{
          id: 'change-zenbot-renderer',
          label: 'zenbot 渲染器',
          submenu: buildZenbotRendererItems(state),
        }]
      : []),
    { type: 'separator' },
    {
      id: 'quit',
      label: '退出',
      ...(typeof state.onQuit === 'function' ? { click: state.onQuit } : {}),
    },
  );
  return menu;
}
