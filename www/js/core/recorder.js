// Microphone capture. Emits 1-second chunks; the caller persists each chunk before the next
// arrives, so a crash loses at most ~1 s of audio. onChunk calls are serialized and stop()
// resolves only after every chunk has been handed over AND persisted.

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export class Recorder {
  #stream = null;
  #mr = null;
  #ctx = null;
  #raf = 0;
  #chain = Promise.resolve();
  #seq = 0;
  mime = '';

  static pickMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
  }

  async start({ onChunk, onLevel, onError }) {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.mime = Recorder.pickMime();
    this.#mr = new MediaRecorder(this.#stream, this.mime ? { mimeType: this.mime, audioBitsPerSecond: 64000 } : undefined);
    this.mime = this.#mr.mimeType || this.mime || 'audio/webm';
    this.#seq = 0;
    this.#mr.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const seq = this.#seq++;
      this.#chain = this.#chain
        .then(async () => onChunk(seq, new Uint8Array(await e.data.arrayBuffer()), this.mime))
        .catch((err) => onError?.(err));
    };
    this.#mr.start(1000);

    if (onLevel) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.#ctx = new Ctx();
      const src = this.#ctx.createMediaStreamSource(this.#stream);
      const an = this.#ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const data = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
        this.#raf = requestAnimationFrame(tick);
      };
      tick();
    }
  }

  get active() { return this.#mr?.state === 'recording'; }

  async stop() {
    if (!this.#mr) return { chunks: this.#seq, mime: this.mime };
    const stopped = new Promise((r) => { this.#mr.onstop = r; });
    if (this.#mr.state !== 'inactive') this.#mr.stop();
    await stopped;
    await this.#chain; // every chunk persisted
    cancelAnimationFrame(this.#raf);
    this.#ctx?.close?.();
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#mr = null;
    return { chunks: this.#seq, mime: this.mime };
  }
}
