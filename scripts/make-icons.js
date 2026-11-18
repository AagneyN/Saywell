// Renders the SVG logo to PNG icons using Electron's offscreen renderer.
// Usage: npm run icons
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const root = process.cwd();
const out = join(root, 'www', 'assets', 'icons');
mkdirSync(out, { recursive: true });
const svg = readFileSync(join(root, 'www', 'assets', 'logo.svg'), 'utf8');
const maskable = readFileSync(join(root, 'www', 'assets', 'logo-maskable.svg'), 'utf8');
const jobs = [
  ...[16, 32, 48, 64, 128, 180, 192, 256, 512, 1024].map((s) => ({ s, name: `icon-${s}.png`, svg })),
  { s: 32, name: 'tray-32.png', svg },
  { s: 512, name: 'maskable-512.png', svg: maskable },
  { s: 192, name: 'maskable-192.png', svg: maskable },
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadURL('about:blank');
  for (const { s, name, svg: src } of jobs) {
    const b64 = Buffer.from(src).toString('base64');
    await w.webContents.executeJavaScript('new Promise(r=>{document.body.style.cssText=""+"margin:0;background:transparent";document.body.innerHTML="";const i=new Image();i.onload=()=>setTimeout(r,120);i.style.cssText="display:block;width:' + s + 'px;height:' + s + 'px";i.src="data:image/svg+xml;base64,' + b64 + '";document.body.appendChild(i);})');
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: s, height: s });
    writeFileSync(join(out, name), img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  }
  w.destroy();
  console.log('icons written:', jobs.map((j) => j.name).join(', '));
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
