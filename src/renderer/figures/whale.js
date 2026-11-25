import { createRig } from '../kit/rig.js';

export async function createWhaleFigure(options = {}) {
  const base = new URL(options.baseUrl ?? '/characters/whale/', options.documentUrl ?? document.baseURI);
  const factory = options.factory ?? (await import(new URL('figure.js', base).href)).createWhaleFigure;
  const figure = await factory(base, {
    kit: { createRig },
    scheme: options.skin ?? 'deepseek-maid',
    raster: options.raster ?? true,
  });
  if (!figure || typeof figure.draw !== 'function') throw new Error('invalid whale figure');
  figure.renderer = 'rig';
  figure.skinMeta = { label: 'DeepSeek 鲸鱼娘' };
  figure.accent = '#4D6BFE';
  return figure;
}
