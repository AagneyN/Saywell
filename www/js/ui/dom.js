// Tiny DOM helpers: safe HTML templating, icons, toasts, modals, formatters.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Raw (trusted) HTML marker for the html`` template. */
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

/** Tagged template that escapes every interpolation unless wrapped in raw(). Arrays are joined. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return raw(out);
}
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, content) { el.innerHTML = String(content); return el; }

const P = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  backup: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  wand: '<path d="m15 4 1.5 1.5M19 8l1.5 1.5M4 20 15 9M14 3v2M20 9h2M18 4l2-2"/>',
  upload: '<path d="M12 21V9m0 0-4 4m4-4 4 4"/><path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  restore: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  play: '<path d="m7 4 13 8-13 8Z"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
};
export const icon = (name, extra = '') => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ''}</svg>`);

export function toast(message, { type = '', timeout = 4500, action } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button data-act>${esc(action.label)}</button>` : ''}<button aria-label="Dismiss" data-x>✕</button>`;
  el.querySelector('[data-x]').onclick = () => el.remove();
  if (action) el.querySelector('[data-act]').onclick = () => { action.run(); el.remove(); };
  document.getElementById('toasts').appendChild(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

export function announce(msg) {
  const el = document.getElementById('sr-status');
  if (el) { el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 30); }
}

/** Generic modal. `body` is html``; returns {el, close}. */
export function modal(body, { onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${body}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  setTimeout(() => bg.querySelector('input, textarea, button.primary, button')?.focus(), 20);
  return { el: bg.firstElementChild, close };
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false, typeToConfirm }) {
  return new Promise((resolve) => {
    let settled = false;
    const { el, close } = modal(html`
      <h2>${title}</h2><p class="muted">${message}</p>
      ${typeToConfirm ? html`<label class="field"><span>Type <b>${typeToConfirm}</b> to confirm</span><input class="input" data-type autocomplete="off"></label>` : ''}
      <div class="row end"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-yes ${typeToConfirm ? 'disabled' : ''}>${confirm}</button></div>`,
    { onClose: () => { if (!settled) resolve(false); } });
    const yes = el.querySelector('[data-yes]');
    el.querySelector('[data-type]')?.addEventListener('input', (e) => { yes.disabled = e.target.value !== typeToConfirm; });
    el.querySelector('[data-no]').onclick = () => close();
    yes.onclick = () => { settled = true; close(); resolve(true); };
  });
}

export function promptDialog({ title, message = '', label, type = 'text', confirm = 'OK', placeholder = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const { el, close } = modal(html`
      <h2>${title}</h2>${message ? html`<p class="muted">${message}</p>` : ''}
      <form class="field" data-f><span>${label}</span><input class="input" type="${type}" placeholder="${placeholder}" autocomplete="off" required></form>
      <div class="row end"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>${confirm}</button></div>`,
    { onClose: () => { if (!settled) resolve(null); } });
    const input = el.querySelector('input');
    const submit = (e) => { e?.preventDefault(); if (!input.value) return; settled = true; close(); resolve(input.value); };
    el.querySelector('[data-f]').onsubmit = submit;
    el.querySelector('[data-yes]').onclick = submit;
    el.querySelector('[data-no]').onclick = () => close();
  });
}

// ---- formatters ----
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
export function fmtDate(ts) { return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
export function fmtAgo(ts) {
  if (!ts) return 'never';
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  return `${Math.floor(d / 86_400_000)} d ago`;
}
export function dayLabel(ts) {
  const d = new Date(ts); const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.floor((t.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: diff < 7 ? 'long' : undefined, month: 'short', day: 'numeric', year: d.getFullYear() !== t.getFullYear() ? 'numeric' : undefined });
}
export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** Render an Electron accelerator as <kbd> keys. */
export function keys(accel) {
  if (!accel) return html`<span class="faint">not set</span>`;
  const mac = /Mac/.test(navigator.platform);
  const parts = accel.split('+').map((k) => ({ CommandOrControl: mac ? '⌘' : 'Ctrl', Control: 'Ctrl', Command: '⌘', Alt: mac ? '⌥' : 'Alt', Shift: mac ? '⇧' : 'Shift', Super: 'Win' }[k] || k));
  return html`<span class="kbd">${parts.map((p) => html`<kbd>${p}</kbd>`)}</span>`;
}

export function highlight(text, terms) {
  let out = esc(text);
  for (const t of terms) {
    if (!t) continue;
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return raw(out);
}
