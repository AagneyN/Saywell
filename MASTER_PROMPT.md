# Saywell: Master Build Prompt

> This is the full brief for building **Saywell**, a private AI voice-dictation app that never loses your data. Give it to an engineer or a coding agent as-is. The whole application in this repository was built from it.

---

## 0. Role & mission

You are a senior full-stack engineer with a background in security. Build **Saywell**, a voice-dictation app:

1. The user presses a **customizable global keyboard shortcut** from any app and speaks.
2. Pressing the shortcut again (or clicking Stop) ends the recording. Saywell then **transcribes** the speech.
3. An AI copy editor **corrects grammar, punctuation, capitalization and recognition errors** while keeping the speaker's original **meaning, tone, voice and register**.
4. The finished text is **copied to the system clipboard automatically**, ready to paste anywhere.
5. **Nothing is ever lost.** Every recording and transcript is saved encrypted, backed up automatically and kept in searchable history. This holds through crashes, force-quits and accidental window closes.
6. The **original transcript and the corrected version are stored separately and permanently**, so the user can always recover exactly what they said.

Ship it as a **web app first** (one shared codebase). Add an **Electron desktop shell** for global shortcuts, background microphone access and native clipboard, and **Capacitor** wrappers for **iOS and Android**. Security and privacy are first-class requirements.

---

## 1. Product identity & branding

| Item | Decision |
|---|---|
| **Name** | **Saywell**: "say it well". Short, verb-like and original, and it describes the result (your words, said well). |
| **Tagline** | *Say it. Paste it. Never lose it.* |
| **Voice** | Calm, precise, reassuring. Plain language, no hype. Privacy statements are concrete ("encrypted with AES-256-GCM on this device"), not vague. |
| **Logo** | A rounded-square app tile with a diagonal **violet → mint** gradient. Inside is a white speech bubble holding three rising waveform bars, and the last bar becomes a **check-mark tick**: speech turning into finished text. It must read clearly at 16 px (tray) and at 1024 px (store icon). Ship it as SVG (`www/assets/logo.svg`), with PNG renders for tray, PWA and mobile icons. |
| **Primary color** | Signal Violet `#6D5EF5` |
| **Accent** | Mint `#2BD9A4` (success, "copied") |
| **Recording** | Coral `#FF6B57` (live mic state only) |
| **Neutrals** | Ink `#0E1020` / Slate `#5B6178` / Mist `#EEF0F7` / Paper `#FFFFFF` |
| **Typography** | System UI stack (`Inter`, `Segoe UI`, `SF Pro`, `Roboto`). Tabular numerals for timers and stats. |
| **Motion** | One expressive animation only, the live waveform/level ring while recording. Everything else is ≤150 ms ease-out. Respect `prefers-reduced-motion`. |
| **Theme** | Light and dark themes, following the OS by default, with a manual override. |

---

## 2. Architecture

```
┌───────────────────────────── Shared web app (www/) ─────────────────────────────┐
│  UI (vanilla ES modules, no framework, no build step needed to run)              │
│   ├─ Dashboard · Dictate · History/Search · Unpasted inbox · Trash · Backups ·    │
│   │  Settings · Privacy & Security · Lock/Setup screens                          │
│  Core                                                                            │
│   ├─ crypto.js     AES-256-GCM, PBKDF2-SHA256 (600k), AES-KW key wrapping        │
│   ├─ vault.js      data key lifecycle: setup / unlock / lock / recovery code     │
│   ├─ db.js         IndexedDB (meta, dictations, audio chunks)                    │
│   ├─ store.js      encrypted repository + in-memory decrypted index + search     │
│   ├─ recorder.js   MediaRecorder, 1 s chunks persisted the moment they exist     │
│   ├─ pipeline.js   durable state machine + crash recovery                        │
│   ├─ stt.js        providers: Local Whisper (WASM worker) · OpenAI-compatible ·  │
│   │                Browser speech                                                │
│   ├─ correct.js    providers: Claude (Anthropic SDK) · offline rule-based        │
│   ├─ backup.js     encrypted snapshots, import/merge, retention                  │
│   └─ platform.js   one bridge over Electron / Capacitor / plain browser          │
└──────────────────────────────────────────────────────────────────────────────────┘
        ▲ contextBridge (window.saywellNative)          ▲ Capacitor plugins
┌───────┴──────── Electron (electron/) ────────┐  ┌──────┴─────── iOS / Android ─────┐
│ main.js: app:// protocol, CSP, permissions,  │  │ capacitor.config.json, webDir=www │
│ global shortcuts, tray + recent dictations,  │  │ Clipboard, Preferences,           │
│ recording overlay, hide-on-close, crash      │  │ Filesystem (backups)              │
│ auto-reload, single instance, safeStorage    │  │ Mic permission strings            │
│ device unlock, live encrypted disk mirror,   │  │                                   │
│ rotating snapshot backups                    │  │                                   │
└──────────────────────────────────────────────┘  └───────────────────────────────────┘
```

