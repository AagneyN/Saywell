// Thin promise wrapper over IndexedDB. Stores hold only ciphertext + minimal plaintext
// bookkeeping (id, timestamps, status, deleted flag) needed for crash recovery while locked.

const DB_NAME = 'saywell';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('dictations')) {
        const s = db.createObjectStore('dictations', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
        s.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('audio')) {
        const a = db.createObjectStore('audio', { keyPath: ['dictationId', 'seq'] });
        a.createIndex('dictationId', 'dictationId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is open in another window. Close other Saywell tabs.'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, key) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await done(tx); // resolves only once durably committed
}

export async function del(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await done(tx);
}

export async function getAll(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function getAllKeys(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAllKeys());
}

export async function getByIndex(store, index, value) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).index(index).getAll(value));
}

export async function audioFor(dictationId) {
  const rows = await getByIndex('audio', 'dictationId', dictationId);
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function deleteAudioFor(dictationId) {
  const db = await openDB();
  const tx = db.transaction('audio', 'readwrite');
  const idx = tx.objectStore('audio').index('dictationId');
  const keys = await reqP(idx.getAllKeys(dictationId));
  for (const k of keys) tx.objectStore('audio').delete(k);
  await done(tx);
  return keys.length;
}

export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction(['meta', 'dictations', 'audio'], 'readwrite');
  for (const s of ['meta', 'dictations', 'audio']) tx.objectStore(s).clear();
  await done(tx);
}

export async function metaEntries() {
  const db = await openDB();
  const tx = db.transaction('meta');
  const store = tx.objectStore('meta');
  const [keys, values] = await Promise.all([reqP(store.getAllKeys()), reqP(store.getAll())]);
  return keys.map((k, i) => [k, values[i]]);
}
