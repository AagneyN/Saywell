// Saywell app controller: boot, lock/unlock lifecycle, shell & routing, shortcuts, tray.

import { openDB } from './core/db.js';
import { vault } from './core/vault.js';
import { settings } from './core/settings.js';
import { store } from './core/store.js';
import { pipeline } from './core/pipeline.js';
import { platform } from './core/platform.js';
import { startScheduler, stopScheduler } from './core/backup.js';
import { html, mount, $, $$, icon, toast, announce, fmtAgo } from './ui/dom.js';
import { renderSetup, renderLock, showRecovery } from './ui/auth.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderHistory, renderInbox, renderTrash } from './ui/history.js';
import { renderBackups } from './ui/backups.js';
import { renderSettings, renderPrivacy, matchesAccelerator, applyTheme } from './ui/settings.js';

const root = document.getElementById('app');
const VIEWS = {
  home: { label: 'Dictate', icon: 'home', render: renderDashboard },
  history: { label: 'History', icon: 'history', render: renderHistory },
  inbox: { label: 'Unpasted', icon: 'inbox', render: renderInbox },
  trash: { label: 'Trash', icon: 'trash', render: renderTrash, secondary: true },
  backups: { label: 'Backups', icon: 'backup', render: renderBackups },
  settings: { label: 'Settings', icon: 'settings', render: renderSettings },
  privacy: { label: 'Privacy', icon: 'shield', render: renderPrivacy, secondary: true },
};

let currentView = 'home';
let cleanup = null;
let idleTimer = 0;
let unsubs = [];

const ctx = {
  navigate,
  settings: () => settings.get(),
  toggleRecording,
  copyDictation,
  applyShortcuts,
  health,
  lock: () => vault.lock(),
  resetIdle,
  showRecoveryCode: (code, title) => showRecovery(root, code, { title, onDone: () => renderShell() }),
};

// ---------------- boot ----------------
applyTheme();
boot().catch((e) => {
  console.error(e);
  mount(root, html`<div class="auth"><div class="auth-card"><h1>Saywell couldn't start</h1><p class="muted">${e.message}</p><button class="btn primary" data-reload>Reload</button></div></div>`);
  document.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
});

async function boot() {
  await openDB();
  wireGlobal();
  if (new URLSearchParams(location.search).has('selftest') && platform.native?.selftest) {
    const { runSelfTest } = await import('./selftest.js');
    return runSelfTest({ enter, ctx });
  }
  if (!(await vault.isSetUp())) return renderSetup(root, { onDone: ({ deviceUnlock }) => enter({ firstRun: true, deviceUnlock }) });
  if (await vault.unlockWithDevice()) return enter({});
  showLock();
}

function showLock(reason) {
  renderLock(root, { reason, onUnlocked: ({ viaRecovery }) => enter({ viaRecovery }) });
}

/** Called once the vault is unlocked. */
async function enter({ firstRun, deviceUnlock, viaRecovery } = {}) {
  await settings.load();
  if (firstRun && platform.isDesktop) {
    await settings.save({ security: { deviceUnlock: !!deviceUnlock } });
  }
  if (platform.isDesktop && settings.get().security.deviceUnlock) await vault.setDeviceUnlock(true).catch(() => {});
  await store.load();
  if (store.corrupt.length) toast(`${store.corrupt.length} records could not be decrypted. They are kept untouched; restore from a backup if needed.`, { type: 'error', timeout: 0 });
  navigator.storage?.persist?.().catch(() => {});
  await applyShortcuts();
  pushRecent();
  unsubs.push(store.on('change', () => { pushRecent(); updateBadges(); }));
  startScheduler((r) => { if (r?.error) toast(`Automatic backup failed: ${r.error}`, { type: 'error' }); });
  resetIdle();
  renderShell();
  const recovered = await pipeline.recover();
  if (recovered.length) toast(`Recovered ${recovered.length} unfinished dictation${recovered.length > 1 ? 's' : ''} from last session. Finishing them now.`, { timeout: 8000 });
  if (viaRecovery) toast('Unlocked with your recovery code. Consider setting a new passphrase in Privacy & security.', { timeout: 10000, action: { label: 'Open', run: () => navigate('privacy') } });
  if (firstRun) setTimeout(() => toast(platform.hasGlobalShortcuts ? 'You’re set. Press Ctrl+Shift+Space anywhere to dictate.' : 'You’re set. Press the mic button to dictate.', { timeout: 8000 }), 400);
}

vault.on('lock', () => {
  if (pipeline.current) pipeline.stop().catch(() => {});
  unsubs.forEach((f) => f()); unsubs = [];
  cleanup?.(); cleanup = null;
  stopScheduler();
  store.clear();
  settings.reset();
  platform.setRecent([]);
  showLock('Saywell locked. Your dictations stay encrypted until you unlock.');
});