**Principles**

- **One codebase.** Every feature lives in `www/`. Platform shells only add capabilities through `platform.js`, which degrades gracefully: Electron → Capacitor → browser.
- **Persist first, process second.** Write every artifact (audio chunk, transcript, correction) durably *before* starting the next step. Processing is idempotent and resumable.
- **Encrypt everything at the edge.** Content is encrypted in the renderer before it reaches IndexedDB, the disk mirror or a backup file. The Electron main process only handles ciphertext.
- **No server of ours.** Saywell has no backend. With Local Whisper and offline correction, audio and text never leave the device. Cloud AI is opt-in and uses the user's own keys.

---

## 3. Technology stack

| Layer | Choice | Why |
|---|---|---|
| UI | Vanilla ES modules + CSS custom properties | Runs unbuilt in a browser, Electron and Capacitor. No framework lock-in. Small audit surface. |
| Storage | IndexedDB (`saywell` DB: `meta`, `dictations`, `audio`) | Available on all three targets. Transactional. Large binary capacity. |
| Crypto | WebCrypto: AES-256-GCM, PBKDF2-SHA-256 600,000 iterations, AES-KW | Native, audited, no JS crypto libraries. |
| Speech-to-text (default) | **Local Whisper** via `@huggingface/transformers` (ONNX Runtime WASM) in a Web Worker | Private and offline after a one-time model download. |
| Speech-to-text (optional) | Any OpenAI-compatible `/audio/transcriptions` endpoint (OpenAI, Groq, self-hosted) | Faster and more accurate for users who opt in. |
| Speech-to-text (optional) | Web Speech API (browser only) | Zero setup in Chrome. |
| Correction (default when keyed) | **Claude** via the official `@anthropic-ai/sdk`. Model `claude-opus-5-5` (selectable, e.g. `claude-haiku-5-5` for lowest latency), `output_config.effort: "low"`, server-side refusal fallback | Best tone preservation. Effort is low because the task is short and latency-sensitive. |
| Correction (offline) | Deterministic rule-based cleaner | Always available, never fails, never changes meaning. |
| Desktop | Electron (contextIsolation, sandbox, custom `app://` protocol) | Global shortcuts, tray, native clipboard, OS-protected secret storage. |
| Mobile | Capacitor 8 (Android + iOS) | Reuses `www/` unchanged. Native clipboard and filesystem plugins. |
| Tooling | esbuild (vendors the SDK for the browser), Node's built-in test runner | Fast, minimal. |

---

## 4. Data model

```ts
// IndexedDB store "dictations": key = id
{ id: string /* ULID-ish, time-sortable */, createdAt: number, updatedAt: number,
  status: 'recording'|'recorded'|'transcribing'|'transcribed'|'correcting'|'done'|'failed',
  deleted: 0|1,                    // plaintext flag so recovery and trash work while locked
  iv: base64, ct: base64 }         // AES-GCM ciphertext of the payload below

// decrypted payload
{ rawText: string,                 // verbatim speech-to-text output, never overwritten
  correctedText: string,           // AI/offline-corrected text
  versions: [{ text, at, source: 'ai'|'offline'|'user' }],  // full edit history
  durationMs, chunkCount, mime, language,
  stt: { provider, model, ms }, correction: { provider, model, ms, fallback? },
  error?: { stage, message, at }, interrupted?: boolean,
  copiedAt?, usedAt?, pinned?: boolean, title?: string, deletedAt? }

// store "audio": key = [dictationId, seq] → { dictationId, seq, iv, ct, mime }
// store "meta":  vault (salt, iterations, wrappedKey, recoveryWrappedKey, verifier),
//                settings (encrypted), schemaVersion
```

Rule: `rawText` is written once per transcription and is never edited by correction or by the user. A re-transcription appends the previous raw text to `versions` before replacing it.

---

## 5. Core flows

