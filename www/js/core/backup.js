// Encrypted snapshot backups, restore/merge, readable export, and mirror rebuild.
// Snapshot files contain only ciphertext plus the wrapped vault key, so they can be stored
// anywhere (USB stick, cloud-synced folder) and still need the passphrase or recovery code.

import * as C from './crypto.js';
import * as db from './db.js';
import { platform } from './platform.js';
import { vault, unwrapFrom } from './vault.js';
import { settings } from './settings.js';
import { store } from './store.js';

export const BACKUP_FORMAT = 'saywell-backup';

export async function buildSnapshot({ includeAudio = true } = {}) {
  const [vaultMeta, settingsBox, dictations, audio] = await Promise.all([
    db.get('meta', 'vault'),
    db.get('meta', 'settings'),
    db.getAll('dictations'),
    includeAudio ? db.getAll('audio') : Promise.resolve([]),
  ]);
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, app: 'Saywell', createdAt: Date.now(), vault: vaultMeta, settings: settingsBox ?? null, dictations, audio });
}

export function backupName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `saywell-backup-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.swbk`;
}

/** Writes a snapshot to the platform location (desktop folder / mobile Documents / chosen web folder). */
export async function runBackup({ manual = false } = {}) {
  const s = settings.get().backup;
  const text = await buildSnapshot({ includeAudio: s.includeAudio });
  const name = backupName();
  let location = await platform.writeBackup(name, text, s.keep);
  if (!location) location = await writeToWebFolder(name, text, s.keep);
  if (!location && manual) location = await platform.saveFile(name, text);
  if (location) await settings.save({ backup: { lastAt: Date.now(), lastLocation: location } });
  return { location, bytes: text.length, name };
}

// ---- Web: optional File System Access folder (Chromium) ----
export const webFolderSupported = () => typeof globalThis.showDirectoryPicker === 'function' && !platform.isDesktop && !platform.isMobile;

export async function chooseWebFolder() {
  const handle = await globalThis.showDirectoryPicker({ id: 'saywell-backups', mode: 'readwrite' });
  await db.put('meta', handle, 'backupDir');
  return handle.name;
}

async function writeToWebFolder(name, text, keep) {
  if (!webFolderSupported()) return null;
  const handle = await db.get('meta', 'backupDir');
  if (!handle) return null;
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted') return null;
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
  try {
    const names = [];
    for await (const [n] of handle.entries()) if (n.endsWith('.swbk')) names.push(n);
    names.sort();
    for (const old of names.slice(0, Math.max(0, names.length - keep))) await handle.removeEntry(old);
  } catch { /* best effort */ }
  return `${handle.name}/${name}`;
}

export async function webFolderName() {
  const h = await db.get('meta', 'backupDir').catch(() => null);
  return h?.name || '';
}

export function parseSnapshot(text) {
  let snap;
  try { snap = JSON.parse(text); } catch { throw new Error('This file is not a Saywell backup.'); }
  if (snap?.format !== BACKUP_FORMAT || !snap.vault || !Array.isArray(snap.dictations)) throw new Error('This file is not a Saywell backup.');
  return snap;
}

/**
 * Restore a snapshot.
 *  - Fresh profile (no vault): adopts the backup's vault; needs its passphrase or recovery code.
 *  - Existing vault, same key: merges rows directly (newest wins).
 *  - Existing vault, different key: decrypts with the backup's key, re-encrypts with ours, merges.
 */
export async function restoreSnapshot(snap, { secret, useRecovery = false } = {}) {
  const fresh = !(await vault.isSetUp());
  if (fresh) {
    const key = await unwrapFrom(snap.vault, secret, useRecovery);
    await vault.adopt(snap.vault, key);
    if (snap.settings) { await db.put('meta', snap.settings, 'settings'); await platform.mirrorPut('meta', 'settings', snap.settings); }
    const stats = await mergeRows(snap.dictations, snap.audio || [], null);
    return { ...stats, fresh: true };
  }
  const current = vault.key();
  let sameKey = false;
  try { await C.decryptJSON(current, snap.vault.verifier, 'verifier'); sameKey = true; } catch { /* different vault */ }
  let rekey = null;
  if (!sameKey) {
    if (!secret) { const e = new Error('This backup was made with a different passphrase. Enter that passphrase (or its recovery code).'); e.needsSecret = true; throw e; }
    rekey = { from: await unwrapFrom(snap.vault, secret, useRecovery), to: current };
  }
  return mergeRows(snap.dictations, snap.audio || [], rekey);
}

