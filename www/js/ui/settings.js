// Settings + Privacy & Security.

import { html, mount, $, $$, icon, toast, confirmDialog, promptDialog, keys } from './dom.js';
import { settings, CLAUDE_MODELS, WHISPER_MODELS } from '../core/settings.js';
import { platform } from '../core/platform.js';
import { vault } from '../core/vault.js';
import { store } from '../core/store.js';
import { testClaude } from '../core/correct.js';
import { preloadLocal, webSpeechSupported } from '../core/stt.js';
import * as db from '../core/db.js';
import { strength } from './auth.js';

const SECTIONS = [['shortcuts', 'Shortcuts'], ['recording', 'Recording'], ['stt', 'Transcription'], ['correction', 'AI correction'], ['clipboard', 'Clipboard'], ['backup', 'Backups'], ['retention', 'Retention'], ['appearance', 'Appearance']];

const sw = (path, label, hint, checked) => html`<label class="switch"><span class="label"><b>${label}</b>${hint ? html`<span class="faint">${hint}</span>` : ''}</span><input type="checkbox" class="toggle" data-path="${path}" ${checked ? 'checked' : ''}></label>`;
const num = (path, label, hint, value, min = 0, max = 100000) => html`<label class="field"><span>${label}</span><input class="input" type="number" min="${min}" max="${max}" data-path="${path}" value="${value}">${hint ? html`<span class="hint">${hint}</span>` : ''}</label>`;
const sel = (path, label, opts, value, hint) => html`<label class="field"><span>${label}</span><select class="input" data-path="${path}">${opts.map(([v, l]) => html`<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`)}</select>${hint ? html`<span class="hint">${hint}</span>` : ''}</label>`;
const txt = (path, label, value, { type = 'text', hint, placeholder = '' } = {}) => html`<label class="field"><span>${label}</span><input class="input" type="${type}" data-path="${path}" value="${value}" placeholder="${placeholder}" autocomplete="off" spellcheck="false">${hint ? html`<span class="hint">${hint}</span>` : ''}</label>`;

