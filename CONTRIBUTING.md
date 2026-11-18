# Contributing

1. `npm install` (Node 22+). This also bundles browser dependencies into `www/vendor/`.
2. `npm start` for the desktop app, `npm run web` for the browser version.
3. Before opening a PR, run:
   - `npm test`: unit tests
   - `npm run selftest`: end-to-end Electron test (Windows generates its own speech clip; elsewhere,
     put a short spoken WAV mentioning "pineapple" at `tests/fixtures/dictation.wav`)

Guidelines:
- Keep `www/` framework-free ES modules. It must run unbuilt in browsers, Electron and Capacitor.
- Never write plaintext user content to IndexedDB, the disk mirror, backups or logs.
- New Electron IPC must be added to `electron/preload.cjs` explicitly and validate its inputs in `main.js`.
