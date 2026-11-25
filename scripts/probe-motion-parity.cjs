const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/zenbot/rig/evidence/parity');
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let window;
let server;

async function observe() {
  return window.webContents.executeJavaScript(`(() => {
    const group = document.getElementById('petG');
    const image = group.querySelector('image');
    return {
      x: Number(group.getAttribute('transform')?.split('(')[1]?.split(' ')[0]),
      status: document.querySelector('.motion-status')?.textContent,
      raster: image?.getAttribute('href')?.length ?? 0,
      controls: Array.from(document.querySelectorAll('.motion-buttons button')).map(button => button.textContent),
      selected: document.querySelector('select[aria-label="角色"]')?.value,
    };
  })()`);
}

async function run() {
  await app.whenReady();
  await fs.mkdir(output, { recursive: true });
  const { startStaticServer } = await import(pathToFileURL(path.join(root, 'src/main/server.js')).href);
  server = await startStaticServer(path.join(root, 'src/renderer'), {
    mounts: {
      '/characters/zenbot/': path.join(root, 'assets/characters/zenbot'),
      '/characters/whale/': path.join(root, 'assets/characters/whale'),
    },
  });
  window = new BrowserWindow({
    show: false,
    width: 960,
    height: 700,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const errors = [];
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      errors.push(event.message);
      console.error(event.message);
    }
  });
  const report = {};
  for (const figure of ['zenbot', 'whale']) {
    const url = new URL(server.url);
    url.search = new URLSearchParams({ figure, zenbotRenderer: 'rig', skin: 'deepseek-maid', preview: '1', acceptance: '1' }).toString();
    await window.loadURL(url.href);
    window.showInactive();
    let first;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await pause(100);
      first = await observe();
      if (first.status === '走路' && first.raster > 1000) break;
    }
    assert.equal(first.status, '走路', `${figure} did not start walking`);
    assert.equal(first.controls.length, 18);
    assert.equal(first.selected, figure);
    await fs.writeFile(path.join(output, `${figure}-walk-first.png`), (await window.webContents.capturePage()).toPNG());
    await pause(800);
    const second = await observe();
    assert.ok(Math.abs(second.x - first.x) > 20, `${figure} must actually move across the stage`);
    await fs.writeFile(path.join(output, `${figure}-walk-second.png`), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.motion-buttons button')).find(button => button.textContent === '跑步').click()`);
    await pause(300);
    const running = await observe();
    assert.equal(running.status, '跑步');
    report[figure] = { first, second, running };
  }
  const face = await window.webContents.executeJavaScript(`(async () => {
    const {createZenbotFaceAnimator} = await import('/figures/zenbot-face.js');
    const load = file => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject;
      image.src = '/characters/zenbot/rig/expressions/' + file + '.png';
    });
    const [base, happy] = await Promise.all([load('neutral'), load('happy')]);
    const animator = createZenbotFaceAnimator(document, happy);
    const blink = animator.render(base, {face:'neutral', blink:1, talk:0, time:0}).toDataURL();
    const talk = animator.render(base, {face:'neutral', blink:0, talk:1, time:1}).toDataURL();
    return {blink, talk};
  })()`);
  for (const [name, data] of Object.entries(face)) {
    await fs.writeFile(path.join(output, `zenbot-${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'motion-report.json'), `${JSON.stringify({ ...report, errors }, null, 2)}\n`);
  console.log(JSON.stringify({ passed: true, characters: Object.keys(report), report: path.join(output, 'motion-report.json') }));
}

run().then(() => app.exit(0)).catch((error) => {
  console.error(error);
  app.exit(1);
});
