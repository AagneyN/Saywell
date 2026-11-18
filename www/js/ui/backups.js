// Backups: status, back up now, snapshot list + restore, encrypted/readable export, import, mirror rebuild.

import { html, mount, $, $$, icon, toast, confirmDialog, promptDialog, fmtAgo, fmtBytes, fmtDate } from './dom.js';
import { settings } from '../core/settings.js';
import { platform } from '../core/platform.js';
import { store } from '../core/store.js';
import * as B from '../core/backup.js';

export function renderBackups(root, ctx) {
  const offs = [];
  async function draw() {
    const s = settings.get().backup;
    const list = await platform.listBackups().catch(() => []);
    const folder = platform.isDesktop ? await platform.native.backupGetFolder() : platform.isMobile ? 'Documents/Saywell' : await B.webFolderName();
    const due = s.enabled && Date.now() - (s.lastAt || 0) > s.intervalHours * 3_600_000;
    mount(root, html`<div class="page">
      <div class="page-head"><div><h1>Backups</h1><p class="muted">Encrypted snapshots of every dictation, transcript and recording. They're useless without your passphrase or recovery code.</p></div><span class="spacer"></span>
        <button class="btn primary" data-now>${icon('backup')} Back up now</button></div>
      <div class="grid cols-2">
        <section class="card grid">
          <h2>Protection status</h2>
          <div class="health">
            <div><span class="dot ${s.lastAt && !due ? 'ok' : 'warn'}"></span>Last snapshot<span class="v">${s.lastAt ? `${fmtAgo(s.lastAt)}` : 'never'}</span></div>
            <div><span class="dot ${s.enabled ? 'ok' : 'warn'}"></span>Automatic snapshots<span class="v">${s.enabled ? `every ${s.intervalHours} h, keep ${s.keep}` : 'off'}</span></div>
            ${platform.isDesktop ? html`<div><span class="dot ok"></span>Live disk mirror<span class="v">every change, instantly</span></div>` : ''}
            <div><span class="dot ${folder ? 'ok' : 'warn'}"></span>Location<span class="v" style="word-break:break-all">${folder || 'not chosen'}</span></div>
            <div><span class="dot ok"></span>Encryption<span class="v">AES-256-GCM</span></div>
          </div>
          ${!platform.isDesktop && !platform.isMobile && !folder ? html`<div class="note">${icon('alert')}<span>In the browser, automatic snapshots need a folder. ${B.webFolderSupported() ? 'Choose one below, or ' : ''}use <b>Back up now</b> to download a file.</span></div>` : ''}
          <div class="row">
            ${platform.isDesktop ? html`<button class="btn sm" data-folder>${icon('folder')} Change folder</button><button class="btn sm" data-openfolder>Open folder</button>` : ''}
            ${B.webFolderSupported() ? html`<button class="btn sm" data-webfolder>${icon('folder')} ${folder ? 'Change' : 'Choose'} backup folder</button>` : ''}
            <button class="btn sm ghost" data-settings>Backup settings →</button>
          </div>
          <p class="faint">Tip: choose a cloud-synced folder (OneDrive, iCloud Drive, Dropbox) for off-device copies. The files stay end-to-end encrypted.</p>
        </section>
        <section class="card grid">
          <h2>Export & import</h2>
          <div class="row"><button class="btn" data-export>${icon('file')} Export encrypted backup</button><button class="btn" data-import>${icon('upload')} Import backup</button></div>
          <div class="row"><button class="btn" data-readable-md>Export readable (.md)</button><button class="btn" data-readable-json>Export readable (.json)</button></div>
          <p class="faint">Readable exports are <b>not encrypted</b>. Handle them carefully.</p>
          ${platform.isDesktop ? html`<hr style="border:0;border-top:1px solid var(--border);width:100%"><h3>Disaster recovery</h3><p class="muted">If the app database is ever damaged, rebuild it from the live encrypted mirror on disk.</p><div><button class="btn" data-mirror>${icon('restore')} Rebuild from mirror</button></div>` : ''}
        </section>
      </div>
      <section class="card"><h2>Snapshots</h2>
        ${list.length ? html`<div class="health">${list.map((b) => html`<div><span class="dot ok"></span><span>${fmtDate(b.mtime || parseName(b.name))}</span><span class="faint">${fmtBytes(b.size || 0)}</span><span class="v"><button class="btn sm" data-restore="${b.name}">${icon('restore')} Restore</button></span></div>`)}</div>`
          : html`<p class="muted">${platform.isDesktop || platform.isMobile ? 'No snapshots yet. The first one is created automatically shortly after unlocking.' : 'Snapshot files you download live in your Downloads folder. Use Import to restore one.'}</p>`}
      </section>
    </div>`);

    const err = (e) => toast(e.message, { type: 'error' });
    $('[data-now]', root).onclick = async () => {
      try { const r = await B.runBackup({ manual: true }); if (r.location) toast(`Backup saved (${fmtBytes(r.bytes)}).`, { type: 'ok' }); draw(); } catch (e) { err(e); }
    };
    $('[data-folder]', root)?.addEventListener('click', async () => { const f = await platform.native.backupChooseFolder(); if (f) { toast('Backup folder changed.'); draw(); } });
    $('[data-openfolder]', root)?.addEventListener('click', () => platform.native.backupOpenFolder());
    $('[data-webfolder]', root)?.addEventListener('click', async () => { try { await B.chooseWebFolder(); await B.runBackup(); draw(); } catch (e) { if (e.name !== 'AbortError') err(e); } });
    $('[data-settings]', root).onclick = () => ctx.navigate('settings', { section: 'backup' });
    $('[data-export]', root).onclick = async () => { const text = await B.buildSnapshot({ includeAudio: true }); const where = await platform.saveFile(B.backupName(), text); if (where) toast('Encrypted backup exported.', { type: 'ok' }); };
    $('[data-import]', root).onclick = () => importFile().catch(err);
    for (const fmt of ['md', 'json']) {
      $(`[data-readable-${fmt}]`, root).onclick = async () => {
        const ok = await confirmDialog({ title: 'Export unencrypted text?', message: `This creates a readable file containing ${store.live().length} dictations (corrected and original text). Anyone with the file can read it.`, confirm: 'Export readable file' });
        if (ok) await platform.saveFile(`saywell-export-${new Date().toISOString().slice(0, 10)}.${fmt}`, B.readableExport(fmt), fmt === 'md' ? 'text/markdown' : 'application/json');
      };
    }
    $('[data-mirror]', root)?.addEventListener('click', async () => {
      const snap = await B.mirrorSnapshot();
      if (!snap) return toast('No mirror found.', { type: 'error' });
      const r = await B.restoreSnapshot(snap);
      toast(`Mirror merged: ${r.added} added, ${r.updated} updated, ${r.audioAdded} audio chunks.`, { type: 'ok' });
    });
    $$('[data-restore]', root).forEach((b) => (b.onclick = async () => {
      try { await restoreText(await platform.readBackup(b.dataset.restore)); } catch (e) { err(e); }
    }));
  }

  async function importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.swbk,.json';
    input.onchange = async () => { if (input.files[0]) restoreText(await input.files[0].text()).catch((e) => toast(e.message, { type: 'error' })); };
    input.click();
  }

  async function restoreText(text) {
    const snap = B.parseSnapshot(text);
    const ok = await confirmDialog({ title: 'Restore this backup?', message: `It contains ${snap.dictations.length} dictations from ${fmtDate(snap.createdAt)}. They are merged into your history. Nothing current is deleted, and newer versions win.`, confirm: 'Merge backup' });
    if (!ok) return;
    let r;
    try { r = await B.restoreSnapshot(snap); } catch (e) {
      if (!e.needsSecret) throw e;
      const secret = await promptDialog({ title: 'Different passphrase', message: e.message, label: 'Passphrase of that backup', type: 'password', confirm: 'Decrypt & merge' });
      if (!secret) return;
      try { r = await B.restoreSnapshot(snap, { secret }); } catch { r = await B.restoreSnapshot(snap, { secret, useRecovery: true }); }
    }
    toast(`Restored: ${r.added} new, ${r.updated} updated.`, { type: 'ok' });
  }

  offs.push(settings.on('change', () => {}));
  draw();
  return () => offs.forEach((f) => f());
}

function parseName(name) {
  const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
}
