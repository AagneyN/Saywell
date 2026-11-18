# Security policy

Saywell stores private voice recordings and transcripts, so security reports are taken seriously.

## Reporting a vulnerability
Please **do not open a public issue**. Use GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on this repository). Include steps to reproduce and the affected version.

## Scope
- Encryption at rest (`www/js/core/crypto.js`, `vault.js`, `store.js`, `backup.js`)
- Electron hardening (`electron/main.js`, `electron/preload.cjs`): protocol handler, permissions, IPC surface
- Anything that could leak plaintext dictations, audio or API keys to disk, logs or the network

## Design summary
AES-256-GCM with a random data key; key wrapped by PBKDF2-SHA-256 (600k) from the passphrase and,
separately, from a one-time recovery code; optional OS-keychain wrapping via Electron `safeStorage`.
No telemetry and no Saywell server. See the README for details.
