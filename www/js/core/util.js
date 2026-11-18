export class Emitter {
  #handlers = new Map();
  on(evt, fn) {
    if (!this.#handlers.has(evt)) this.#handlers.set(evt, new Set());
    this.#handlers.get(evt).add(fn);
    return () => this.#handlers.get(evt)?.delete(fn);
  }
  emit(evt, data) {
    for (const fn of this.#handlers.get(evt) ?? []) {
      try { fn(data); } catch (e) { console.error(`[${evt}] handler failed`, e); }
    }
  }
}

/** Time-sortable unique id (base36 ms timestamp + 64 bits random). */
export function newId() {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  return Date.now().toString(36).padStart(9, '0') + '-' + rand;
}

export function wordCount(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function fold(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
