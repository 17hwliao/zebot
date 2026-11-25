import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import {
  buildFigureItems,
  buildMenuModel,
  buildSkinItems,
  buildZenbotRendererItems,
  skinListFromManifest,
} from '../src/main/menu-model.js';

const skins = [
  { id: 'muse', label: '星音', accent: '#ff6b9d', eye: '#ffd166' },
  { id: 'casual', label: '便装', accent: '#5aaef0' },
  { id: 'formal', label: '礼服', accent: '#c084fc' },
  { id: 'school', label: '校服', accent: '#34d399' },
  { id: 'winter', label: '冬装', accent: '#93c5fd' },
  { id: 'summer', label: '夏装', accent: '#fbbf24' },
  { id: 'festival', label: '节日', accent: '#fb7185' },
  { id: 'sleep', label: '睡衣', accent: '#a78bfa' },
  { id: 'lounge', label: '居家', accent: '#f97316' },
];

test('nine skins keep manifest order and labels', () => {
  const items = buildSkinItems({ figure: 'xingyin', skin: 'muse', skins });
  assert.equal(items.length, 9);
  assert.deepEqual(items.map((item) => item.id), skins.map((skin) => skin.id));
  assert.deepEqual(items.map((item) => item.label), skins.map((skin) => skin.label));
});

test('only the current xingyin skin is radio checked', () => {
  const star = buildSkinItems({ figure: 'xingyin', skin: 'winter', skins });
  assert.equal(star.filter((item) => item.checked).length, 1);
  assert.equal(star.find((item) => item.checked).id, 'winter');
  const terminal = buildSkinItems({ figure: 'terminal-bot', skin: 'winter', skins });
  assert.equal(terminal.some((item) => item.checked), false);
});

test('character menu offers whale outfits and only zenbot and whale figures', () => {
  let selectedSkin = null;
  let selectedFigure = null;
  const menu = buildMenuModel({
    visible: true,
    figure: 'whale',
    skin: 'formal',
    skins,
    manifestReady: true,
    onSelectSkin: (id) => { selectedSkin = id; },
    onSelectFigure: (figure) => { selectedFigure = figure; },
  });
  const skinMenu = menu.find((item) => item.id === 'change-skin');
  const figureMenu = menu.find((item) => item.id === 'change-figure');
  assert.equal(skinMenu.label, '鲸鱼娘配色 / 服装');
  assert.equal(skinMenu.submenu.find((item) => item.checked).id, 'formal');
  assert.equal(figureMenu.submenu.find((item) => item.checked).label, 'DeepSeek 鲸鱼娘');
  skinMenu.submenu[1].click();
  figureMenu.submenu.find((item) => item.id === 'zenbot').click();
  assert.equal(selectedSkin, 'casual');
  assert.equal(selectedFigure, 'zenbot');
});

test('zenbot is offered as a figure and is disabled without its manifest', () => {
  const available = buildFigureItems({ figure: 'zenbot', zenbotAvailable: true });
  assert.deepEqual(available.map((item) => item.id), ['zenbot', 'whale']);
  assert.equal(available.find((item) => item.checked).id, 'zenbot');
  assert.equal(available.find((item) => item.id === 'zenbot').enabled, true);

  const missing = buildFigureItems({ figure: 'xingyin', zenbotAvailable: false });
  assert.equal(missing.find((item) => item.id === 'zenbot').enabled, false);
});

test('zenbot exposes sprite, rig and auto renderer choices', () => {
  let selected = null;
  const items = buildZenbotRendererItems({
    figure: 'zenbot',
    zenbotRenderer: 'auto',
    rigAvailable: true,
    onSelectZenbotRenderer: (value) => { selected = value; },
  });
  assert.deepEqual(items.map((item) => item.id), ['sprite', 'rig', 'auto']);
  assert.equal(items.find((item) => item.checked).id, 'auto');
  items.find((item) => item.id === 'rig').click();
  assert.equal(selected, 'rig');

  const unavailable = buildZenbotRendererItems({ figure: 'zenbot', rigAvailable: false });
  assert.equal(unavailable.find((item) => item.id === 'sprite').enabled, true);
  assert.equal(unavailable.find((item) => item.id === 'rig').enabled, false);
  assert.equal(unavailable.find((item) => item.id === 'auto').enabled, false);
});

test('renderer submenu appears only while zenbot is the current figure', () => {
  const zenbot = buildMenuModel({ figure: 'zenbot', zenbotRenderer: 'rig' });
  const item = zenbot.find((entry) => entry.id === 'change-zenbot-renderer');
  assert.ok(item);
  assert.equal(item.submenu.find((entry) => entry.checked).id, 'rig');

  const xingyin = buildMenuModel({ figure: 'xingyin', skins, manifestReady: true });
  assert.equal(xingyin.some((entry) => entry.id === 'change-zenbot-renderer'), false);
});

test('legacy figures and skins are absent from selectable menus', () => {
  for (const figure of ['zenbot', 'xingyin', 'terminal-bot']) {
    const menu = buildMenuModel({ figure, skins, manifestReady: true });
    assert.equal(menu.some((item) => item.id === 'change-skin'), false);
    assert.deepEqual(menu.find((item) => item.id === 'change-figure').submenu.map((item) => item.id), ['zenbot', 'whale']);
  }
});

test('skin menu is omitted without a valid manifest', () => {
  const menu = buildMenuModel({ figure: 'terminal-bot', skins, manifestReady: false });
  assert.equal(menu.some((item) => item.id === 'change-skin'), false);
  assert.equal(menu.some((item) => item.id === 'change-figure'), true);
});

test('manifest skin metadata supplies stable ids and labels', () => {
  const manifest = {
    skins: {
      muse: { name: '默认星音', color: '#ff6b9d' },
      casual: { displayName: '便装', theme: { accent: '#5aaef0', eye: '#fff' } },
    },
  };
  const getSkin = (source, id) => source.skins[id];
  const list = skinListFromManifest(manifest, getSkin);
  assert.deepEqual(list, [
    { id: 'muse', label: '默认星音', accent: '#ff6b9d', eye: '#ff6b9d' },
    { id: 'casual', label: '便装', accent: '#5aaef0', eye: '#fff' },
  ]);
});

test('the xingyin manifest exposes the expected nine ordered skins', async () => {
  const raw = JSON.parse(await fs.readFile(
    new URL('../assets/characters/xingyin/manifest.json', import.meta.url),
    'utf8',
  ));
  const list = skinListFromManifest(
    raw,
    (manifest, id) => manifest.skins.find((skin) => skin.id === id),
  );
  assert.deepEqual(list.map((skin) => [skin.id, skin.label]), [
    ['muse', '星音'],
    ['amber-scholar', '琥珀学者'],
    ['azure-fan', '青扇'],
    ['ink-fox', '墨狐'],
    ['ivory-dragon', '象牙龙'],
    ['moon-piano', '月琴'],
    ['noir-gold', '夜金'],
    ['ocean-maid', '海之女仆'],
    ['violet-stars', '紫星'],
  ]);
});