export function renderSettings(root, ctx, { section } = {}) {
  const s = settings.get();
  mount(root, html`<div class="page">
    <div class="page-head"><div><h1>Settings</h1><p class="muted">Changes save instantly and are stored encrypted.</p></div></div>
    <div class="settings-grid">
      <nav class="settings-nav">${SECTIONS.map(([k, l]) => html`<button class="nav" data-jump="${k}">${l}</button>`)}</nav>
      <div class="grid">
        <section class="card section" id="s-shortcuts"><h2>Shortcuts</h2>
          ${!platform.hasGlobalShortcuts ? html`<div class="note info">${icon('alert')}<span>${platform.isMobile ? 'On phones, use the big mic button. Global shortcuts are a desktop feature.' : 'In the browser, shortcuts only work while this tab is focused. Install the desktop app for system-wide shortcuts.'}</span></div>` : ''}
          <div class="kv">
            <label class="field"><span>Start / stop dictation</span><input class="input shortcut-input" readonly data-shortcut="toggle" value="${pretty(s.shortcuts.toggle)}"><span class="hint">Click, then press the new key combination. Esc cancels, Backspace clears.</span></label>
            <label class="field"><span>Copy last dictation again</span><input class="input shortcut-input" readonly data-shortcut="recopy" value="${pretty(s.shortcuts.recopy)}"><span class="hint">Forgot to paste? This puts the latest text back on your clipboard.</span></label>
          </div>
          <div class="faint" data-shortcut-status></div>
          ${platform.isDesktop ? html`<label class="switch"><span class="label"><b>Start Saywell when I sign in</b><span class="faint">Starts hidden in the tray so your shortcut is always ready.</span></span><input type="checkbox" class="toggle" data-autostart></label>` : ''}
        </section>

        <section class="card section" id="s-recording"><h2>Recording</h2>
          <div>
            ${sw('recording.enabled', 'Allow recording', 'Master switch. When off, Saywell never opens the microphone.', s.recording.enabled)}
            ${sw('recording.keepAudio', 'Keep original audio', 'Store the encrypted recording with each dictation so you can replay or re-transcribe it. Audio is always kept until processing succeeds.', s.recording.keepAudio)}
            ${sw('recording.overlay', 'Show recording overlay', 'A small always-on-top pill while you dictate (desktop).', s.recording.overlay)}
            ${sw('recording.sounds', 'Sounds', 'Soft chimes for start, stop and copied.', s.recording.sounds)}
          </div>
          <div class="kv">${num('recording.maxMinutes', 'Maximum dictation length (minutes)', 'Recording stops automatically after this.', s.recording.maxMinutes, 1, 120)}</div>
        </section>

        <section class="card section" id="s-stt"><h2>Transcription</h2>
          ${sel('stt.provider', 'Speech-to-text engine', [['local', 'On-device Whisper (private, offline)'], ['openai', 'Cloud: OpenAI-compatible API'], ...(webSpeechSupported() ? [['webspeech', 'Browser speech recognition (Chrome)']] : [])], s.stt.provider,
            s.stt.provider === 'local' ? 'Audio never leaves this device. The model downloads once (~40–250 MB).' : s.stt.provider === 'openai' ? 'Audio is sent to the endpoint below using your key.' : 'Audio is processed by your browser vendor’s speech service.')}
          <div data-stt-local ${s.stt.provider !== 'local' ? 'hidden' : ''} class="kv">
            ${sel('stt.localModel', 'Whisper model', WHISPER_MODELS.map((m) => [m.id, m.label]), s.stt.localModel)}
            <div class="field"><span>&nbsp;</span><button class="btn" data-preload>Download / verify model now</button></div>
          </div>
          <div data-stt-openai ${s.stt.provider !== 'openai' ? 'hidden' : ''} class="grid">
            <div class="kv">${txt('stt.openaiBaseUrl', 'API base URL', s.stt.openaiBaseUrl, { hint: 'OpenAI: https://api.openai.com/v1 · Groq: https://api.groq.com/openai/v1' })}
            ${txt('stt.openaiModel', 'Model', s.stt.openaiModel, { hint: 'e.g. whisper-1, gpt-4o-transcribe, whisper-large-v3' })}</div>
            ${txt('stt.openaiKey', 'API key', s.stt.openaiKey, { type: 'password', placeholder: 'sk-…', hint: 'Stored encrypted in your vault. Never logged.' })}
          </div>
          ${sel('stt.language', 'Language', [['auto', 'Auto-detect'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['ja', 'Japanese'], ['zh', 'Chinese']], s.stt.language, 'English-only Whisper models ignore this.')}
        </section>

        <section class="card section" id="s-correction"><h2>AI correction</h2>
          ${sel('correction.provider', 'Correction engine', [['claude', 'Claude (Anthropic): best meaning and tone preservation'], ['offline', 'Offline rules: private, basic punctuation and cleanup'], ['none', 'Off: keep the raw transcript']], s.correction.provider)}
          <div data-claude ${s.correction.provider !== 'claude' ? 'hidden' : ''} class="grid">
            ${txt('correction.anthropicKey', 'Anthropic API key', s.correction.anthropicKey, { type: 'password', placeholder: 'sk-ant-…', hint: 'Get one at console.anthropic.com. Stored encrypted. Only the transcript text is sent, never audio. If Claude is unreachable, Saywell falls back to offline cleanup automatically.' })}
            <div class="kv">${sel('correction.model', 'Model', CLAUDE_MODELS.map((m) => [m.id, m.label]), s.correction.model)}
            <div class="field"><span>&nbsp;</span><button class="btn" data-testclaude>Test connection</button></div></div>
          </div>
          ${sel('correction.style', 'Editing style', [['standard', 'Standard: fix grammar and punctuation, remove filler words and false starts'], ['light', 'Light touch: punctuation and capitalization only']], s.correction.style)}
          <label class="field"><span>Custom instructions & vocabulary</span><textarea class="input" rows="4" data-path="correction.customInstructions" placeholder="e.g. My name is spelled 'Aleksandra'. Product names: Kubernetes, PostgreSQL. Use British spelling.">${s.correction.customInstructions}</textarea><span class="hint">Names, jargon and spelling preferences. These never override "preserve my meaning and tone".</span></label>
        </section>

        <section class="card section" id="s-clipboard"><h2>Clipboard</h2>
          <div>${sw('clipboard.autoCopy', 'Copy finished text automatically', 'The corrected text goes to your clipboard as soon as it is ready.', s.clipboard.autoCopy)}</div>
        </section>

        <section class="card section" id="s-backup"><h2>Backups</h2>
          <div>${sw('backup.enabled', 'Automatic encrypted snapshots', 'In addition to the instant disk mirror on desktop.', s.backup.enabled)}
          ${sw('backup.includeAudio', 'Include audio in snapshots', 'Larger files, but recordings can be restored too.', s.backup.includeAudio)}</div>
          <div class="kv">${num('backup.intervalHours', 'Snapshot every (hours)', '', s.backup.intervalHours, 1, 168)}${num('backup.keep', 'Keep the newest', 'Older snapshots are pruned automatically.', s.backup.keep, 1, 500)}</div>
          <div><button class="btn sm" data-gobackups>Manage backups →</button></div>
        </section>

        <section class="card section" id="s-retention"><h2>Retention</h2>
          <p class="muted">By default Saywell keeps everything forever. Set a number of days to clean up automatically (0 = keep forever). Pinned dictations are never removed.</p>
          <div class="kv">
            ${num('recording.audioRetentionDays', 'Delete audio after (days)', 'Text is kept, only the recording is removed.', s.recording.audioRetentionDays)}
            ${num('history.retentionDays', 'Move dictations to Trash after (days)', '', s.history.retentionDays)}
            ${num('history.trashRetentionDays', 'Empty Trash after (days)', '', s.history.trashRetentionDays)}
          </div>
        </section>

        <section class="card section" id="s-appearance"><h2>Appearance</h2>
          <div class="kv"><label class="field"><span>Theme</span><select class="input" data-theme><option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div>
        </section>
      </div>
    </div>
  </div>`);

  const get = (path) => path.split('.').reduce((o, k) => o[k], settings.get());
  const save = async (path, value) => {
    const [a, b] = path.split('.');
    await settings.save({ [a]: { [b]: value } });
  };
  $$('[data-path]', root).forEach((el) => {
    el.addEventListener('change', async () => {
      const path = el.dataset.path;
      let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(+el.min || 0, Math.min(+el.max || 1e9, Number(el.value) || 0)) : el.value.trim();
      await save(path, v);
      if (path === 'stt.provider') { $('[data-stt-local]', root).hidden = v !== 'local'; $('[data-stt-openai]', root).hidden = v !== 'openai'; }
      if (path === 'correction.provider') $('[data-claude]', root).hidden = v !== 'claude';
      toast('Saved', { timeout: 1200 });
    });
  });
  $$('[data-jump]', root).forEach((b) => (b.onclick = () => $(`#s-${b.dataset.jump}`, root).scrollIntoView({ behavior: 'smooth', block: 'start' })));
  $('[data-gobackups]', root).onclick = () => ctx.navigate('backups');

  const theme = $('[data-theme]', root);
  theme.value = localStorageGet('saywell-theme') || 'system';
  theme.onchange = () => { localStorageSet('saywell-theme', theme.value); applyTheme(); };

  $('[data-preload]', root).onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Downloading…';
    try { await preloadLocal(get('stt.localModel')); toast('Speech model ready. Transcription works offline now.', { type: 'ok' }); }
    catch (err) { toast(`Model download failed: ${err.message}`, { type: 'error' }); }
    e.target.disabled = false; e.target.textContent = 'Download / verify model now';
  };
  $('[data-testclaude]', root).onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Testing…';
    try { const r = await testClaude(settings.get().correction); toast(`Claude works (${r.model}, ${(r.ms / 1000).toFixed(1)} s): "${r.text}"`, { type: 'ok', timeout: 8000 }); }
    catch (err) { toast(err.message, { type: 'error', timeout: 8000 }); }
    e.target.disabled = false; e.target.textContent = 'Test connection';
  };

  // Shortcut capture
  const statusEl = $('[data-shortcut-status]', root);
  $$('[data-shortcut]', root).forEach((input) => {
    input.addEventListener('click', () => startCapture(input));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') startCapture(input); });
  });
  function startCapture(input) {
    input.classList.add('capturing');
    input.value = 'Press keys…';
    platform.native?.suspendShortcuts(true);
    const onKey = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return finish(get(`shortcuts.${input.dataset.shortcut}`));
      if (e.key === 'Backspace' || e.key === 'Delete') return finish('');
      const accel = toAccelerator(e);
      if (accel) finish(accel);
    };
    const finish = async (accel) => {
      window.removeEventListener('keydown', onKey, true);
      input.classList.remove('capturing');
      input.value = pretty(accel);
      await platform.native?.suspendShortcuts(false);
      await save(`shortcuts.${input.dataset.shortcut}`, accel);
      const res = await ctx.applyShortcuts();
      const r = res?.[input.dataset.shortcut];
      statusEl.innerHTML = String(r && !r.ok ? html`<span style="color:var(--del-fg)">${accel} could not be registered: ${r.error}. Try another combination.</span>` : html`Saved: ${keys(accel)}`);
    };
    window.addEventListener('keydown', onKey, true);
  }

  if (platform.isDesktop) {
    const auto = $('[data-autostart]', root);
    platform.native.getAutostart().then((v) => { auto.checked = !!v; });
    auto.onchange = () => platform.native.setAutostart(auto.checked);
  }
  if (section) setTimeout(() => $(`#s-${section}`, root)?.scrollIntoView({ block: 'start' }), 30);
  return () => {};
}

