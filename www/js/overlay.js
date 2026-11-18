const pill = document.getElementById('pill');
const text = document.getElementById('text');
const time = document.getElementById('time');
let timer = 0;

const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

globalThis.saywellNative?.onOverlay((state) => {
  clearInterval(timer);
  pill.className = `pill on ${state.mode}`;
  time.textContent = '';
  if (state.mode === 'recording') {
    text.textContent = 'Listening — press shortcut to finish';
    const tick = () => { time.textContent = fmt(Date.now() - state.startedAt); };
    tick();
    timer = setInterval(tick, 250);
  } else {
    text.textContent = state.text || (state.mode === 'copied' ? 'Copied ✓' : '');
  }
});
