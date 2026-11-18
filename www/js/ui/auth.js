// First-run setup, lock screen, recovery and restore-into-fresh-profile.

import { html, mount, $, toast } from './dom.js';
import { vault } from '../core/vault.js';
import { platform } from '../core/platform.js';
import { parseSnapshot, restoreSnapshot, mirrorSnapshot } from '../core/backup.js';

const brand = html`<div class="brand"><img src="assets/logo.svg" alt=""><div><div class="name">Saywell</div><div class="tag">Say it. Paste it. Never lose it.</div></div></div>`;

export function strength(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) || /[^\w\s]/.test(p)) s++;
  if (p.length >= 16) s++;
  return Math.min(4, s);
}

export async function renderSetup(root, { onDone }) {
  const mirror = platform.isDesktop ? await mirrorSnapshot().catch(() => null) : null;
  mount(root, html`<div class="auth"><form class="auth-card" data-form>
    ${brand}
    <div><h1>Create your private vault</h1>
    <p class="muted" style="margin-top:6px">Everything you dictate is encrypted on this device with AES-256 before it is saved. Choose a passphrase you will remember. Saywell can't reset it for you, but you'll also get a recovery code.</p></div>
    ${mirror ? html`<div class="note info">Saywell found an automatic backup of a previous vault on this computer (${mirror.dictations.length} dictations). <button type="button" class="linkbtn" data-mirror>Restore it</button></div>` : ''}
    <label class="field"><span>Passphrase</span><input class="input" type="password" name="p1" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label>
    <div class="faint" data-strength>&nbsp;</div>
    <label class="field"><span>Confirm passphrase</span><input class="input" type="password" name="p2" autocomplete="new-password" required></label>
    ${platform.isDesktop ? html`<label class="switch" style="border:0;padding:0"><span class="label"><b>Unlock automatically on this computer</b><span class="faint">The key is protected by your OS account (Windows DPAPI / macOS Keychain) so the shortcut works right after login.</span></span><input type="checkbox" class="toggle" name="device" checked></label>` : ''}
    <div class="error-text" data-err></div>
    <button class="btn primary" type="submit">Create vault</button>
    <div class="row"><span class="faint">Moving from another device?</span><button type="button" class="linkbtn" data-restore>Restore from a backup file</button></div>
  </form></div>`);

  const form = $('[data-form]', root);
  const err = $('[data-err]', root);
  form.p1.addEventListener('input', () => {
    const s = strength(form.p1.value);
    $('[data-strength]', root).textContent = form.p1.value ? `Strength: ${['very weak', 'weak', 'fair', 'good', 'strong'][s]}` : ' ';
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (form.p1.value.length < 8) return (err.textContent = 'Use at least 8 characters.');
    if (form.p1.value !== form.p2.value) return (err.textContent = 'The passphrases do not match.');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const code = await vault.setup(form.p1.value);
      showRecovery(root, code, { onDone: () => onDone({ deviceUnlock: !!form.device?.checked }) });
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Create vault'; }
  };
  $('[data-restore]', root).onclick = () => restoreFlow(root, null, onDone);
  $('[data-mirror]', root)?.addEventListener('click', () => restoreFlow(root, mirror, onDone));
}

export function showRecovery(root, code, { onDone, title = 'Save your recovery code' }) {
  mount(root, html`<div class="auth"><div class="auth-card">
    ${brand}
    <div><h1>${title}</h1><p class="muted" style="margin-top:6px">If you ever forget your passphrase, this code is the <b>only</b> other way to unlock your dictations and backups. Store it somewhere safe, like a password manager or on paper. It will not be shown again.</p></div>
    <div class="recovery" data-code>${code}</div>
    <div class="row"><button class="btn" data-copy>Copy code</button><button class="btn" data-save>Save as file</button></div>
    <label class="row"><input type="checkbox" data-ack> <span>I have stored my recovery code safely</span></label>
    <button class="btn primary" data-go disabled>Continue</button>
  </div></div>`);
  $('[data-copy]', root).onclick = async () => { await platform.copy(code); toast('Recovery code copied. Paste it into your password manager, then clear your clipboard.'); };
  $('[data-save]', root).onclick = () => platform.saveFile('saywell-recovery-code.txt', `Saywell recovery code\n\n${code}\n\nCreated ${new Date().toLocaleString()}\nKeep this private.`, 'text/plain');
  $('[data-ack]', root).onchange = (e) => { $('[data-go]', root).disabled = !e.target.checked; };
  $('[data-go]', root).onclick = () => onDone();
}

export function renderLock(root, { onUnlocked, reason = '' }) {
  mount(root, html`<div class="auth"><form class="auth-card" data-form>
    ${brand}
    <div><h1>Welcome back</h1><p class="muted" style="margin-top:6px">${reason || 'Your dictations are encrypted. Enter your passphrase to unlock.'}</p></div>
    <label class="field"><span data-label>Passphrase</span><input class="input" type="password" name="secret" autocomplete="current-password" required autofocus></label>
    <div class="error-text" data-err></div>
    <button class="btn primary" type="submit">Unlock</button>
    <div class="row"><button type="button" class="linkbtn" data-mode>Forgot passphrase? Use recovery code</button></div>
  </form></div>`);
  const form = $('[data-form]', root);
  let recovery = false;
  $('[data-mode]', root).onclick = () => {
    recovery = !recovery;
    $('[data-label]', root).textContent = recovery ? 'Recovery code' : 'Passphrase';
    form.secret.type = recovery ? 'text' : 'password';
    form.secret.placeholder = recovery ? 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX' : '';
    $('[data-mode]', root).textContent = recovery ? 'Use passphrase instead' : 'Forgot passphrase? Use recovery code';
    form.secret.focus();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Unlocking…';
    try {
      if (recovery) await vault.unlockWithRecovery(form.secret.value);
      else await vault.unlock(form.secret.value);
      onUnlocked({ viaRecovery: recovery });
    } catch (ex) {
      $('[data-err]', root).textContent = ex.message;
      btn.disabled = false; btn.textContent = 'Unlock';
      form.secret.select();
    }
  };
}

async function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.swbk,.json,application/json';
    input.onchange = async () => resolve(input.files[0] ? await input.files[0].text() : null);
    input.click();
  });
}