export function pretty(accel) {
  if (!accel) return '';
  const mac = /Mac/.test(navigator.platform);
  return accel.replace('CommandOrControl', mac ? 'Cmd' : 'Ctrl').replace('Alt', mac ? 'Option' : 'Alt');
}

/** Convert a keydown event to an Electron accelerator string. Requires a modifier (except F-keys). */
export function toAccelerator(e) {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(k)) return '';
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  let key;
  if (e.code === 'Space') key = 'Space';
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(k)) key = k;
  else key = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Backquote: '`' }[k] || (e.code === 'Backquote' ? '`' : k.length === 1 ? k.toUpperCase() : '');
  if (!key) return '';
  if (!mods.length && !/^F\d+$/.test(key)) return '';
  return [...mods, key].join('+');
}

/** Does a keydown match an accelerator? (in-page shortcuts for web/mobile keyboards) */
export function matchesAccelerator(e, accel) {
  return !!accel && toAccelerator(e) === accel;
}

export function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
export function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
export function applyTheme() {
  const t = localStorageGet('saywell-theme') || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------- Privacy & Security ----------
export function renderPrivacy(root, ctx) {
  const s = settings.get();
  mount(root, html`<div class="page">
    <div class="page-head"><div><h1>Privacy & security</h1><p class="muted">What Saywell stores, where, and how it's protected. You're in control.</p></div><span class="spacer"></span><button class="btn" data-lock>${icon('lock')} Lock now</button></div>
    <div class="grid cols-2">
      <section class="card grid"><h2>How your data is protected</h2>
        <div class="health">
          <div><span class="dot ok"></span>Encryption at rest<span class="v">AES-256-GCM, unique IV per write</span></div>
          <div><span class="dot ok"></span>Key protection<span class="v">PBKDF2-SHA-256 · 600,000 rounds</span></div>
          <div><span class="dot ok"></span>Recovery<span class="v">one-time recovery code</span></div>
          <div><span class="dot ${s.stt.provider === 'local' ? 'ok' : 'warn'}"></span>Audio leaves device<span class="v">${s.stt.provider === 'local' ? 'never (on-device Whisper)' : s.stt.provider === 'openai' ? `yes, to ${safeHost(s.stt.openaiBaseUrl)}` : 'yes, browser speech service'}</span></div>
          <div><span class="dot ${s.correction.provider === 'claude' ? 'warn' : 'ok'}"></span>Text leaves device<span class="v">${s.correction.provider === 'claude' ? 'transcript only, to Anthropic for correction' : 'never'}</span></div>
          <div><span class="dot ok"></span>Telemetry & analytics<span class="v">none</span></div>
        </div>
        <p class="faint">Saywell has no server and no account. Cloud providers only receive what's needed for the step you enabled, using your own API keys. Keys are stored inside the encrypted vault.</p>
      </section>
      <section class="card grid"><h2>Access</h2>
        <div class="kv">${num('security.autoLockMinutes', 'Auto-lock after idle (minutes)', '0 = never. Locking clears keys and decrypted text from memory.', s.security.autoLockMinutes, 0, 1440)}</div>
        ${platform.isDesktop ? html`<div>${sw('security.deviceUnlock', 'Unlock automatically on this computer', 'Uses Windows DPAPI / macOS Keychain via Electron safeStorage. Turn off to require your passphrase every launch.', s.security.deviceUnlock)}</div>` : ''}
        <div class="row"><button class="btn" data-chpass>Change passphrase</button><button class="btn" data-newcode>New recovery code</button></div>
      </section>
    </div>
    <section class="card grid"><h2>Where things are stored</h2>
      <div class="health">
        <div><span class="dot ok"></span>App database<span class="v">IndexedDB in this ${platform.isDesktop ? 'app' : platform.isMobile ? 'app' : 'browser profile'} (encrypted)</span></div>
        ${platform.isDesktop ? html`<div><span class="dot ok"></span>Live mirror<span class="v" data-ud>…</span></div>` : ''}
        <div><span class="dot ok"></span>Snapshots<span class="v">see Backups</span></div>
        <div><span class="dot ok"></span>Dictations stored<span class="v">${store.live().length} active · ${store.trash().length} in trash</span></div>
      </div>
    </section>
    <section class="card grid" style="border-color:color-mix(in srgb, var(--del-fg) 30%, var(--border))"><h2>Erase everything</h2>
      <p class="muted">Permanently deletes every dictation, recording, setting and key from this device, including the live mirror. Backup files you saved elsewhere are not touched.</p>
      <div><button class="btn danger solid" data-erase>Erase all data on this device</button></div>
    </section>
  </div>`);

  platform.native?.info().then((i) => { const el = $('[data-ud]', root); if (el) el.textContent = `${i.userData}\\mirror (encrypted)`; });
  $$('[data-path]', root).forEach((el) => el.addEventListener('change', async () => {
    const [a, b] = el.dataset.path.split('.');
    const v = el.type === 'checkbox' ? el.checked : Math.max(0, Number(el.value) || 0);
    await settings.save({ [a]: { [b]: v } });
    if (el.dataset.path === 'security.deviceUnlock') await vault.setDeviceUnlock(v);
    ctx.resetIdle();
    toast('Saved', { timeout: 1200 });
  }));
  $('[data-lock]', root).onclick = () => ctx.lock();
  $('[data-chpass]', root).onclick = async () => {
    const cur = await promptDialog({ title: 'Change passphrase', label: 'Current passphrase', type: 'password', confirm: 'Next' });
    if (!cur) return;
    if (!(await vault.verifyPassphrase(cur))) return toast('Incorrect passphrase.', { type: 'error' });
    const next = await promptDialog({ title: 'New passphrase', message: 'At least 8 characters. This also issues a new recovery code.', label: 'New passphrase', type: 'password', confirm: 'Next' });
    if (!next) return;
    if (next.length < 8) return toast('Use at least 8 characters.', { type: 'error' });
    if (strength(next) < 2 && !(await confirmDialog({ title: 'Weak passphrase', message: 'This passphrase is easy to guess. Use it anyway?', confirm: 'Use it' }))) return;
    const again = await promptDialog({ title: 'Confirm new passphrase', label: 'New passphrase again', type: 'password', confirm: 'Change' });
    if (again !== next) return toast('The passphrases do not match.', { type: 'error' });
    const code = await vault.changePassphrase(next);
    if (settings.get().security.deviceUnlock) await vault.setDeviceUnlock(true);
    ctx.showRecoveryCode(code, 'Passphrase changed: save your new recovery code');
  };
  $('[data-newcode]', root).onclick = async () => {
    const cur = await promptDialog({ title: 'New recovery code', message: 'Your old recovery code will stop working (it still opens older backup files).', label: 'Current passphrase', type: 'password', confirm: 'Generate' });
    if (!cur) return;
    try { ctx.showRecoveryCode(await vault.regenerateRecovery(cur), 'Your new recovery code'); } catch (e) { toast(e.message, { type: 'error' }); }
  };
  $('[data-erase]', root).onclick = async () => {
    const ok = await confirmDialog({ title: 'Erase everything?', message: `This permanently deletes ${store.all().length} dictations, all audio, settings and keys from this device. This cannot be undone.`, confirm: 'Erase everything', danger: true, typeToConfirm: 'ERASE' });
    if (!ok) return;
    await db.clearAll();
    await platform.native?.eraseAll();
    vault.lock();
    location.reload();
  };
  return () => {};
}

function safeHost(u) { try { return new URL(u).host; } catch { return 'custom endpoint'; } }
