// User settings, stored encrypted (they include API keys) under meta 'settings'.

import * as C from './crypto.js';
import * as db from './db.js';
import { platform } from './platform.js';
import { vault } from './vault.js';
import { Emitter } from './util.js';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — best tone preservation (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — balanced' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest, lowest cost' },
];

export const WHISPER_MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'Tiny (English) — ~40 MB, fastest' },
  { id: 'Xenova/whisper-base.en', label: 'Base (English) — ~75 MB, recommended' },
  { id: 'Xenova/whisper-small.en', label: 'Small (English) — ~250 MB, most accurate' },
  { id: 'Xenova/whisper-base', label: 'Base (multilingual) — ~75 MB' },
  { id: 'Xenova/whisper-small', label: 'Small (multilingual) — ~250 MB' },
];

export const DEFAULTS = Object.freeze({
  shortcuts: { toggle: 'CommandOrControl+Shift+Space', recopy: 'CommandOrControl+Alt+V' },
  recording: { enabled: true, keepAudio: true, audioRetentionDays: 0, maxMinutes: 15, sounds: true, overlay: true },
  stt: {
    provider: 'local', // 'local' | 'openai' | 'webspeech'
    localModel: 'Xenova/whisper-base.en',
    language: 'auto',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'whisper-1',
    openaiKey: '',
  },
  correction: {
    provider: 'claude', // 'claude' | 'offline' | 'none'
    model: 'claude-opus-5-5',
    style: 'standard', // 'light' | 'standard'
    customInstructions: '',
    anthropicKey: '',
    removeFillers: true,
  },
  clipboard: { autoCopy: true },
  history: { retentionDays: 0, trashRetentionDays: 30 },
  backup: { enabled: true, intervalHours: 6, keep: 30, includeAudio: true, lastAt: 0, lastLocation: '' },
  security: { autoLockMinutes: 0, deviceUnlock: true },
});

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' ? merge(out[k], v) : v;
  }
  return out;
}

class Settings extends Emitter {
  data = structuredClone(DEFAULTS);

  async load() {
    const box = await db.get('meta', 'settings');
    this.data = box ? merge(DEFAULTS, await C.decryptJSON(vault.key(), box, 'settings')) : structuredClone(DEFAULTS);
    this.emit('change', this.data);
    return this.data;
  }

  async save(patch) {
    this.data = merge(this.data, patch);
    const box = await C.encryptJSON(vault.key(), this.data, 'settings');
    await db.put('meta', box, 'settings');
    await platform.mirrorPut('meta', 'settings', box);
    this.emit('change', this.data);
  }

  reset() { this.data = structuredClone(DEFAULTS); }
  get() { return this.data; }
}

export const settings = new Settings();
