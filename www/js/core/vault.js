// Key lifecycle. One random AES-256 data key encrypts everything. It is stored only wrapped:
//   - by a PBKDF2 key derived from the user's passphrase,
//   - by a PBKDF2 key derived from a one-time recovery code,
//   - optionally (desktop) by the OS keychain via Electron safeStorage ("device unlock").
// Changing the passphrase re-wraps the key; no content needs re-encrypting.

import * as C from './crypto.js';
import * as db from './db.js';
import { platform } from './platform.js';
import { Emitter } from './util.js';

const VERIFIER = 'saywell-vault-ok';

class Vault extends Emitter {
  #key = null;

  get unlocked() { return !!this.#key; }

  key() {
    if (!this.#key) throw new Error('Vault is locked');
    return this.#key;
  }

  async meta() { return db.get('meta', 'vault'); }
  async isSetUp() { return !!(await this.meta()); }

  async #saveMeta(meta) {
    await db.put('meta', meta, 'vault');
    await platform.mirrorPut('meta', 'vault', meta);
  }

  /** First-run: creates the data key, returns the recovery code (show it once). */
  async setup(passphrase) {
    if (await this.isSetUp()) throw new Error('Vault already exists');
    const dataKey = await C.generateDataKey();
    const recoveryCode = C.generateRecoveryCode();
    const meta = await this.#buildMeta(dataKey, passphrase, recoveryCode);
    await this.#saveMeta(meta);
    this.#key = dataKey;
    this.emit('unlock');
    return recoveryCode;
  }

  async #buildMeta(dataKey, passphrase, recoveryCode, base = {}) {
    const salt = C.randomBytes(16);
    const rsalt = C.randomBytes(16);
    const [kek, rkek] = await Promise.all([C.deriveKek(passphrase, salt), C.deriveKek(C.normalizeRecoveryCode(recoveryCode), rsalt)]);
    return {
      v: 1,
      createdAt: base.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      iterations: C.PBKDF2_ITERATIONS,
      salt: C.toB64(salt),
      wrapped: await C.wrapDataKey(dataKey, kek),
      recoverySalt: C.toB64(rsalt),
      recoveryWrapped: await C.wrapDataKey(dataKey, rkek),
      verifier: await C.encryptJSON(dataKey, VERIFIER, 'verifier'),
    };
  }

  /** Unwrap a data key from any vault meta (current or from a backup file). */
  static async unwrapFrom(meta, secret, useRecovery = false) {
    const salt = C.fromB64(useRecovery ? meta.recoverySalt : meta.salt);
    const kek = await C.deriveKek(useRecovery ? C.normalizeRecoveryCode(secret) : secret, salt, meta.iterations);
    let key;
    try {
      key = await C.unwrapDataKey(useRecovery ? meta.recoveryWrapped : meta.wrapped, kek);
    } catch {
      throw new Error(useRecovery ? 'That recovery code is not correct.' : 'Incorrect passphrase.');
    }
    if ((await C.decryptJSON(key, meta.verifier, 'verifier')) !== VERIFIER) throw new Error('Vault verification failed.');
    return key;
  }

  async unlock(passphrase) {
    const meta = await this.meta();
    this.#key = await Vault.unwrapFrom(meta, passphrase, false);
    this.emit('unlock');
  }

  async unlockWithRecovery(code) {
    const meta = await this.meta();
    this.#key = await Vault.unwrapFrom(meta, code, true);
    this.emit('unlock');
  }

  async unlockWithDevice() {
    const b64 = await platform.deviceKeyGet();
    if (!b64) return false;
    try {
      const key = await C.importRawKey(b64);
      const meta = await this.meta();
      if ((await C.decryptJSON(key, meta.verifier, 'verifier')) !== VERIFIER) return false;
      this.#key = key;
      this.emit('unlock');
      return true;
    } catch {
      await platform.deviceKeySet(null); // stale device key (e.g. vault replaced)
      return false;
    }
  }

  async setDeviceUnlock(enabled) {
    if (enabled) await platform.deviceKeySet(await C.exportRawKey(this.key()));
    else await platform.deviceKeySet(null);
  }

  async verifyPassphrase(passphrase) {
    try { await Vault.unwrapFrom(await this.meta(), passphrase, false); return true; } catch { return false; }
  }

  /** Re-wraps the data key with a new passphrase AND issues a new recovery code. */
  async changePassphrase(newPassphrase) {
    const recoveryCode = C.generateRecoveryCode();
    const meta = await this.#buildMeta(this.key(), newPassphrase, recoveryCode, await this.meta());
    await this.#saveMeta(meta);
    return recoveryCode;
  }

  async regenerateRecovery(passphrase) {
    if (!(await this.verifyPassphrase(passphrase))) throw new Error('Incorrect passphrase.');
    return this.changePassphrase(passphrase);
  }

  /** Adopt a vault from a backup / mirror (fresh profile restore). */
  async adopt(meta, key) {
    await this.#saveMeta(meta);
    this.#key = key;
    this.emit('unlock');
  }

  lock() {
    if (!this.#key) return;
    this.#key = null;
    this.emit('lock');
  }
}

export const vault = new Vault();
export const unwrapFrom = Vault.unwrapFrom;
