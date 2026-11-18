// Minimal, typed bridge. The renderer is sandboxed with contextIsolation; it can only call
// these functions. The main process only ever receives ciphertext for storage.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch, cb) => {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

const api = {
  info: () => invoke('app:info'),
  clipboardWrite: (text) => invoke('clipboard:write', String(text)),
  registerShortcuts: (map) => invoke('shortcuts:set', map),
  getShortcuts: () => invoke('shortcuts:get'),
  suspendShortcuts: (on) => invoke('shortcuts:suspend', !!on),
  onShortcut: (cb) => listen('shortcut', cb),
  onTrayAction: (cb) => listen('tray-action', cb),
  setOverlay: (state) => ipcRenderer.send('overlay:set', state),
  onOverlay: (cb) => listen('overlay:state', cb),
  setRecent: (items) => ipcRenderer.send('recent:set', items),
  setRecordingState: (recording) => ipcRenderer.send('recording:state', !!recording),
  notify: (title, body) => invoke('notify', String(title), String(body || '')),
  showWindow: () => invoke('window:show'),
  setAutostart: (on) => invoke('autostart:set', !!on),
  getAutostart: () => invoke('autostart:get'),

  mirrorPut: (store, key, value) => invoke('mirror:put', store, String(key), value),
  mirrorDelete: (store, key) => invoke('mirror:delete', store, String(key)),
  mirrorList: () => invoke('mirror:list'),
  mirrorClear: () => invoke('mirror:clear'),

  backupWrite: (name, text, keep) => invoke('backup:write', name, text, keep),
  backupList: () => invoke('backup:list'),
  backupRead: (name) => invoke('backup:read', name),
  backupChooseFolder: () => invoke('backup:choose-folder'),
  backupGetFolder: () => invoke('backup:get-folder'),
  backupOpenFolder: () => invoke('backup:open-folder'),
  saveFile: (name, text) => invoke('file:save', name, text),
  openFile: () => invoke('file:open'),

  deviceKeyAvailable: () => invoke('devicekey:available'),
  deviceKeyGet: () => invoke('devicekey:get'),
  deviceKeySet: (b64) => invoke('devicekey:set', b64),

  eraseAll: () => invoke('app:erase-local'),
};

if (process.argv.includes('--saywell-selftest')) {
  api.selftest = {
    audio: () => invoke('selftest:audio'),
    clipboard: () => invoke('selftest:clipboard'),
    screenshot: (name) => invoke('selftest:screenshot', name),
    report: (result) => invoke('selftest:report', result),
    log: (msg) => ipcRenderer.send('selftest:log', String(msg)),
  };
}

contextBridge.exposeInMainWorld('saywellNative', api);
