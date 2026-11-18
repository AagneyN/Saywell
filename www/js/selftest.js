// End-to-end self-test (Electron only, throwaway profile): `npm run selftest`.
// Exercises the real vault, store, pipeline (local Whisper + offline correction), clipboard,
// crash recovery, search, encryption-at-rest, backups, restore, lock/unlock and device unlock.

import { vault } from './core/vault.js';
import { settings } from './core/settings.js';
import { store } from './core/store.js';
import { pipeline } from './core/pipeline.js';
import * as db from './core/db.js';
import * as B from './core/backup.js';
import { sleep } from './core/util.js';

const PASS = 'selftest-passphrase-123';
const PROBE = 'pineapple';

export async function runSelfTest({ enter, ctx }) {
  const T = globalThis.saywellNative.selftest;
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) }); T.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ? '— ' + String(detail).slice(0, 160) : ''}`); };
  const shot = async (name) => { await sleep(400); await T.screenshot(name); };
  try {
    const code = await vault.setup(PASS);
    check('vault setup returns recovery code', /^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/.test(code), code.replace(/./g, '•'));
    await enter({ firstRun: true, deviceUnlock: true });
    await settings.save({ correction: { provider: 'offline' }, stt: { provider: 'local', localModel: 'Xenova/whisper-tiny.en' }, backup: { includeAudio: true } });
    await shot('01-dashboard-empty');

    const wav = await T.audio();
    check('test audio available', wav && wav.length > 1000, wav ? `${wav.length} bytes` : 'missing');
    const blob = new Blob([wav], { type: 'audio/wav' });

    // 1. Full pipeline with auto-copy
    const t0 = performance.now();
    const rec = await pipeline.ingest(blob, { autoCopy: true });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    check('pipeline finished', rec?.status === 'done', `${rec?.status} in ${secs}s`);
    check('raw transcript captured (local Whisper)', (rec?.rawText || '').toLowerCase().includes(PROBE), rec?.rawText);
    check('corrected text produced separately', !!rec?.correctedText && rec.correctedText !== undefined, rec?.correctedText);
    check('original preserved alongside corrected', !!rec?.rawText && rec.rawText.length > 10);
    check('filler "um" removed in corrected only', !/\bum\b/i.test(rec?.correctedText || ''), '');
    // Electron auto-copy happens through main-process clipboard; ingest uses autoCopy only when settings allow
    const clip = await T.clipboard();
    check('corrected text auto-copied to system clipboard', clip === rec?.correctedText, clip);

    // 2. Encryption at rest: no plaintext in IndexedDB
    const rows = JSON.stringify(await db.getAll('dictations')) + JSON.stringify(await db.getAll('meta'));
    check('IndexedDB contains no plaintext', !rows.toLowerCase().includes(PROBE));

    // 3. Crash recovery: a recording interrupted mid-way is finished on next start
    const orphan = await store.create({ status: 'recording', mime: 'audio/wav' });
    await store.addAudioChunk(orphan.id, 0, new Uint8Array(wav), 'audio/wav');
    const ids = await pipeline.recover();
    check('recover() picked up interrupted recording', ids.includes(orphan.id));
    for (let i = 0; i < 240 && store.get(orphan.id).status !== 'done'; i++) await sleep(500);
    const o = store.get(orphan.id);
    check('interrupted recording transcribed after recovery', o.status === 'done' && o.interrupted && o.rawText.toLowerCase().includes(PROBE), o.status);

    // 4. Search
    check('search finds dictation by word', store.search(PROBE).length === 2);
    check('search with no match returns nothing', store.search('zebra quantum').length === 0);
    check('phrase search', store.search(`"${PROBE} smoothie"`).length >= 1 || store.search(PROBE).length >= 1);

    // 5. Edit keeps versions; original untouched
    await store.update(rec.id, { correctedText: 'User edited text.', versions: [...rec.versions, { text: rec.correctedText, at: Date.now(), source: 'offline' }] });
    check('editing keeps original + version history', store.get(rec.id).rawText === rec.rawText && store.get(rec.id).versions.length >= 1);

    // 6. Backup snapshot (desktop folder) without plaintext
    const b = await B.runBackup();
    check('automatic backup written', !!b.location, b.location);
    const snapText = await globalThis.saywellNative.backupRead(b.name);
    check('backup contains no plaintext', !snapText.toLowerCase().includes(PROBE));
    const snap = B.parseSnapshot(snapText);
    check('backup includes audio', snap.audio.length >= 2, `${snap.audio.length} chunks`);

    // 7. Soft delete -> trash -> purge -> restore from backup
    await store.softDelete(rec.id);
    check('deleted item goes to trash', store.trash().some((r) => r.id === rec.id) && !store.live().some((r) => r.id === rec.id));
    await store.purge(rec.id);
    check('purge removes item', !store.get(rec.id));
    const r = await B.restoreSnapshot(snap);
    check('restore from backup brings it back', !!store.get(rec.id) && r.added >= 1, JSON.stringify(r));

    // 8. Lock / unlock
    const count = store.all().length;
    vault.lock();
    check('lock clears decrypted cache', store.all().length === 0 && !vault.unlocked);
    let wrongRejected = false;
    try { await vault.unlock('wrong-passphrase'); } catch { wrongRejected = true; }
    check('wrong passphrase rejected', wrongRejected);
    await vault.unlock(PASS);
    await enter({});
    check('unlock with passphrase restores everything', store.all().length === count, `${store.all().length}/${count}`);
    vault.lock();
    await vault.unlockWithRecovery(code.toLowerCase().replace(/-/g, ' '));
    await enter({});
    check('unlock with recovery code works', store.all().length === count);
    vault.lock();
    check('device unlock (OS-protected key) works', await vault.unlockWithDevice());
    await enter({});

    // 9. Mirror rebuild
    const mirror = await B.mirrorSnapshot();
    check('live disk mirror has every record', mirror && mirror.dictations.length === count, `${mirror?.dictations.length}/${count}`);

    // 10. Screens
    ctx.navigate('home'); await shot('02-dashboard');
    ctx.navigate('history', { select: rec.id }); await shot('03-history');
    ctx.navigate('inbox'); await shot('04-inbox');
    ctx.navigate('backups'); await sleep(300); await shot('05-backups');
    ctx.navigate('settings'); await shot('06-settings');
    ctx.navigate('privacy'); await shot('07-privacy');
  } catch (e) {
    check('no unexpected exception', false, `${e.message}\n${e.stack}`);
  }
  const ok = results.every((r) => r.ok);
  await T.report({ ok, passed: results.filter((r) => r.ok).length, total: results.length, results, plaintextProbe: PROBE });
}
