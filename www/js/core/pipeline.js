// The durable dictation state machine:
//   recording -> recorded -> transcribing -> transcribed -> correcting -> done   (or failed)
// Every transition is persisted before work continues, so recover() can resume anything
// interrupted by a crash, a force-quit or a closed tab.

import { Recorder } from './recorder.js';
import { store } from './store.js';
import { settings } from './settings.js';
import { platform } from './platform.js';
import { transcribe, startWebSpeech, webSpeechSupported } from './stt.js';
import { correctText } from './correct.js';
import { Emitter } from './util.js';

class Pipeline extends Emitter {
  state = { phase: 'idle' }; // idle | starting | recording | processing
  current = null; // { id, recorder, startedAt, web, timer }
  #queue = Promise.resolve();
  processing = new Map(); // id -> stage

  #set(state) {
    this.state = state;
    this.emit('state', state);
  }

  async toggle() {
    if (this.state.phase === 'recording') return this.stop();
    if (this.state.phase === 'starting') return;
    return this.start();
  }

  async start() {
    const s = settings.get();
    if (!s.recording.enabled) throw new Error('Recording is turned off in Settings → Recording.');
    if (this.current) return;
    this.#set({ phase: 'starting' });
    const rec = await store.create({ status: 'recording', mime: '', stt: null, correction: null });
    const recorder = new Recorder();
    const startedAt = Date.now();
    this.current = { id: rec.id, recorder, startedAt };
    try {
      await recorder.start({
        onChunk: async (seq, bytes, mime) => {
          await store.addAudioChunk(rec.id, seq, bytes, mime);
          const r = store.get(rec.id);
          if (r) { r.chunkCount = seq + 1; r.mime = mime; }
          // Persist bookkeeping every ~5 s (chunks themselves are already durable).
          if (seq % 5 === 0) await store.update(rec.id, { chunkCount: seq + 1, mime, durationMs: Date.now() - startedAt });
        },
        onLevel: (level) => this.emit('level', level),
        onError: (err) => this.emit('error', { id: rec.id, message: `Saving audio failed: ${err.message}` }),
      });
    } catch (err) {
      this.current = null;
      await store.update(rec.id, { status: 'failed', error: { stage: 'recording', message: micError(err), at: Date.now() } });
      this.#set({ phase: 'idle' });
      platform.overlay({ mode: 'error', text: micError(err) });
      throw new Error(micError(err));
    }
    if (s.stt.provider === 'webspeech' && webSpeechSupported()) this.current.web = startWebSpeech(s.stt.language);
    const maxMs = (s.recording.maxMinutes || 15) * 60_000;
    this.current.timer = setTimeout(() => this.stop(), maxMs);
    this.#set({ phase: 'recording', id: rec.id, startedAt });
    platform.overlay({ mode: 'recording', startedAt });
    if (s.recording.sounds) chime('start');
  }

  async stop() {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    clearTimeout(cur.timer);
    this.#set({ phase: 'processing', id: cur.id });
    platform.overlay({ mode: 'processing', text: 'Saving…' });
    const { chunks, mime } = await cur.recorder.stop();
    const webResult = cur.web ? await cur.web.stop() : null;
    const patch = { status: 'recorded', chunkCount: chunks, mime, durationMs: Date.now() - cur.startedAt };
    if (webResult?.text) Object.assign(patch, { rawText: webResult.text, status: 'transcribed', stt: { provider: 'webspeech', model: 'browser', ms: 0 } });
    await store.update(cur.id, patch);
    if (settings.get().recording.sounds) chime('stop');
    this.#set({ phase: 'idle' });
    return this.enqueue(cur.id, { autoCopy: true });
  }

  /** Import an existing audio file as a dictation (also used by the self-test). */
  async ingest(blob, { autoCopy = false, title } = {}) {
    const rec = await store.create({ status: 'recording', mime: blob.type, title });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await store.addAudioChunk(rec.id, 0, bytes, blob.type || 'audio/webm');
    let durationMs = 0;
    try { durationMs = Math.round((await blobDuration(blob)) * 1000); } catch { /* unknown */ }
    await store.update(rec.id, { status: 'recorded', chunkCount: 1, mime: blob.type, durationMs });
    return this.enqueue(rec.id, { autoCopy });
  }

  enqueue(id, opts = {}) {
    const job = this.#queue.then(() => this.process(id, opts));
    this.#queue = job.catch(() => {});
    return job;
  }

  /** Run (or resume) processing for one dictation from whatever stage it is in. */
  async process(id, { autoCopy = false, force } = {}) {
    let rec = store.get(id);
    if (!rec) return;
    const s = settings.get();
    try {
      if (force === 'transcribe' || ['recorded', 'transcribing', 'recording'].includes(rec.status) || (rec.status === 'failed' && rec.error?.stage === 'transcribing')) {
        this.processing.set(id, 'transcribing');
        await store.update(id, { status: 'transcribing', error: null });
        this.#emitProgress(id, 'transcribing');
        platform.overlay({ mode: 'processing', text: 'Transcribing…' });
        const blob = await store.getAudioBlob(id);
        if (!blob) throw stageError('transcribing', 'No audio was captured.');
        let r;
        try { r = await transcribe(blob, s.stt); } catch (e) { throw stageError('transcribing', e.message); }
        rec = store.get(id);
        const versions = rec.rawText && rec.rawText !== r.text ? [...rec.versions, { text: rec.rawText, at: Date.now(), source: 'original-previous' }] : rec.versions;
        await store.update(id, { rawText: r.text, versions, status: 'transcribed', stt: { provider: r.provider, model: r.model, ms: r.ms }, ...(!rec.durationMs && r.durationMs ? { durationMs: r.durationMs } : {}) });
      }
      rec = store.get(id);
      if (force === 'correct' || ['transcribed', 'correcting'].includes(rec.status) || (rec.status === 'failed' && rec.error?.stage === 'correcting')) {
        this.processing.set(id, 'correcting');
        await store.update(id, { status: 'correcting', error: null });
        this.#emitProgress(id, 'correcting');
        platform.overlay({ mode: 'processing', text: 'Polishing…' });
        const c = await correctText(rec.rawText, s.correction);
        rec = store.get(id);
        const versions = [...rec.versions];
        if (rec.correctedText) versions.push({ text: rec.correctedText, at: Date.now(), source: 'previous' });
        await store.update(id, {
          correctedText: c.text,
          versions,
          status: 'done',
          correction: { provider: c.provider, model: c.model, ms: c.ms, fallback: !!c.fallback, note: c.note || '', flagged: !!c.flagged },
          title: rec.title || makeTitle(c.text || rec.rawText),
        });
      }
      rec = store.get(id);
      this.processing.delete(id);
      if (!s.recording.keepAudio && rec.status === 'done' && rec.rawText) await store.deleteAudio(id).catch(() => {});
      const text = rec.correctedText || rec.rawText;
      let copied = false;
      if (autoCopy && s.clipboard.autoCopy && text) {
        try { copied = await platform.copy(text); } catch { copied = false; }
        if (copied) await store.update(id, { copiedAt: Date.now() });
      }
      const empty = !text;
      platform.overlay({ mode: empty ? 'error' : copied ? 'copied' : 'done', text: empty ? 'Nothing heard' : copied ? 'Copied — paste anywhere' : 'Saved to history' });
      if (copied && s.recording.sounds) chime('done');
      this.emit('done', { id, copied, empty, autoCopy });
      this.#emitProgress(id, 'done');
      return store.get(id);
    } catch (err) {
      this.processing.delete(id);
      const stage = err.stage || 'processing';
      await store.update(id, { status: 'failed', error: { stage, message: err.message, at: Date.now() } }).catch(() => {});
      platform.overlay({ mode: 'error', text: stage === 'transcribing' ? 'Transcription failed — audio is safe' : 'Failed — saved to history' });
      this.emit('failed', { id, message: err.message, stage });
      this.#emitProgress(id, 'failed');
      throw err;
    }
  }

  #emitProgress(id, stage) { this.emit('progress', { id, stage }); }

  retry(id) {
    const rec = store.get(id);
    const force = rec?.error?.stage === 'correcting' ? 'correct' : 'transcribe';
    return this.enqueue(id, { force });
  }
  recorrect(id) { return this.enqueue(id, { force: 'correct' }); }
  retranscribe(id) { return this.enqueue(id, { force: 'transcribe' }); }

  /** Resume everything a crash interrupted. Returns the ids picked up. */
  async recover() {
    const ids = [];
    for (const rec of store.live()) {
      if (this.current?.id === rec.id || this.processing.has(rec.id)) continue;
      if (rec.status === 'recording') {
        await store.update(rec.id, { status: 'recorded', interrupted: true });
      }
      if (['recorded', 'transcribing', 'transcribed', 'correcting'].includes(store.get(rec.id).status)) {
        ids.push(rec.id);
        this.enqueue(rec.id).catch(() => {});
      }
    }
    return ids;
  }
}

function stageError(stage, message) { const e = new Error(message); e.stage = stage; return e; }

function micError(err) {
  if (err?.name === 'NotAllowedError') return 'Microphone permission was denied. Allow microphone access for Saywell and try again.';
  if (err?.name === 'NotFoundError') return 'No microphone was found.';
  return `Could not start the microphone: ${err?.message || err}`;
}

export function makeTitle(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Empty dictation';
  const first = t.split(/(?<=[.!?])\s/)[0];
  return first.length > 64 ? first.slice(0, 61).replace(/\s\S*$/, '') + '…' : first;
}

function blobDuration(blob) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => { resolve(Number.isFinite(a.duration) ? a.duration : 0); URL.revokeObjectURL(a.src); };
    a.onerror = reject;
    a.src = URL.createObjectURL(blob);
  });
}

let audioCtx = null;
function chime(kind) {
  try {
    audioCtx ??= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    const notes = { start: [660, 880], stop: [880, 660], done: [784, 1046] }[kind];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t = audioCtx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.14);
    });
  } catch { /* sounds are optional */ }
}

export const pipelineInstance = new Pipeline();
export { pipelineInstance as pipeline };
