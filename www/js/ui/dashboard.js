// Home: recorder, latest result, stats, activity chart, system health.

import { html, mount, $, $$, icon, toast, keys, fmtDuration, fmtAgo, fmtTime, raw, esc } from './dom.js';
import { pipeline } from '../core/pipeline.js';
import { store } from '../core/store.js';
import { settings } from '../core/settings.js';
import { platform } from '../core/platform.js';
import { sttEvents } from '../core/stt.js';
import { wordDiff } from '../core/diff.js';
import { wordCount } from '../core/util.js';

export function renderDashboard(root, ctx) {
  let tab = 'corrected';
  let timerInt = 0;
  const offs = [];

  mount(root, html`<div class="page">
    <div class="page-head"><div><h1>Dictate</h1><p class="muted">Press your shortcut anywhere, speak, and the polished text lands on your clipboard.</p></div></div>
    <div class="grid main-side">
      <div class="grid">
        <section class="card" data-rec-card></section>
        <section class="card" data-latest></section>
      </div>
      <div class="grid">
        <section class="card"><h2>System health</h2><div class="health" data-health></div></section>
        <section class="card" data-model hidden></section>
      </div>
    </div>
    <div class="grid cols-4" data-stats></div>
    <section class="card"><div class="row"><h2>Last 14 days</h2><span class="spacer"></span><span class="faint">dictations per day</span></div><div data-chart></div></section>
  </div>`);

  const recCard = $('[data-rec-card]', root);
  function renderRecorder() {
    const st = pipeline.state;
    const s = settings.get();
    const recording = st.phase === 'recording';
    const busy = st.phase === 'processing' || st.phase === 'starting' || pipeline.processing.size > 0;
    const stage = recording ? 'recording' : [...pipeline.processing.values()][0] || (st.phase === 'processing' ? 'saving' : '');
    const steps = [['recording', 'Listening'], ['transcribing', 'Transcribing'], ['correcting', 'Polishing'], ['done', 'Copied']];
    const order = { recording: 0, saving: 0.5, transcribing: 1, correcting: 2, done: 3 };
    const cur = stage ? order[stage] : -1;
    mount(recCard, html`<div class="recorder ${recording ? 'recording' : busy ? 'processing' : ''}">
      <div class="mic-wrap"><div class="mic-ring" data-ring></div>
        <button class="mic-btn" data-mic aria-label="${recording ? 'Stop dictation' : 'Start dictation'}" ${!s.recording.enabled ? 'disabled' : ''}>${icon(recording ? 'stop' : 'mic')}</button></div>
      <div class="rec-info">
        <div class="rec-title">${!s.recording.enabled ? 'Recording is turned off' : recording ? 'Listening…' : busy ? 'Working on it…' : 'Ready when you are'}</div>
        ${recording ? html`<div class="timer num" data-timer>0:00</div>` : html`<div class="row muted">${platform.hasGlobalShortcuts ? 'Global shortcut' : 'Shortcut (this tab)'} ${keys(s.shortcuts.toggle)}</div>`}
        <div class="stepper">${steps.map(([k, label]) => {
          const i = order[k];
          const cls = cur > i || (k === 'done' && cur === 3) ? 'done' : Math.floor(cur) === i && cur !== 3 ? 'active' : '';
          return html`<span class="step ${cls}"><span class="dot"></span>${label}</span>`;
        })}</div>
        <div class="row"><button class="btn sm ghost" data-file>${icon('upload')} Transcribe an audio file</button></div>
      </div></div>`);
    $('[data-mic]', recCard).onclick = () => ctx.toggleRecording();
    $('[data-file]', recCard).onclick = () => pickAudio();
    clearInterval(timerInt);
    if (recording) {
      const t = $('[data-timer]', recCard);
      const tick = () => { t.textContent = fmtDuration(Date.now() - st.startedAt); };
      tick();
      timerInt = setInterval(tick, 250);
    }
  }

  async function pickAudio() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,video/webm,.m4a,.mp3,.wav,.ogg,.webm';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      toast(`Transcribing ${f.name}…`);
      try { await pipeline.ingest(f, { title: f.name }); toast('File transcribed and saved to history.', { type: 'ok' }); }
      catch (e) { toast(e.message, { type: 'error' }); }
    };
    input.click();
  }

  const latestEl = $('[data-latest]', root);
  function renderLatest() {
    const r = store.live()[0];
    if (!r) {
      mount(latestEl, html`<div class="empty">${icon('mic')}<h3>No dictations yet</h3><p>Your first one will appear here, and stay in your history forever unless you delete it.</p></div>`);
      return;
    }
    const corrected = r.correctedText || '';
    const original = r.rawText || '';
    const c = r.correction || {};
    let body;
    if (r.status === 'failed') body = html`<div class="note">${icon('alert')}<div><b>${r.error?.stage === 'transcribing' ? 'Transcription failed' : 'Processing failed'}.</b> ${r.error?.message || ''} Your audio is safe. <button class="linkbtn" data-retry>Try again</button></div></div>`;
    else if (r.status !== 'done') body = html`<div class="textbox muted">${r.status === 'recording' ? 'Recording…' : r.status === 'correcting' ? original || 'Polishing…' : 'Transcribing…'}</div>`;
    else if (tab === 'original') body = html`<div class="textbox original">${original || '—'}</div>`;
    else if (tab === 'diff') body = html`<div class="textbox">${diffHtml(original, corrected)}</div>`;
    else body = html`<div class="textbox">${corrected || original || '—'}</div>`;
    mount(latestEl, html`
      <div class="row"><h2>Latest dictation</h2><span class="faint">${fmtTime(r.createdAt)} · ${fmtDuration(r.durationMs)} · ${wordCount(corrected || original)} words</span><span class="spacer"></span>
        <div class="tabs" role="tablist">${[['corrected', 'Corrected'], ['original', 'Original'], ['diff', 'Changes']].map(([k, l]) => html`<button class="tab ${tab === k ? 'active' : ''}" data-tab="${k}" role="tab">${l}</button>`)}</div></div>
      ${c.note ? html`<div class="note" style="margin-top:12px">${icon('alert')}<span>${c.note}</span></div>` : ''}
      ${c.flagged ? html`<div class="note" style="margin-top:12px">${icon('alert')}<span>The corrected text differs a lot in length from what you said. Check the <b>Changes</b> tab.</span></div>` : ''}
      <div style="margin-top:12px">${body}</div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" data-copy ${!(corrected || original) ? 'disabled' : ''}>${icon('copy')} Copy corrected</button>
        <button class="btn" data-copy-orig ${!original ? 'disabled' : ''}>Copy original</button>
        <span class="spacer"></span>
        ${r.copiedAt ? html`<span class="pill ok">${icon('check')} copied ${fmtAgo(r.copiedAt)}</span>` : ''}
        <button class="btn ghost sm" data-open>Open in history →</button>
      </div>`);
    $$('[data-tab]', latestEl).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderLatest(); }));
    $('[data-copy]', latestEl).onclick = () => ctx.copyDictation(r.id, 'corrected');
    $('[data-copy-orig]', latestEl).onclick = () => ctx.copyDictation(r.id, 'original');
    $('[data-open]', latestEl).onclick = () => ctx.navigate('history', { select: r.id });
    $('[data-retry]', latestEl)?.addEventListener('click', () => pipeline.retry(r.id).catch((e) => toast(e.message, { type: 'error' })));
  }

  function renderStats() {
    const s = store.stats();
    mount($('[data-stats]', root), html`
      <div class="card stat"><span class="l">Today</span><span class="v">${s.today}</span><span class="s">dictations</span></div>
      <div class="card stat"><span class="l">This week</span><span class="v">${s.weekWords.toLocaleString()}</span><span class="s">words dictated</span></div>
      <div class="card stat"><span class="l">Time saved</span><span class="v">${s.savedMin >= 60 ? `${(s.savedMin / 60).toFixed(1)} h` : `${Math.round(s.savedMin)} min`}</span><span class="s">vs. typing at 40 wpm</span></div>
      <div class="card stat"><span class="l">Unpasted</span><span class="v" style="color:${s.unpasted ? 'var(--coral)' : 'inherit'}">${s.unpasted}</span><span class="s"><button class="linkbtn" data-inbox>Review inbox →</button></span></div>`);
    $('[data-inbox]', root).onclick = () => ctx.navigate('inbox');
    const max = Math.max(1, ...s.days.map((d) => d.count));
    mount($('[data-chart]', root), html`<div class="chart" role="img" aria-label="Dictations per day over the last 14 days">${s.days.map((d, i) => html`<div class="bar ${i === 13 ? 'today' : ''}" style="height:${Math.max(2, (d.count / max) * 100)}%" title="${d.day.toLocaleDateString()}: ${d.count} dictations, ${d.words} words"></div>`)}</div>
      <div class="chart-x">${s.days.map((d, i) => html`<span>${i % 2 === 1 || i === 13 ? d.day.toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''}</span>`)}</div>`);
  }

  async function renderHealth() {
    const h = await ctx.health();
    mount($('[data-health]', root), html`${h.map((x) => html`<div><span class="dot ${x.state}"></span><span>${x.label}</span><span class="v">${x.value}</span></div>`)}`);
  }

  const modelEl = $('[data-model]', root);
  const files = new Map();
  offs.push(sttEvents.on('model-progress', (p) => {
    if (!p.file) return;
    files.set(p.file, p.progress || 0);
    const vals = [...files.values()];
    const pct = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    modelEl.hidden = pct >= 100;
    mount(modelEl, html`<h2>Downloading speech model</h2><p class="muted" style="margin:6px 0 10px">One-time download. After this, transcription runs fully on this device.</p>
      <div style="height:8px;border-radius:99px;background:var(--surface-2);overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--violet)"></div></div><p class="faint" style="margin-top:6px">${pct}%</p>`);
  }));

  const ring = () => $('[data-ring]', recCard);
  offs.push(pipeline.on('level', (l) => ring()?.style.setProperty('--level', l.toFixed(3))));
  offs.push(pipeline.on('state', () => renderRecorder()));
  offs.push(pipeline.on('progress', () => { renderRecorder(); renderLatest(); }));
  let pending = 0;
  offs.push(store.on('change', () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => { renderLatest(); renderStats(); });
  }));
  offs.push(settings.on('change', () => { renderRecorder(); renderHealth(); }));

  renderRecorder();
  renderLatest();
  renderStats();
  renderHealth();
  const hInt = setInterval(renderHealth, 30_000);

  return () => { offs.forEach((f) => f()); clearInterval(timerInt); clearInterval(hInt); };
}

export function diffHtml(a, b) {
  return raw(wordDiff(a, b).map((p) => (p.type === 'same' ? esc(p.text) : p.type === 'add' ? `<ins>${esc(p.text)}</ins>` : `<del>${esc(p.text)}</del>`)).join(''));
}
