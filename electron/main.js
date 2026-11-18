// Saywell desktop shell: secure app:// protocol, global shortcuts, tray, recording overlay,
// native clipboard, OS-protected device unlock, live encrypted disk mirror and rotating
// snapshot backups. All content arriving here is already encrypted by the renderer.

import { app, BrowserWindow, protocol, session, globalShortcut, clipboard, Tray, Menu, ipcMain, safeStorage, nativeImage, dialog, shell, Notification, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname, sep } from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const WWW = resolve(here, '..', 'www');
const ORIGIN = 'app://saywell';
const SELFTEST = process.argv.includes('--selftest');
const START_HIDDEN = process.argv.includes('--hidden');

if (SELFTEST) app.setPath('userData', mkdtempSync(join(os.tmpdir(), 'saywell-selftest-')));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (!SELFTEST && !app.requestSingleInstanceLock()) app.quit();

let win = null, overlay = null, tray = null;
let recent = [];
let recording = false;
let shortcutsSuspended = false;
const paths = {};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https: blob: data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.wav': 'audio/wav' };

// ---------- config ----------
async function readConfig() {
  try { return JSON.parse(await fs.readFile(paths.config, 'utf8')); } catch { return {}; }
}
async function writeConfig(patch) {
  const cfg = { ...(await readConfig()), ...patch };
  await writeAtomic(paths.config, JSON.stringify(cfg, null, 2));
  return cfg;
}

async function writeAtomic(file, data) {
  await fs.mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

// ---------- protocol ----------
function registerProtocol() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'saywell') return new Response('Not found', { status: 404 });
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = resolve(WWW, '.' + p);
    if (file !== WWW && !file.startsWith(WWW + sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, {
        headers: {
          'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- security ----------
function hardenSessions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const fromApp = (details.requestingUrl || wc.getURL()).startsWith(ORIGIN);
    if (permission === 'media') return cb(fromApp && (details.mediaTypes || []).every((t) => t === 'audio'));
    if (permission === 'clipboard-sanitized-write') return cb(fromApp);
    cb(false);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    const fromApp = (origin || '').startsWith(ORIGIN);
    return fromApp && ['media', 'clipboard-sanitized-write'].includes(permission);
  });
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

// ---------- windows ----------
function iconPath(name) { return join(WWW, 'assets', 'icons', name); }

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'Saywell',
    backgroundColor: '#0E1020',
    icon: iconPath('icon-256.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false, // keep recording/processing while hidden in the tray
      spellcheck: true,
      additionalArguments: SELFTEST ? ['--saywell-selftest'] : [],
    },
  });
  win.removeMenu();
  win.loadURL(`${ORIGIN}/index.html${SELFTEST ? '?selftest=1' : ''}`);
  win.once('ready-to-show', () => { if (SELFTEST) win.showInactive(); else if (!START_HIDDEN) win.show(); });
  win.on('close', (e) => {
    if (app.isQuitting || SELFTEST) return;
    e.preventDefault(); // accidental close never quits: keep running in the tray
    win.hide();
    if (!paths.hintShown) {
      paths.hintShown = true;
      notify('Saywell is still running', 'It lives in the system tray. Your shortcut keeps working. Quit from the tray menu.');
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer gone:', details.reason);
    if (details.reason !== 'clean-exit') setTimeout(() => win && !win.isDestroyed() && win.reload(), 600);
  });
  win.on('unresponsive', () => console.warn('Renderer unresponsive'));
}

function createOverlay() {
  overlay = new BrowserWindow({
    width: 320, height: 64, frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true);
  overlay.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  overlay.loadURL(`${ORIGIN}/overlay.html`);
}

let overlayHideTimer = null;
function setOverlay(state) {
  if (!overlay || overlay.isDestroyed()) return;
  clearTimeout(overlayHideTimer);
  if (!state || state.mode === 'hidden' || state.enabled === false) { overlay.hide(); return; }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  overlay.setBounds({ x: Math.round(x + width / 2 - 160), y: Math.round(y + height - 64 - 28), width: 320, height: 64 });
  overlay.webContents.send('overlay:state', state);
  overlay.showInactive();
  if (['copied', 'done', 'error'].includes(state.mode)) overlayHideTimer = setTimeout(() => overlay.hide(), state.mode === 'error' ? 4000 : 2200);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: iconPath('icon-256.png'), silent: true }).show();
}

