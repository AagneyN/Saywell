// History (full-text search + detail), Unpasted inbox, and Trash.

import { html, mount, $, $$, icon, toast, confirmDialog, fmtDuration, fmtDate, fmtTime, fmtAgo, dayLabel, highlight, raw } from './dom.js';
import { store, parseQuery } from '../core/store.js';
import { pipeline } from '../core/pipeline.js';
import { platform } from '../core/platform.js';
import { diffHtml } from './dashboard.js';
import { wordCount } from '../core/util.js';

const STATUS = {
  done: ['Done', 'ok'], failed: ['Failed', 'bad'], recording: ['Recording', 'warn'], recorded: ['Queued', 'warn'],
  transcribing: ['Transcribing', 'violet'], transcribed: ['Transcribed', 'violet'], correcting: ['Polishing', 'violet'],
};

function statusPill(r) {
  const [label, cls] = STATUS[r.status] || [r.status, ''];
  return html`<span class="pill ${cls}">${label}</span>`;
}

function itemCard(r, { active, terms = [] }) {
  const text = r.correctedText || r.rawText || (r.status === 'failed' ? r.error?.message : 'Processing…') || '';
  return html`<button class="item ${active ? 'active' : ''}" data-id="${r.id}">
    <div class="top"><span>${fmtTime(r.createdAt)}</span>${statusPill(r)}${r.pinned ? html`<span class="pill violet">Pinned</span>` : ''}${r.status === 'done' && !r.usedAt ? html`<span class="pill warn">Unpasted</span>` : ''}${r.interrupted ? html`<span class="pill">Recovered</span>` : ''}<span class="spacer"></span><span>${fmtDuration(r.durationMs)}</span></div>
    <div class="title">${highlight(r.title || 'Dictation', terms)}</div>
    <div class="snippet">${highlight(text.slice(0, 280), terms)}</div>
  </button>`;
}

export function renderHistory(root, ctx, { select } = {}) {
  const st = { query: '', filter: 'all', selected: select || null, tab: 'corrected', editing: false };
  const offs = [];
  mount(root, html`<div class="page">
    <div class="page-head"><div><h1>History</h1><p class="muted">Every dictation, original and corrected, encrypted and searchable.</p></div></div>
    <div class="searchbar"><input class="input" type="search" placeholder="Search everything you've said…  (use &quot;quotes&quot; for phrases)" data-q aria-label="Search dictations">
      <div class="chips">${[['all', 'All'], ['pinned', 'Pinned'], ['unpasted', 'Unpasted'], ['audio', 'Has audio'], ['failed', 'Failed']].map(([k, l]) => html`<button class="chip ${k === 'all' ? 'active' : ''}" data-filter="${k}">${l}</button>`)}</div></div>
    <div class="history"><div><div class="faint" data-count></div><div class="list" data-list></div></div><aside class="detail" data-detail></aside></div>
  </div>`);

  const listEl = $('[data-list]', root);
  const detailEl = $('[data-detail]', root);
  const q = $('[data-q]', root);
  let deb = 0;
  q.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { st.query = q.value; renderList(); }, 80); });
  $$('[data-filter]', root).forEach((b) => (b.onclick = () => {
    st.filter = b.dataset.filter;
    $$('[data-filter]', root).forEach((x) => x.classList.toggle('active', x === b));
    renderList();
  }));

  function renderList() {
    const terms = parseQuery(st.query);
    const rows = store.search(st.query, { filter: st.filter });
    $('[data-count]', root).textContent = `${rows.length} ${rows.length === 1 ? 'dictation' : 'dictations'}${st.query ? ' match' : ''}`;
    if (!rows.length) {
      mount(listEl, html`<div class="empty card flat">${icon('search')}<h3>${st.query ? 'Nothing matches' : 'No dictations here yet'}</h3><p>${st.query ? 'Try fewer words, or check Trash.' : 'Press your shortcut to dictate.'}</p></div>`);
    } else {
      let last = '';
      const parts = [];
      for (const r of rows.slice(0, 500)) {
        const d = dayLabel(r.createdAt);
        if (d !== last) { parts.push(html`<div class="group-label">${d}</div>`); last = d; }
        parts.push(itemCard(r, { active: r.id === st.selected, terms }));
      }
      if (rows.length > 500) parts.push(html`<p class="faint">Showing the newest 500. Refine your search to see older items.</p>`);
      mount(listEl, html`${parts}`);
      $$('.item', listEl).forEach((b) => (b.onclick = () => { st.selected = b.dataset.id; st.editing = false; renderList(); renderDetail(); }));
    }
    if (!st.selected && rows[0] && matchMedia('(min-width: 1001px)').matches) { st.selected = rows[0].id; renderDetail(); }
  }

  function renderDetail() {
    const r = st.selected && store.get(st.selected);
    if (!r) { mount(detailEl, html`<div class="card empty">${icon('history')}<p>Select a dictation to see both versions, play the audio and recover it.</p></div>`); return; }
    detailEl.innerHTML = String(detailView(r, st));
    wireDetail(detailEl, r, st, ctx, { rerender: () => { renderList(); renderDetail(); } });
  }

  offs.push(store.on('change', () => { if (!st.editing) { renderList(); renderDetail(); } }));
  renderList();
  renderDetail();
  if (select) setTimeout(() => $(`.item[data-id="${CSS.escape(select)}"]`, listEl)?.scrollIntoView({ block: 'center' }), 50);
  setTimeout(() => q.focus(), 30);
  return () => offs.forEach((f) => f());
}