// ---------------- shell ----------------
function renderShell() {
  mount(root, html`<div class="shell">
    <nav class="sidebar" aria-label="Main">
      <div class="brand"><img src="assets/logo.svg" alt=""><div><div class="name">Saywell</div><div class="tag">Say it. Paste it. Never lose it.</div></div></div>
      ${Object.entries(VIEWS).map(([k, v]) => html`<button class="nav ${v.secondary ? 'secondary' : ''}" data-view="${k}">${icon(v.icon)}<span>${v.label}</span><span data-badge="${k}"></span></button>`)}
      <div class="foot"><div class="health-mini" data-mini></div><button class="nav" data-lock>${icon('lock')}<span>Lock</span></button></div>
    </nav>
    <main id="main"></main>
  </div>`);
  $$('[data-view]', root).forEach((b) => (b.onclick = () => navigate(b.dataset.view)));
  $('[data-lock]', root).onclick = () => vault.lock();
  navigate(currentView);
  updateBadges();
}

function navigate(view, opts = {}) {
  if (!VIEWS[view]) view = 'home';
  const main = document.getElementById('main');
  if (!main) return;
  currentView = view;
  cleanup?.();
  $$('[data-view]', root).forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  main.scrollTop = 0;
  cleanup = VIEWS[view].render(main, ctx, opts) || null;
  updateMini();
}

function updateBadges() {
  const u = store.unpasted().length + store.needsAttention().length;
  const el = $('[data-badge="inbox"]', root);
  if (el) el.innerHTML = u ? `<span class="badge">${u}</span>` : '';
  const t = store.trash().length;
  const te = $('[data-badge="trash"]', root);
  if (te) te.innerHTML = t ? `<span class="badge soft">${t}</span>` : '';
  updateMini();
}

function updateMini() {
  const el = $('[data-mini]', root);
  if (!el) return;
  const s = settings.get();
  const b = s.backup.lastAt;
  el.innerHTML = String(html`
    <div><span class="dot ok"></span>Encrypted vault</div>
    <div><span class="dot ${s.correction.provider === 'claude' && !s.correction.anthropicKey ? 'warn' : 'ok'}"></span>${s.correction.provider === 'claude' ? (s.correction.anthropicKey ? 'Claude correction' : 'Claude key missing') : s.correction.provider === 'offline' ? 'Offline correction' : 'Correction off'}</div>
    <div><span class="dot ${b && Date.now() - b < s.backup.intervalHours * 2 * 3_600_000 ? 'ok' : 'warn'}"></span>Backup ${fmtAgo(b)}</div>`);
}