// ---------- tray ----------
function buildTray() {
  const img = nativeImage.createFromPath(iconPath(process.platform === 'darwin' ? 'tray-template.png' : 'tray-32.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  tray.setToolTip('Saywell — voice dictation');
  tray.on('click', showWindow);
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const send = (data) => win?.webContents.send('tray-action', data);
  const recentItems = recent.length
    ? recent.map((r) => ({ label: r.label.length > 48 ? r.label.slice(0, 47) + '…' : r.label, click: () => send({ action: 'copy', id: r.id }) }))
    : [{ label: 'No dictations yet', enabled: false }];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: recording ? 'Stop dictation' : 'Start dictation', click: () => win?.webContents.send('shortcut', 'toggle') },
    { label: 'Copy last dictation again', click: () => win?.webContents.send('shortcut', 'recopy') },
    { label: 'Recent dictations', submenu: recentItems },
    { type: 'separator' },
    { label: 'Open Saywell', click: showWindow },
    { label: 'Unpasted inbox', click: () => { showWindow(); send({ action: 'navigate', view: 'inbox' }); } },
    { type: 'separator' },
    { label: 'Quit Saywell', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// ---------- shortcuts ----------
let currentShortcuts = {};
function registerShortcuts(map) {
  globalShortcut.unregisterAll();
  currentShortcuts = map;
  const result = {};
  if (shortcutsSuspended) return result;
  for (const [name, accel] of Object.entries(map || {})) {
    if (!accel) { result[name] = { ok: true, accel: '' }; continue; }
    try {
      const ok = globalShortcut.register(accel, () => win?.webContents.send('shortcut', name));
      result[name] = { ok, accel, error: ok ? '' : 'Already in use by another app' };
    } catch (e) {
      result[name] = { ok: false, accel, error: e.message };
    }
  }
  return result;
}

// ---------- mirror & backups ----------
const STORES = new Set(['meta', 'dictations', 'audio']);
function mirrorFile(store, key) {
  if (!STORES.has(store)) throw new Error('bad store');
  return join(paths.mirror, store, encodeURIComponent(key) + '.json');
}
const BACKUP_RE = /^saywell-backup-\d{8}-\d{6}\.swbk$/;
async function backupDir() {
  const cfg = await readConfig();
  const dir = cfg.backupDir && existsSync(cfg.backupDir) ? cfg.backupDir : paths.backups;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
async function listBackups() {
  const dir = await backupDir();
  const names = (await fs.readdir(dir)).filter((n) => BACKUP_RE.test(n));
  const out = [];
  for (const name of names) {
    const st = await fs.stat(join(dir, name));
    out.push({ name, size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

function ipc() {
  ipcMain.handle('app:info', async () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath('userData'), backupDir: await backupDir(), selftest: SELFTEST }));
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(text); return true; });
  ipcMain.handle('shortcuts:get', async () => (await readConfig()).shortcuts || null);
  ipcMain.handle('shortcuts:set', async (_e, map) => {
    const result = registerShortcuts(map);
    await writeConfig({ shortcuts: map });
    return result;
  });
  ipcMain.handle('shortcuts:suspend', (_e, on) => { shortcutsSuspended = on; registerShortcuts(currentShortcuts); return true; });
  ipcMain.on('overlay:set', (_e, state) => setOverlay(state));
  ipcMain.on('recent:set', (_e, items) => { recent = Array.isArray(items) ? items.slice(0, 5).map((i) => ({ id: String(i.id), label: String(i.label || '') })) : []; refreshTray(); });
  ipcMain.on('recording:state', (_e, on) => { recording = on; refreshTray(); });
  ipcMain.handle('notify', (_e, title, body) => { notify(title, body); return true; });
  ipcMain.handle('window:show', () => { showWindow(); return true; });
  ipcMain.handle('autostart:set', (_e, on) => { app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] }); return true; });
  ipcMain.handle('autostart:get', () => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin);

  ipcMain.handle('mirror:put', async (_e, store, key, value) => { await writeAtomic(mirrorFile(store, key), JSON.stringify(value)); return true; });
  ipcMain.handle('mirror:delete', async (_e, store, key) => { await fs.rm(mirrorFile(store, key), { force: true }); return true; });
  ipcMain.handle('mirror:clear', async () => { await fs.rm(paths.mirror, { recursive: true, force: true }); return true; });
  ipcMain.handle('mirror:list', async () => {
    const out = [];
    for (const store of STORES) {
      const dir = join(paths.mirror, store);
      if (!existsSync(dir)) continue;
      for (const f of await fs.readdir(dir)) {
        if (!f.endsWith('.json')) continue;
        try { out.push({ store, key: decodeURIComponent(f.slice(0, -5)), value: JSON.parse(await fs.readFile(join(dir, f), 'utf8')) }); } catch { /* skip partial */ }
      }
    }
    return out;
  });

  ipcMain.handle('backup:write', async (_e, name, text, keep = 30) => {
    if (!BACKUP_RE.test(name)) throw new Error('bad backup name');
    const dir = await backupDir();
    await writeAtomic(join(dir, name), text);
    const all = await listBackups();
    for (const old of all.slice(Math.max(1, keep))) await fs.rm(join(dir, old.name), { force: true });
    return join(dir, name);
  });
  ipcMain.handle('backup:list', listBackups);
  ipcMain.handle('backup:read', async (_e, name) => {
    if (!BACKUP_RE.test(name)) throw new Error('bad backup name');
    return fs.readFile(join(await backupDir(), name), 'utf8');
  });
  ipcMain.handle('backup:get-folder', backupDir);
  ipcMain.handle('backup:choose-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose backup folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    await writeConfig({ backupDir: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('backup:open-folder', async () => shell.openPath(await backupDir()));
  ipcMain.handle('file:save', async (_e, name, text) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('documents'), String(name).replace(/[\\/:*?"<>|]/g, '_')) });
    if (r.canceled || !r.filePath) return null;
    await writeAtomic(r.filePath, text);
    return r.filePath;
  });
  ipcMain.handle('file:open', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Saywell backup', extensions: ['swbk', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return fs.readFile(r.filePaths[0], 'utf8');
  });

  ipcMain.handle('devicekey:available', () => safeStorage.isEncryptionAvailable());
  ipcMain.handle('devicekey:get', async () => {
    try { return safeStorage.decryptString(await fs.readFile(paths.deviceKey)); } catch { return null; }
  });
  ipcMain.handle('devicekey:set', async (_e, b64) => {
    if (!b64) { await fs.rm(paths.deviceKey, { force: true }); return true; }
    if (!safeStorage.isEncryptionAvailable()) return false;
    await writeAtomic(paths.deviceKey, safeStorage.encryptString(b64));
    return true;
  });
  ipcMain.handle('app:erase-local', async () => {
    await fs.rm(paths.mirror, { recursive: true, force: true });
    await fs.rm(paths.deviceKey, { force: true });
    return true;
  });

  if (SELFTEST) {
    ipcMain.handle('selftest:audio', () => {
      const f = process.env.SAYWELL_SELFTEST_WAV;
      return f && existsSync(f) ? readFileSync(f) : null;
    });
    ipcMain.handle('selftest:clipboard', () => clipboard.readText());
    ipcMain.handle('selftest:screenshot', async (_e, name) => {
      const dir = process.env.SAYWELL_SHOTS;
      if (!dir) return null;
      await fs.mkdir(dir, { recursive: true });
      const img = await win.webContents.capturePage();
      const f = join(dir, `${String(name).replace(/[^\w-]/g, '_')}.png`);
      await fs.writeFile(f, img.toPNG());
      return f;
    });
    ipcMain.on('selftest:log', (_e, msg) => console.log('[selftest]', msg));
    ipcMain.handle('selftest:report', async (_e, result) => {
      console.log('SELFTEST_RESULT ' + JSON.stringify(result, null, 2));
      // Prove the mirror holds no plaintext.
      const leak = await scanForPlaintext(paths.mirror, result.plaintextProbe);
      console.log(leak ? `MIRROR PLAINTEXT LEAK in ${leak}` : 'MIRROR_PLAINTEXT_SCAN ok');
      setTimeout(() => app.exit(result.ok && !leak ? 0 : 1), 200);
      return true;
    });
  }
}

async function scanForPlaintext(dir, probe) {
  if (!probe || !existsSync(dir)) return null;
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const f = join(entry.parentPath ?? entry.path, entry.name);
    if ((await fs.readFile(f, 'utf8')).toLowerCase().includes(probe.toLowerCase())) return f;
  }
  return null;
}

// ---------- lifecycle ----------
app.on('second-instance', showWindow);
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (SELFTEST) app.quit(); /* otherwise keep running in tray */ });

app.whenReady().then(async () => {
  const ud = app.getPath('userData');
  Object.assign(paths, { config: join(ud, 'config.json'), mirror: join(ud, 'mirror'), backups: join(ud, 'backups'), deviceKey: join(ud, 'device-key.bin') });
  app.setAppUserModelId?.('app.saywell.desktop');
  registerProtocol();
  hardenSessions();
  ipc();
  createWindow();
  createOverlay();
  if (!SELFTEST) buildTray();
  const cfg = await readConfig();
  registerShortcuts(cfg.shortcuts || { toggle: 'CommandOrControl+Shift+Space', recopy: 'CommandOrControl+Alt+V' });
  app.on('activate', showWindow);
});

