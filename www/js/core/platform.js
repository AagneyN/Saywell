// One bridge over the three runtimes. Electron exposes window.saywellNative via a
// sandboxed preload; Capacitor exposes window.Capacitor; otherwise we are a plain browser/PWA.

const native = globalThis.saywellNative ?? null;
const cap = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor : null;

export const platform = {
  kind: native ? 'desktop' : cap ? cap.getPlatform() : 'web', // 'desktop' | 'android' | 'ios' | 'web'
  native,
  get isDesktop() { return !!native; },
  get isMobile() { return !!cap; },
  get hasGlobalShortcuts() { return !!native; },

  async copy(text) {
    if (native) { await native.clipboardWrite(text); return true; }
    if (cap?.Plugins?.Clipboard) { await cap.Plugins.Clipboard.write({ string: text }); return true; }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for unfocused documents / older WebViews.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  },

  overlay(state) { native?.setOverlay(state); },
  setRecent(items) { native?.setRecent(items); },
  notify(title, body) {
    if (native) return native.notify(title, body);
    if ('Notification' in globalThis && Notification.permission === 'granted' && document.hidden) new Notification(title, { body });
  },

  /** Writes an encrypted backup file to the platform's backup location. Returns a label or null. */
  async writeBackup(name, text, keep) {
    if (native) return native.backupWrite(name, text, keep);
    if (cap?.Plugins?.Filesystem) {
      const fs = cap.Plugins.Filesystem;
      await fs.writeFile({ path: `Saywell/${name}`, data: text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
      try {
        const { files } = await fs.readdir({ path: 'Saywell', directory: 'DOCUMENTS' });
        const backups = files.map((f) => f.name ?? f).filter((n) => n.endsWith('.swbk')).sort();
        for (const old of backups.slice(0, Math.max(0, backups.length - keep))) await fs.deleteFile({ path: `Saywell/${old}`, directory: 'DOCUMENTS' });
      } catch { /* pruning is best-effort */ }
      return `Documents/Saywell/${name}`;
    }
    return null;
  },

  async listBackups() {
    if (native) return native.backupList();
    if (cap?.Plugins?.Filesystem) {
      try {
        const { files } = await cap.Plugins.Filesystem.readdir({ path: 'Saywell', directory: 'DOCUMENTS' });
        return files.filter((f) => (f.name ?? f).endsWith('.swbk')).map((f) => ({ name: f.name ?? f, size: f.size ?? 0, mtime: f.mtime ?? 0 })).sort((a, b) => b.name.localeCompare(a.name));
      } catch { return []; }
    }
    return [];
  },

  async readBackup(name) {
    if (native) return native.backupRead(name);
    if (cap?.Plugins?.Filesystem) {
      const r = await cap.Plugins.Filesystem.readFile({ path: `Saywell/${name}`, directory: 'DOCUMENTS', encoding: 'utf8' });
      return r.data;
    }
    throw new Error('No backup location on this platform');
  },

  /** Save a user-visible file (exports). */
  async saveFile(name, text, mime = 'application/json') {
    if (native) return native.saveFile(name, text);
    if (cap?.Plugins?.Filesystem) {
      await cap.Plugins.Filesystem.writeFile({ path: `Saywell/${name}`, data: text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
      return `Documents/Saywell/${name}`;
    }
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return name;
  },

  // Live encrypted mirror (desktop only)
  mirrorPut(store, key, value) { return native?.mirrorPut(store, key, value); },
  mirrorDelete(store, key) { return native?.mirrorDelete(store, key); },
  mirrorList() { return native ? native.mirrorList() : Promise.resolve([]); },
  mirrorClear() { return native?.mirrorClear(); },

  // Device unlock (desktop only; OS keychain / DPAPI via Electron safeStorage)
  deviceKeyAvailable() { return native ? native.deviceKeyAvailable() : Promise.resolve(false); },
  deviceKeyGet() { return native ? native.deviceKeyGet() : Promise.resolve(null); },
  deviceKeySet(b64) { return native?.deviceKeySet(b64); },
};
