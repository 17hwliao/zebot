const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const label = process.argv[2] || 'after';
const output = path.join(root, 'docs/zenbot/rig/evidence/gait');

async function run() {
  await app.whenReady();
  await fs.mkdir(output, { recursive: true });
  const { startStaticServer } = await import(pathToFileURL(path.join(root, 'src/main/server.js')).href);
  const server = await startStaticServer(path.join(root, 'src/renderer'), {
    mounts: { '/characters/zenbot/': path.join(root, 'assets/characters/zenbot') },
  });
  const window = new BrowserWindow({ show: false, width: 1600, height: 720,
    webPreferences: { backgroundThrottling: false } });
  await window.loadURL(`${server.url}/characters/zenbot/rig/manifest.json`);
  const report = await window.webContents.executeJavaScript(`(async () => {
    const { createZenbotRigFigure } = await import('/figures/zenbot-rig.js');
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#16202a;color:#fff;font:15px sans-serif;display:grid;grid-template-columns:repeat(8,200px)';
    const errors = [];
    for (const mode of ['walk', 'run']) {
      const figure = await createZenbotRigFigure({ raster:true, pixelRatio:2,
        useMotionLibrary: ${label === 'fallback' ? 'false' : 'true'}, onError:error=>errors.push(error.message) });
      for (let index=0; index<8; index+=1) {
        const phase=index/8;
        const cell=document.createElement('div');
        cell.innerHTML='<div style="height:25px">'+mode+' phase '+phase.toFixed(3)+'</div><svg width="200" height="325" viewBox="-28 -72 312 370"><line x1="-28" x2="284" y1="256" y2="256" stroke="#62cc92"/><g></g></svg>';
        document.body.append(cell);
        const group=cell.querySelector('g');
        const radians=phase*Math.PI*2;
        const legs=[0,1].map(side=> {
          const hip=side?150:104;
          const angle=radians+side*Math.PI;
          return [hip,212+(mode==='run'?7:3)*Math.abs(Math.sin(radians)),
            hip+(mode==='run'?17:10)*Math.sin(angle),241-(mode==='run'?15:8)*Math.max(0,Math.cos(angle))];
        });
        figure.draw(group,'neutral',{mode,modeT:1+phase,t:1+phase,gaitPhase:phase,
          facing:1,low:(mode==='run'?7:3)*Math.abs(Math.sin(radians)),legs,blink:0,eyeClose:0});
        const raster=group.querySelector('image');
        const copy=raster.cloneNode(true);
        group.replaceChildren(copy);
      }
      figure.dispose();
    }
    await Promise.all(Array.from(document.images).map(image=>image.decode().catch(()=>{})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return { errors, phases:8, modes:['walk','run'], fallback:${label === 'fallback'} };
  })()`);
  window.showInactive();
  await new Promise(resolve => setTimeout(resolve, 300));
  await fs.writeFile(path.join(output, `${label}-cycle.png`), (await window.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(output, `${label}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  window.destroy();
  await server.close();
}
run().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