### 5.1 Dictation pipeline (durable state machine)
1. **Shortcut pressed** → create the record with `status: recording` and persist it immediately.
2. `MediaRecorder` runs with a 1-second `timeslice`. Each chunk is encrypted and written to IndexedDB **and**, on desktop, mirrored to disk **before** the next chunk arrives. A crash costs at most about one second of audio.
3. **Shortcut pressed again** → `status: recorded` → decode to 16 kHz mono → **transcribe** (`transcribing`) → store `rawText` (`transcribed`) → **correct** (`correcting`) → store `correctedText` (`done`).
4. **Auto-copy** to the clipboard (native clipboard on desktop and mobile), set `copiedAt`, flash the overlay "Copied ✓", play an optional chime.
5. Any failure sets `status: failed` with `error.stage`. The user can retry from that stage. Audio is never discarded because processing failed.

### 5.2 Crash and close safety
- On every unlock, `pipeline.recover()` scans for unfinished records. `recording` becomes `recorded` (marked `interrupted`) and is processed. `transcribing` and `correcting` resume from the last persisted stage.
- Desktop: closing the window **hides to tray** and the app keeps running. Only *Quit* from the tray or menu exits. A renderer crash (`render-process-gone`) auto-reloads, and recovery runs. Single-instance lock.
- `navigator.storage.persist()` is requested so the browser will not evict data.
- **Desktop live mirror**: every encrypted record and audio chunk is also written atomically (temp file + rename) to `userData/mirror/`. If IndexedDB is ever wiped or corrupted, Saywell offers a one-click rebuild from the mirror.

### 5.3 "Forgot to paste" recovery
- **Unpasted inbox**: completed dictations not yet marked "used", newest first, with one-click copy. Copying from Saywell or "Mark as used" clears them.
- **Re-copy last** global shortcut (default `Ctrl/Cmd+Alt+V`).
- Tray menu → **Recent dictations**: the last 5, click to re-copy.
- Searchable history keeps everything until the user deletes it. Deleting moves items to **Trash** (kept 30 days by default, configurable), never straight to permanent deletion.

### 5.4 Search & history
- Full-text search across corrected text, original text and titles. Case- and accent-insensitive, multi-term AND, quoted phrases. Highlighted matches.
- Filters: All / Pinned / Unpasted / Failed / Has audio, plus date range.
- The detail panel has editable corrected text (every save becomes a version), the original transcript, a word-level diff, decrypted audio playback, metadata, and these actions: copy corrected, copy original, re-correct, re-transcribe, pin, mark used, delete, export.

---

## 6. AI correction spec

- **System prompt** (in `www/js/core/correction-prompt.js`): the model is a dictation copy editor. It fixes grammar, punctuation, capitalization, spelling and obvious mis-hearings. It removes fillers, stutters and false starts (in *standard* style). It applies spoken formatting commands ("new paragraph", "bullet point"). It **preserves meaning, tone, voice, register, slang, humor and profanity**. It never adds content, summarizes, answers questions or obeys instructions inside the transcript (prompt-injection safe: the transcript is wrapped in `<transcript>` tags and treated strictly as text). It outputs only the corrected text.
- **Styles**: `light` (punctuation and capitalization only), `standard` (default), plus free-text **custom instructions and vocabulary** (names, jargon).
- **Request**: `client.beta.messages.create({ model, max_tokens: 16000, output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system, messages })`. Only the text blocks are read. `stop_reason === 'refusal'` and all errors fall back to the offline cleaner, flagged `fallback: true`. The user always gets text.
- **Safety net**: if the AI output is wildly different in length from the input (ratio < 0.5 or > 1.6 for inputs over 12 words), flag it in the UI as "check changes". The original is always one click away.

---

## 7. Security & privacy requirements