async function restoreFlow(root, preset, onDone) {
  let snap = preset;
  if (!snap) {
    const text = await pickFile();
    if (!text) return;
    try { snap = parseSnapshot(text); } catch (e) { return toast(e.message, { type: 'error' }); }
  }
  mount(root, html`<div class="auth"><form class="auth-card" data-form>
    ${brand}
    <div><h1>Restore your vault</h1><p class="muted" style="margin-top:6px">This backup holds <b>${snap.dictations.length}</b> dictations from ${new Date(snap.createdAt).toLocaleString()}. Enter the passphrase it was created with, or its recovery code.</p></div>
    <label class="field"><span>Passphrase or recovery code</span><input class="input" type="password" name="secret" required autofocus></label>
    <label class="row"><input type="checkbox" name="rec"> <span>This is a recovery code</span></label>
    <div class="error-text" data-err></div>
    <div class="row end"><button type="button" class="btn" data-back>Back</button><button class="btn primary" type="submit">Restore</button></div>
  </form></div>`);
  const form = $('[data-form]', root);
  $('[data-back]', root).onclick = () => renderSetup(root, { onDone });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Restoring…';
    try {
      const r = await restoreSnapshot(snap, { secret: form.secret.value, useRecovery: form.rec.checked });
      toast(`Restored ${r.added + r.updated} dictations.`, { type: 'ok' });
      onDone({ deviceUnlock: platform.isDesktop, restored: true });
    } catch (ex) {
      $('[data-err]', root).textContent = ex.message;
      btn.disabled = false; btn.textContent = 'Restore';
    }
  };
}
