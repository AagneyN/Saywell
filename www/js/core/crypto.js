// Saywell crypto primitives — WebCrypto only (works in browsers, Electron, Capacitor, Node 20+).
// AES-256-GCM for content, PBKDF2-SHA-256 for passphrase stretching, AES-KW for key wrapping.

const subtle = globalThis.crypto.subtle;
export const PBKDF2_ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

/** Fresh random data key. Extractable so it can be wrapped (passphrase / recovery / device). */
export async function generateDataKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function deriveKek(secret, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

export async function wrapDataKey(dataKey, kek) {
  return toB64(await subtle.wrapKey('raw', dataKey, kek, 'AES-KW'));
}

export async function unwrapDataKey(wrappedB64, kek) {
  return subtle.unwrapKey('raw', fromB64(wrappedB64), kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportRawKey(key) {
  return toB64(await subtle.exportKey('raw', key));
}

export async function importRawKey(b64) {
  return subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Encrypt bytes; returns {iv, ct} base64. `aad` binds ciphertext to its record id. */
export async function encryptBytes(key, bytes, aad) {
  const iv = randomBytes(12);
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = enc.encode(aad);
  const ct = await subtle.encrypt(params, key, bytes);
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptBytes(key, { iv, ct }, aad) {
  const params = { name: 'AES-GCM', iv: fromB64(iv) };
  if (aad) params.additionalData = enc.encode(aad);
  return new Uint8Array(await subtle.decrypt(params, key, fromB64(ct)));
}

export async function encryptJSON(key, obj, aad) {
  return encryptBytes(key, enc.encode(JSON.stringify(obj)), aad);
}

export async function decryptJSON(key, box, aad) {
  return JSON.parse(dec.decode(await decryptBytes(key, box, aad)));
}

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
/** Human-friendly recovery code, 25 chars of entropy (~125 bits) in 5 groups. */
export function generateRecoveryCode() {
  const bytes = randomBytes(25);
  const chars = Array.from(bytes, (b) => B32[b % 32]).join('');
  return chars.match(/.{5}/g).join('-');
}

export function normalizeRecoveryCode(code) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,5}/g)?.join('-') ?? '';
}
