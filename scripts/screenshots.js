import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'docs', 'previews');
const skins = ['muse', 'moon-piano', 'ocean-maid'];

async function capture(skin) {
  const out = path.join(outputDir, `xingyin-${skin}.png`);
  await rm(out, { force: true });
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [
      '.',
      '--mock',
      '--screenshot',
      `--skin=${skin}`,
      `--out=${out}`,
    ], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Screenshot timed out for ${skin}`));
    }, 30_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Electron exited for ${skin}: code=${code} signal=${signal}`));
    });
  });
  console.log(`[codex-pet] captured ${out}`);
}

await mkdir(outputDir, { recursive: true });
for (const skin of skins) await capture(skin);
