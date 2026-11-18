// Encrypted dictation repository with an in-memory decrypted index for instant search.
// Every write goes to IndexedDB (awaited until committed) and to the desktop disk mirror.

import * as C from './crypto.js';
import * as db from './db.js';
import { platform } from './platform.js';
import { vault } from './vault.js';
import { Emitter, newId, fold, wordCount } from './util.js';

const PLAIN_FIELDS = ['id', 'createdAt', 'updatedAt', 'status', 'deleted'];
const DAY = 86_400_000;

class Store extends Emitter {
  cache = new Map();
  corrupt = [];

  async load() {
    this.cache.clear();
    this.corrupt = [];
    const rows = await db.getAll('dictations');
    const key = vault.key();
    await Promise.all(rows.map(async (row) => {
      try {
        const payload = await C.decryptJSON(key, row, row.id);
        this.cache.set(row.id, { ...payload, ...pick(row) });
      } catch {
        this.corrupt.push(row.id);
      }
    }));
    this.emit('change');
  }

  clear() { this.cache.clear(); this.emit('change'); }

  async create(fields = {}) {
    const now = Date.now();
    const rec = { id: newId(), createdAt: now, updatedAt: now, status: 'recording', deleted: 0, rawText: '', correctedText: '', versions: [], chunkCount: 0, ...fields };
    await this.save(rec);
    return rec;
  }

  /** Persist a full record. Returns once durably committed. */
  async save(rec) {
    rec.updatedAt = Date.now();
    const payload = { ...rec };
    for (const f of PLAIN_FIELDS) delete payload[f];
    const box = await C.encryptJSON(vault.key(), payload, rec.id);
    const row = { ...pick(rec), ...box };
    await db.put('dictations', row);
    this.cache.set(rec.id, rec);
    platform.mirrorPut('dictations', rec.id, row)?.catch?.((e) => console.warn('mirror failed', e));
    this.emit('change', rec);
    return rec;
  }

  async update(id, patch) {
    const rec = this.cache.get(id);
    if (!rec) throw new Error('Dictation not found');
    return this.save(Object.assign(rec, patch));
  }

  get(id) { return this.cache.get(id); }

  async addAudioChunk(id, seq, bytes, mime) {
    const box = await C.encryptBytes(vault.key(), bytes, `${id}:${seq}`);
    const row = { dictationId: id, seq, mime, ...box };
    await db.put('audio', row);
    platform.mirrorPut('audio', `${id}_${seq}`, row)?.catch?.((e) => console.warn('mirror failed', e));
  }

  async getAudioBlob(id) {
    const rows = await db.audioFor(id);
    if (!rows.length) return null;
    const key = vault.key();
    const parts = [];
    for (const r of rows) parts.push(await C.decryptBytes(key, r, `${id}:${r.seq}`));
    return new Blob(parts, { type: rows[0].mime || 'audio/webm' });
  }

  async hasAudio(id) { return (await db.audioFor(id)).length > 0; }

  async deleteAudio(id) {
    const rows = await db.audioFor(id);
    await db.deleteAudioFor(id);
    for (const r of rows) platform.mirrorDelete('audio', `${id}_${r.seq}`);
    const rec = this.cache.get(id);
    if (rec) await this.update(id, { audioPurgedAt: Date.now() });
  }

  async softDelete(id) { return this.update(id, { deleted: 1, deletedAt: Date.now() }); }
  async restore(id) { return this.update(id, { deleted: 0, deletedAt: null }); }

  async purge(id) {
    await this.deleteAudio(id).catch(() => {});
    await db.del('dictations', id);
    platform.mirrorDelete('dictations', id);
    this.cache.delete(id);
    this.emit('change');
  }

  all() {
    return [...this.cache.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  live() { return this.all().filter((r) => !r.deleted); }
  trash() { return this.all().filter((r) => r.deleted); }

  unpasted() {
    return this.live().filter((r) => r.status === 'done' && !r.usedAt && (r.correctedText || r.rawText));
  }

  needsAttention() { return this.live().filter((r) => r.status === 'failed'); }

  /**
   * Full-text search. Terms are ANDed, "quoted phrases" kept together, case/accent-insensitive.
   * Searches corrected text, original text and title.
   */
  search(query, { filter = 'all', from = 0, to = Infinity } = {}) {
    const terms = parseQuery(query);
    return this.live().filter((r) => {
      if (r.createdAt < from || r.createdAt > to) return false;
      if (filter === 'pinned' && !r.pinned) return false;
      if (filter === 'unpasted' && !(r.status === 'done' && !r.usedAt)) return false;
      if (filter === 'failed' && r.status !== 'failed') return false;
      if (filter === 'audio' && (!r.chunkCount || r.audioPurgedAt)) return false;
      if (!terms.length) return true;
      const hay = fold(`${r.title || ''}\n${r.correctedText || ''}\n${r.rawText || ''}`);
      return terms.every((t) => hay.includes(t));
    });
  }

  stats() {
    const live = this.live();
    const now = Date.now();
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const week = now - 7 * DAY;
    let words = 0, weekWords = 0, today = 0, speakingMs = 0;
    const days = Array.from({ length: 14 }, (_, i) => ({ day: new Date(startOfDay.getTime() - (13 - i) * DAY), count: 0, words: 0 }));
    for (const r of live) {
      const w = wordCount(r.correctedText || r.rawText);
      words += w;
      speakingMs += r.durationMs || 0;
      if (r.createdAt >= week) weekWords += w;
      if (r.createdAt >= startOfDay.getTime()) today++;
      const idx = 13 - Math.floor((startOfDay.getTime() + DAY - 1 - r.createdAt) / DAY);
      if (idx >= 0 && idx < 14) { days[idx].count++; days[idx].words += w; }
    }
    // Typing at 40 wpm vs. speaking time actually spent.
    const savedMin = Math.max(0, words / 40 - speakingMs / 60000);
    return { total: live.length, words, weekWords, today, savedMin, unpasted: this.unpasted().length, failed: this.needsAttention().length, days };
  }

  /** Apply retention policies. Never touches pinned items. Returns counts. */
  async sweep({ audioRetentionDays, historyRetentionDays, trashRetentionDays }) {
    const now = Date.now();
    let purged = 0, audio = 0, trashed = 0;
    for (const r of this.all()) {
      if (r.pinned) continue;
      if (r.deleted && trashRetentionDays > 0 && now - (r.deletedAt || r.updatedAt) > trashRetentionDays * DAY) { await this.purge(r.id); purged++; continue; }
      if (!r.deleted && historyRetentionDays > 0 && now - r.createdAt > historyRetentionDays * DAY) { await this.softDelete(r.id); trashed++; }
      if (audioRetentionDays > 0 && r.chunkCount && !r.audioPurgedAt && r.status === 'done' && now - r.createdAt > audioRetentionDays * DAY) { await this.deleteAudio(r.id); audio++; }
    }
    return { purged, audio, trashed };
  }
}

function pick(rec) {
  const o = {};
  for (const f of PLAIN_FIELDS) o[f] = rec[f];
  o.deleted = rec.deleted ? 1 : 0;
  return o;
}

export function parseQuery(q) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q || ''))) terms.push(fold(m[1] ?? m[2]));
  return terms.filter(Boolean);
}

export const store = new Store();