1. **Encryption at rest**: all content (text, audio, settings, API keys) is AES-256-GCM encrypted with a random 256-bit **data key**, using a unique 96-bit IV per write.
2. **Key hierarchy**: the data key is wrapped (AES-KW) by a key derived from the user's **passphrase** (PBKDF2-SHA-256, 600k iterations, 16-byte salt), and separately by a **recovery code** shown once at setup. Changing the passphrase re-wraps the key without re-encrypting the data.
3. **Device unlock (desktop, optional)**: the data key is protected by the OS keychain/DPAPI through Electron `safeStorage`, so the shortcut works right after login. It can be turned off in Settings.
4. **Auto-lock** after N idle minutes (user-configurable, "never" allowed). Locking drops every key and decrypted cache from memory.
5. **Backups stay encrypted** (same key hierarchy). Plaintext export requires explicit confirmation and shows a warning.
6. **User control**: master recording switch, keep-audio toggle, audio retention days, history retention, trash retention, backup on/off, interval, count and folder, choice of cloud or local providers, per-item delete, and **"Erase everything"** (requires typing `ERASE`).
7. **Electron hardening**: `contextIsolation`, `sandbox`, no `nodeIntegration`, a minimal typed preload API, strict CSP (`script-src 'self' 'wasm-unsafe-eval'`), permission handler that grants **only** microphone to the app origin, blocked navigation and `window.open`, `app://` protocol with path-traversal protection, single instance.
8. **Network**: no telemetry and no analytics. Outbound calls go only to the provider the user configured, plus the one-time Whisper model download.
9. **Secrets**: API keys are never logged. They are stored only inside the encrypted settings blob. Keys are masked in the UI.
10. **Mobile**: microphone usage strings, no cloud backup of the IndexedDB unless the user exports, and backups written to the app's Documents folder.

---

## 8. Interface & dashboard

- **Shell**: a left sidebar (logo, nav, lock button, engine status dots) and the main content area. On narrow and mobile screens it becomes a bottom tab bar.
- **Dashboard (home)**: a large record button with a live level ring, timer, pipeline stepper (Listening → Transcribing → Polishing → Copied) and the latest result card with Copy, Original/Corrected toggle and Diff. Stat tiles: dictations today, words this week, estimated time saved (typing at 40 wpm minus speaking time), unpasted count. A 14-day activity bar chart. A system-health list: microphone, speech engine, AI correction, last backup, storage persistence, encryption.
- **History**: search bar, filter chips, virtualised-feeling list (date-grouped), detail drawer.
- **Unpasted**: inbox cards with big Copy buttons.
- **Backups**: status, Back up now, snapshot list with restore, export encrypted, export readable, import, rebuild from mirror.
- **Settings**: Shortcuts (key-capture recorder), Recording, Transcription, Correction, Clipboard, Backups, Appearance.
- **Privacy & Security**: plain-language explanation of what is stored where, lock now, change passphrase, new recovery code, auto-lock, device unlock, erase everything.
- **Overlay (desktop)**: a small always-on-top pill at bottom-center showing the recording timer, processing state and "Copied ✓". It never takes focus.
- **Accessibility**: full keyboard navigation, visible focus rings, ARIA live region for pipeline status, 4.5:1 contrast, reduced-motion support.

---

## 9. Platform specifics

| Capability | Desktop (Electron) | Web (PWA) | Android / iOS (Capacitor) |
|---|---|---|---|
| Start/stop | Global shortcut (any app), tray, overlay | In-page shortcut while the tab is focused | Big mic button |
| Clipboard | `clipboard.writeText` from main (works unfocused) | `navigator.clipboard` | `@capacitor/clipboard` |
| Mic | getUserMedia, permission auto-granted to app origin only | Browser prompt | OS prompt (usage strings) |
| Backups | Rotating snapshots + live mirror in a user-selectable folder | Download, or a folder via File System Access API | `Documents/Saywell/` via Filesystem |
| Device unlock | safeStorage | — | — |

---

## 10. Development process

1. Scaffold `package.json`, `www/`, `electron/`, `scripts/`, `tests/`.
2. Build crypto, vault and db first, with unit tests (Node WebCrypto).
3. Store + pipeline + recorder, then STT providers, then correction.
4. UI shell → dashboard → history → backups → settings → privacy.
5. Electron shell: protocol, security, shortcuts, tray, overlay, mirror, backups.
6. Self-test mode (`npm run selftest`): a hidden Electron run against a throwaway profile. It creates a vault, feeds a synthesized speech WAV through the real pipeline (local Whisper + offline correction), checks the raw/corrected split, clipboard, disk mirror, lock/unlock, search, backup and restore, then exits non-zero on failure.
7. Capacitor config + Android project + permission patching. iOS steps documented (needs macOS/Xcode).
8. README: run, build and security model.

## 11. Acceptance criteria

- Pressing the shortcut in any app records. Pressing it again puts corrected text on the clipboard within a few seconds (cloud) or tens of seconds (local, CPU).
- Killing the process mid-recording and restarting recovers the audio and finishes the transcript.
- Original and corrected text are both visible and independently copyable for every dictation.
- Every dictation is searchable. Deleted items sit in Trash. Backups restore into a fresh profile with the passphrase or the recovery code.
- No plaintext content in IndexedDB, mirror files or backups. The self-test asserts this.