async function mergeRows(dictations, audio, rekey) {
  let added = 0, updated = 0, audioAdded = 0;
  for (let row of dictations) {
    const existing = await db.get('dictations', row.id);
    if (existing && existing.updatedAt >= row.updatedAt) continue;
    if (rekey) {
      const payload = await C.decryptJSON(rekey.from, row, row.id);
      row = { ...row, ...(await C.encryptJSON(rekey.to, payload, row.id)) };
    }
    await db.put('dictations', row);
    await platform.mirrorPut('dictations', row.id, row);
    existing ? updated++ : added++;
  }
  for (let row of audio) {
    if (await db.get('audio', [row.dictationId, row.seq])) continue;
    if (rekey) {
      const aad = `${row.dictationId}:${row.seq}`;
      const bytes = await C.decryptBytes(rekey.from, row, aad);
      row = { ...row, ...(await C.encryptBytes(rekey.to, bytes, aad)) };
    }
    await db.put('audio', row);
    await platform.mirrorPut('audio', `${row.dictationId}_${row.seq}`, row);
    audioAdded++;
  }
  if (vault.unlocked) await store.load();
  return { added, updated, audioAdded };
}

/** Desktop: rebuild the whole database from the live disk mirror. */
export async function mirrorSnapshot() {
  const entries = await platform.mirrorList();
  const get = (s) => entries.filter((e) => e.store === s).map((e) => e.value);
  const vaultMeta = entries.find((e) => e.store === 'meta' && e.key === 'vault')?.value;
  if (!vaultMeta) return null;
  return {
    format: BACKUP_FORMAT, version: 1, createdAt: Date.now(), vault: vaultMeta,
    settings: entries.find((e) => e.store === 'meta' && e.key === 'settings')?.value ?? null,
    dictations: get('dictations'), audio: get('audio'),
  };
}

/** Plaintext export (explicitly confirmed by the user in the UI). */
export function readableExport(format = 'md') {
  const rows = store.live();
  if (format === 'json') {
    return JSON.stringify(rows.map((r) => ({ id: r.id, createdAt: new Date(r.createdAt).toISOString(), title: r.title, corrected: r.correctedText, original: r.rawText, versions: r.versions, durationMs: r.durationMs })), null, 2);
  }
  return `# Saywell export — ${new Date().toLocaleString()}\n\n` + rows.map((r) =>
    `## ${new Date(r.createdAt).toLocaleString()} — ${r.title || 'Dictation'}\n\n**Corrected**\n\n${r.correctedText || '_(none)_'}\n\n**Original transcript**\n\n${r.rawText || '_(none)_'}\n`).join('\n---\n\n');
}

let timer = null;
/** Periodic automatic backups + retention sweep while unlocked. */
export function startScheduler(onBackup) {
  stopScheduler();
  const tick = async () => {
    const s = settings.get();
    try {
      await store.sweep({ audioRetentionDays: s.recording.audioRetentionDays, historyRetentionDays: s.history.retentionDays, trashRetentionDays: s.history.trashRetentionDays });
      if (s.backup.enabled && Date.now() - (s.backup.lastAt || 0) > s.backup.intervalHours * 3_600_000) {
        const r = await runBackup();
        onBackup?.(r);
      }
    } catch (e) { console.warn('scheduled backup failed', e); onBackup?.({ error: e.message }); }
  };
  timer = setInterval(tick, 5 * 60_000);
  setTimeout(tick, 15_000);
}
export function stopScheduler() { clearInterval(timer); timer = null; }
