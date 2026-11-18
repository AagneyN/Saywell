// Speech-to-text providers.
//  - local:     Whisper in a Web Worker (private, offline after first model download)
//  - openai:    any OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq, self-hosted)
//  - webspeech: browser SpeechRecognition, live while recording (Chrome; not in Electron)

import { Emitter } from './util.js';

export const sttEvents = new Emitter();
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./stt-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') return sttEvents.emit('model-progress', data);
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.type === 'error') p.reject(new Error(data.message));
    else p.resolve(data);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Speech worker crashed'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call(msg, transfer) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id }, transfer || []);
  });
}

/** Decode any recorded blob to 16 kHz mono Float32 PCM (what Whisper expects). */
export async function decodeTo16k(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  const ctx = new Ctx();
  let decoded;
  try { decoded = await ctx.decodeAudioData(buf.slice(0)); } finally { ctx.close?.(); }
  const length = Math.max(1, Math.ceil(decoded.duration * 16000));
  const off = new OfflineAudioContext(1, length, 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

export async function preloadLocal(model) {
  await call({ type: 'preload', model, device: 'wasm' });
}

export async function transcribe(blob, cfg) {
  const t0 = performance.now();
  if (cfg.provider === 'openai') {
    if (!cfg.openaiKey) throw new Error('No API key for the cloud transcription provider (Settings → Transcription).');
    const form = new FormData();
    const ext = (blob.type.includes('mp4') ? 'm4a' : blob.type.includes('wav') ? 'wav' : blob.type.includes('ogg') ? 'ogg' : 'webm');
    form.append('file', blob, `dictation.${ext}`);
    form.append('model', cfg.openaiModel || 'whisper-1');
    if (cfg.language && cfg.language !== 'auto') form.append('language', cfg.language);
    const res = await fetch(`${cfg.openaiBaseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.openaiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Transcription API error ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json = await res.json();
    return { text: (json.text || '').trim(), provider: 'openai', model: cfg.openaiModel, ms: Math.round(performance.now() - t0) };
  }
  const audio = await decodeTo16k(blob);
  if (audio.length < 1600) return { text: '', provider: 'local', model: cfg.localModel, ms: 0 };
  const samples = audio.length;
  const { text } = await call({ type: 'transcribe', model: cfg.localModel, audio, language: cfg.language }, [audio.buffer]);
  return { text: cleanWhisper(text), provider: 'local', model: cfg.localModel, ms: Math.round(performance.now() - t0), durationMs: Math.round((samples / 16000) * 1000) };
}

// Whisper hallucination markers on silence.
function cleanWhisper(t) {
  return (t || '').replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE|inaudible)\]|\((?:silence|music|inaudible)\)/gi, '').replace(/\s+/g, ' ').trim();
}

// ---- Web Speech (live) ----
export function webSpeechSupported() {
  return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition) && !globalThis.saywellNative;
}

export function startWebSpeech(language) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = false;
  if (language && language !== 'auto') rec.lang = language;
  const finals = [];
  let error = null;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) finals.push(e.results[i][0].transcript);
  };
  rec.onerror = (e) => { error = e.error; };
  let ended = false;
  rec.onend = () => { if (!ended) try { rec.start(); } catch { /* restarting */ } };
  rec.start();
  return {
    stop: () => new Promise((resolve) => {
      ended = true;
      rec.onend = () => resolve({ text: finals.join(' ').trim(), error });
      try { rec.stop(); } catch { resolve({ text: finals.join(' ').trim(), error }); }
    }),
  };
}