function detailView(r, st) {
  const c = r.correction || {};
  const s = r.stt || {};
  const corrected = r.correctedText || '';
  const original = r.rawText || '';
  let body;
  if (st.tab === 'original') body = html`<div class="textbox original">${original || '—'}</div>`;
  else if (st.tab === 'diff') body = html`<div class="textbox">${diffHtml(original, corrected)}</div>`;
  else if (st.editing) body = html`<textarea class="input" rows="8" data-edit>${corrected || original}</textarea><div class="row end"><button class="btn sm" data-cancel>Cancel</button><button class="btn sm primary" data-save>Save as new version</button></div>`;
  else body = html`<div class="textbox">${corrected || original || '—'}</div>`;
  return html`<section class="card grid" style="gap:14px">
    <div class="row"><h2 style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${r.title || 'Dictation'}</h2>${statusPill(r)}</div>
    ${r.status === 'failed' ? html`<div class="note">${icon('alert')}<div><b>Failed while ${r.error?.stage || 'processing'}:</b> ${r.error?.message || ''}<br>Nothing is lost. The audio is kept so you can retry.</div></div>` : ''}
    ${c.note ? html`<div class="note">${icon('alert')}<span>${c.note}</span></div>` : ''}
    ${r.interrupted ? html`<div class="note info">${icon('shield')}<span>Recovered after an unexpected shutdown. Audio saved up to the moment it stopped.</span></div>` : ''}
    <div class="tabs">${[['corrected', 'Corrected'], ['original', 'Original transcript'], ['diff', 'Changes']].map(([k, l]) => html`<button class="tab ${st.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`)}</div>
    ${body}
    <div class="row">
      <button class="btn primary" data-copy ${!(corrected || original) ? 'disabled' : ''}>${icon('copy')} Copy corrected</button>
      <button class="btn" data-copy-orig ${!original ? 'disabled' : ''}>Copy original</button>
      ${st.tab === 'corrected' && !st.editing && r.status === 'done' ? html`<button class="btn icon" title="Edit" aria-label="Edit corrected text" data-editbtn>${icon('edit')}</button>` : ''}
    </div>
    <div class="row">
      ${r.status === 'failed' ? html`<button class="btn sm primary" data-retry>${icon('refresh')} Retry</button>` : ''}
      ${original ? html`<button class="btn sm" data-recorrect>${icon('wand')} Re-correct</button>` : ''}
      ${r.chunkCount && !r.audioPurgedAt ? html`<button class="btn sm" data-retranscribe>${icon('refresh')} Re-transcribe</button>` : ''}
      <button class="btn sm" data-pin>${icon('pin')} ${r.pinned ? 'Unpin' : 'Pin'}</button>
      ${r.status === 'done' && !r.usedAt ? html`<button class="btn sm" data-used>${icon('check')} Mark as used</button>` : ''}
      <span class="spacer"></span>
      <button class="btn sm danger" data-delete>${icon('trash')} Delete</button>
    </div>
    ${r.chunkCount && !r.audioPurgedAt ? html`<div data-audio><button class="btn sm ghost" data-loadaudio>${icon('play')} Play original audio</button></div>` : r.audioPurgedAt ? html`<p class="faint">Audio removed by your retention setting on ${fmtDate(r.audioPurgedAt)}. Text is kept.</p>` : ''}
    <dl class="meta">
      <dt>Recorded</dt><dd>${fmtDate(r.createdAt)} · ${fmtDuration(r.durationMs)}</dd>
      <dt>Words</dt><dd>${wordCount(corrected || original)} (original ${wordCount(original)})</dd>
      <dt>Transcription</dt><dd>${s.provider ? `${s.provider}${s.model ? ` · ${s.model}` : ''}${s.ms ? ` · ${(s.ms / 1000).toFixed(1)} s` : ''}` : '—'}</dd>
      <dt>Correction</dt><dd>${c.provider ? `${c.provider}${c.model ? ` · ${c.model}` : ''}${c.ms ? ` · ${(c.ms / 1000).toFixed(1)} s` : ''}` : '—'}</dd>
      <dt>Clipboard</dt><dd>${r.copiedAt ? `copied ${fmtAgo(r.copiedAt)}` : 'not copied yet'}${r.usedAt ? ' · marked used' : ''}</dd>
      <dt>Versions</dt><dd>${r.versions?.length ? html`<button class="linkbtn" data-versions>${r.versions.length} earlier version${r.versions.length > 1 ? 's' : ''}</button>` : 'none'}</dd>
    </dl>
    <div data-versionlist hidden class="grid" style="gap:8px">${(r.versions || []).slice().reverse().map((v, i) => html`<div class="card flat" style="padding:12px"><div class="row faint"><span>${fmtDate(v.at)} · ${v.source}</span><span class="spacer"></span><button class="btn sm" data-vcopy="${r.versions.length - 1 - i}">Copy</button></div><div style="white-space:pre-wrap;margin-top:6px;font-size:13px">${v.text}</div></div>`)}</div>
  </section>`;
}

function wireDetail(el, r, st, ctx, { rerender }) {
  const on = (sel, fn) => { const b = $(sel, el); if (b) b.onclick = fn; };
  const err = (e) => toast(e.message, { type: 'error' });
  $$('[data-tab]', el).forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; st.editing = false; rerender(); }));
  on('[data-copy]', () => ctx.copyDictation(r.id, 'corrected'));
  on('[data-copy-orig]', () => ctx.copyDictation(r.id, 'original'));
  on('[data-editbtn]', () => { st.editing = true; rerender(); setTimeout(() => $('[data-edit]', el)?.focus(), 20); });
  on('[data-cancel]', () => { st.editing = false; rerender(); });
  on('[data-save]', async () => {
    const text = $('[data-edit]', el).value;
    st.editing = false;
    const versions = [...(r.versions || []), { text: r.correctedText, at: Date.now(), source: r.correction?.provider || 'previous' }];
    await store.update(r.id, { correctedText: text, versions, correction: { ...(r.correction || {}), provider: 'user', model: '', note: '' } });
    toast('Saved. The previous version is kept in the version history.', { type: 'ok' });
  });
  on('[data-retry]', () => pipeline.retry(r.id).catch(err));
  on('[data-recorrect]', () => { toast('Re-correcting…'); pipeline.recorrect(r.id).then(() => toast('Re-corrected. The previous version is kept.', { type: 'ok' })).catch(err); });
  on('[data-retranscribe]', () => { toast('Re-transcribing from the saved audio…'); pipeline.retranscribe(r.id).then(() => toast('Re-transcribed.', { type: 'ok' })).catch(err); });
  on('[data-pin]', () => store.update(r.id, { pinned: !r.pinned }));
  on('[data-used]', () => store.update(r.id, { usedAt: Date.now() }));
  on('[data-delete]', async () => {
    await store.softDelete(r.id);
    st.selected = null;
    toast('Moved to Trash.', { action: { label: 'Undo', run: () => store.restore(r.id) } });
  });
  on('[data-versions]', () => { const v = $('[data-versionlist]', el); v.hidden = !v.hidden; });
  $$('[data-vcopy]', el).forEach((b) => (b.onclick = async () => { await platform.copy(r.versions[+b.dataset.vcopy].text); toast('Version copied.'); }));
  on('[data-loadaudio]', async () => {
    try {
      const blob = await store.getAudioBlob(r.id);
      if (!blob) throw new Error('No audio stored.');
      const url = URL.createObjectURL(blob);
      const box = $('[data-audio]', el);
      box.innerHTML = '';
      const a = document.createElement('audio');
      a.controls = true; a.src = url; a.autoplay = true;
      box.appendChild(a);
    } catch (e) { err(e); }
  });
}

// ---------- Unpasted inbox ----------
export function renderInbox(root, ctx) {
  const offs = [];
  function draw() {
    const items = store.unpasted();
    const failed = store.needsAttention();
    mount(root, html`<div class="page">
      <div class="page-head"><div><h1>Unpasted</h1><p class="muted">Dictations you haven't used yet. Copy one and paste it. Nothing here expires.</p></div><span class="spacer"></span>
        ${items.length ? html`<button class="btn" data-allused>${icon('check')} Mark all as used</button>` : ''}</div>
      ${failed.length ? html`<section class="card grid"><h2>Needs attention (${failed.length})</h2>${failed.map((r) => html`<div class="row"><span class="pill bad">Failed</span><span style="flex:1;min-width:0" class="muted">${fmtDate(r.createdAt)}: ${r.error?.message || ''}</span><button class="btn sm primary" data-retry="${r.id}">Retry</button><button class="btn sm" data-open="${r.id}">Open</button></div>`)}</section>` : ''}
      ${items.length ? html`<div class="grid">${items.map((r) => html`<section class="card grid" style="gap:10px">
          <div class="row faint"><span>${dayLabel(r.createdAt)}, ${fmtTime(r.createdAt)}</span>${r.copiedAt ? html`<span class="pill">copied ${fmtAgo(r.copiedAt)}</span>` : html`<span class="pill warn">never copied</span>`}<span class="spacer"></span><button class="btn sm ghost" data-open="${r.id}">Details</button></div>
          <div class="textbox" style="max-height:180px">${r.correctedText || r.rawText}</div>
          <div class="row"><button class="btn primary" data-copy="${r.id}">${icon('copy')} Copy</button><button class="btn" data-used="${r.id}">${icon('check')} Mark as used</button></div>
        </section>`)}</div>`
        : html`<div class="card empty">${icon('check')}<h3>All caught up</h3><p>Every dictation has been used. Tip: copying from Saywell marks it as used automatically.</p></div>`}
    </div>`);
    $$('[data-copy]', root).forEach((b) => (b.onclick = () => ctx.copyDictation(b.dataset.copy, 'corrected', { markUsed: true })));
    $$('[data-used]', root).forEach((b) => (b.onclick = () => store.update(b.dataset.used, { usedAt: Date.now() })));
    $$('[data-open]', root).forEach((b) => (b.onclick = () => ctx.navigate('history', { select: b.dataset.open })));
    $$('[data-retry]', root).forEach((b) => (b.onclick = () => pipeline.retry(b.dataset.retry).catch((e) => toast(e.message, { type: 'error' }))));
    $('[data-allused]', root)?.addEventListener('click', async () => { for (const r of items) await store.update(r.id, { usedAt: Date.now() }); });
  }
  offs.push(store.on('change', draw));
  draw();
  return () => offs.forEach((f) => f());
}

// ---------- Trash ----------
export function renderTrash(root, ctx) {
  const offs = [];
  function draw() {
    const items = store.trash();
    const days = ctx.settings().history.trashRetentionDays;
    mount(root, html`<div class="page">
      <div class="page-head"><div><h1>Trash</h1><p class="muted">${days > 0 ? `Deleted dictations are kept for ${days} days, then permanently erased.` : 'Deleted dictations are kept until you empty the trash.'} Pinned items are never auto-erased.</p></div><span class="spacer"></span>
        ${items.length ? html`<button class="btn danger" data-empty>${icon('trash')} Empty trash</button>` : ''}</div>
      ${items.length ? html`<div class="list">${items.map((r) => html`<div class="item" style="cursor:default"><div class="top"><span>Deleted ${fmtAgo(r.deletedAt)}</span><span class="spacer"></span><span>${fmtDate(r.createdAt)}</span></div>
          <div class="title">${r.title || 'Dictation'}</div><div class="snippet">${(r.correctedText || r.rawText || '').slice(0, 200)}</div>
          <div class="row" style="margin-top:6px"><button class="btn sm" data-restore="${r.id}">${icon('restore')} Restore</button><button class="btn sm danger" data-purge="${r.id}">Delete forever</button></div></div>`)}</div>`
        : html`<div class="card empty">${icon('trash')}<h3>Trash is empty</h3></div>`}
    </div>`);
    $$('[data-restore]', root).forEach((b) => (b.onclick = () => store.restore(b.dataset.restore)));
    $$('[data-purge]', root).forEach((b) => (b.onclick = async () => {
      if (await confirmDialog({ title: 'Delete forever?', message: 'This erases the text, the original transcript and the audio from this device and the live mirror. Existing backup files still contain it.', confirm: 'Delete forever', danger: true })) await store.purge(b.dataset.purge);
    }));
    $('[data-empty]', root)?.addEventListener('click', async () => {
      if (await confirmDialog({ title: `Permanently erase ${items.length} dictations?`, message: 'This cannot be undone (except from an older backup file).', confirm: 'Empty trash', danger: true })) for (const r of items) await store.purge(r.id);
    });
  }
  offs.push(store.on('change', draw));
  draw();
  return () => offs.forEach((f) => f());
}

export { raw };