// ---------------- actions ----------------
async function toggleRecording() {
  try {
    await pipeline.toggle();
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

async function copyDictation(id, which = 'corrected', { markUsed = true } = {}) {
  const r = store.get(id);
  if (!r) return;
  const text = which === 'original' ? r.rawText : r.correctedText || r.rawText;
  if (!text) return toast('Nothing to copy yet.');
  const ok = await platform.copy(text);
  if (!ok) return toast('Could not access the clipboard. Click the text and copy manually.', { type: 'error' });
  await store.update(id, { copiedAt: Date.now(), ...(markUsed && !r.usedAt ? { usedAt: Date.now() } : {}) });
  toast(which === 'original' ? 'Original transcript copied.' : 'Copied. Paste it anywhere.', { type: 'ok', timeout: 2000 });
}

async function recopyLast() {
  const r = store.live().find((x) => x.status === 'done' && (x.correctedText || x.rawText));
  if (!r) return platform.overlay({ mode: 'error', text: 'No dictation to copy yet' });
  await platform.copy(r.correctedText || r.rawText);
  await store.update(r.id, { copiedAt: Date.now() });
  platform.overlay({ mode: 'copied', text: 'Last dictation copied again' });
}

async function applyShortcuts() {
  if (!platform.native) return null;
  const s = settings.get().shortcuts;
  const res = await platform.native.registerShortcuts({ toggle: s.toggle, recopy: s.recopy });
  const bad = Object.entries(res || {}).filter(([, r]) => !r.ok);
  if (bad.length) toast(`Shortcut ${bad.map(([, r]) => r.accel).join(', ')} is in use by another app. Pick another in Settings.`, { type: 'error', timeout: 9000 });
  return res;
}

function pushRecent() {
  platform.setRecent(store.live().filter((r) => r.status === 'done' && (r.correctedText || r.rawText)).slice(0, 5).map((r) => ({ id: r.id, label: r.title || (r.correctedText || r.rawText).slice(0, 48) })));
}

async function health() {
  const s = settings.get();
  let mic = { state: 'warn', value: 'not checked' };
  try {
    const p = await navigator.permissions?.query({ name: 'microphone' });
    mic = p?.state === 'granted' ? { state: 'ok', value: 'allowed' } : p?.state === 'denied' ? { state: 'bad', value: 'blocked' } : { state: 'warn', value: 'will ask on first use' };
  } catch { /* unsupported */ }
  if (!s.recording.enabled) mic = { state: 'warn', value: 'recording turned off' };
  const persisted = platform.isDesktop || platform.isMobile || (await navigator.storage?.persisted?.().catch(() => false));
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const b = s.backup.lastAt;
  return [
    { label: 'Microphone', ...mic },
    { label: 'Speech engine', state: s.stt.provider === 'openai' && !s.stt.openaiKey ? 'bad' : 'ok', value: s.stt.provider === 'local' ? 'On-device Whisper' : s.stt.provider === 'openai' ? (s.stt.openaiKey ? 'Cloud API' : 'Cloud API, key missing') : 'Browser speech' },
    { label: 'AI correction', state: s.correction.provider === 'claude' && !s.correction.anthropicKey ? 'warn' : 'ok', value: s.correction.provider === 'claude' ? (s.correction.anthropicKey ? s.correction.model : 'add API key (offline fallback active)') : s.correction.provider === 'offline' ? 'Offline rules' : 'Off' },
    { label: 'Last backup', state: b && Date.now() - b < s.backup.intervalHours * 2 * 3_600_000 ? 'ok' : 'warn', value: fmtAgo(b) },
    { label: 'Storage', state: persisted ? 'ok' : 'warn', value: `${persisted ? 'persistent' : 'best-effort'}${est ? ` · ${(est.usage / 1048576).toFixed(1)} MB` : ''}` },
    { label: 'Encryption', state: 'ok', value: 'AES-256-GCM' },
  ];
}

// ---------------- idle auto-lock ----------------
function resetIdle() {
  clearTimeout(idleTimer);
  const mins = settings.get().security?.autoLockMinutes || 0;
  if (!mins || !vault.unlocked) return;
  idleTimer = setTimeout(() => {
    if (pipeline.state.phase === 'recording' || pipeline.processing.size) return resetIdle();
    vault.lock();
  }, mins * 60_000);
}

// ---------------- global wiring ----------------
function wireGlobal() {
  ['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, () => resetIdle(), { passive: true }));

  // In-page shortcut (web / mobile with keyboard). Desktop uses true global shortcuts.
  window.addEventListener('keydown', (e) => {
    if (platform.native || !vault.unlocked) return;
    const s = settings.get().shortcuts;
    if (matchesAccelerator(e, s.toggle)) { e.preventDefault(); toggleRecording(); }
    else if (matchesAccelerator(e, s.recopy)) { e.preventDefault(); recopyLast(); }
  });

  platform.native?.onShortcut(async (name) => {
    if (!vault.unlocked) {
      await platform.native.showWindow();
      platform.overlay({ mode: 'error', text: 'Unlock Saywell first' });
      return;
    }
    resetIdle();
    if (name === 'toggle') toggleRecording();
    if (name === 'recopy') recopyLast();
  });
  platform.native?.onTrayAction(async ({ action, id, view }) => {
    if (!vault.unlocked) return platform.native.showWindow();
    if (action === 'copy' && id) {
      const r = store.get(id);
      if (r) { await platform.copy(r.correctedText || r.rawText); await store.update(id, { copiedAt: Date.now() }); platform.overlay({ mode: 'copied', text: 'Copied from history' }); }
    }
    if (action === 'navigate') navigate(view);
  });

  pipeline.on('state', (st) => {
    platform.native?.setRecordingState(st.phase === 'recording');
    if (st.phase === 'recording') announce('Recording started');
    if (!settings.get().recording.overlay) platform.overlay({ mode: 'hidden' });
  });
  pipeline.on('done', ({ id, copied, empty, autoCopy }) => {
    const r = store.get(id);
    if (empty) { toast('Nothing was heard in that recording. The audio is kept in History.'); return; }
    announce(copied ? 'Dictation copied to clipboard' : 'Dictation saved');
    if (r?.correction?.note) toast(r.correction.note, { timeout: 7000 });
    if (!copied && autoCopy && settings.get().clipboard.autoCopy) toast('Done, but the clipboard was not available. Find it in Unpasted.', { action: { label: 'Copy now', run: () => copyDictation(id) } });
    if (document.hidden) platform.notify('Saywell', copied ? 'Copied. Paste it anywhere.' : 'Dictation saved to history.');
  });
  pipeline.on('failed', ({ message }) => toast(`${message}. Your audio is safe. Retry from History.`, { type: 'error', timeout: 9000 }));
  pipeline.on('error', ({ message }) => toast(message, { type: 'error' }));

  window.addEventListener('beforeunload', (e) => {
    if (pipeline.state.phase === 'recording') { e.preventDefault(); e.returnValue = ''; }
  });

  if ('serviceWorker' in navigator && platform.kind === 'web' && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
