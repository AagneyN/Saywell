// Local Whisper speech-to-text, off the UI thread. Model weights download once from the
// Hugging Face hub and are cached by the browser; audio never leaves the device.

import { pipeline, env } from '../../vendor/transformers.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1; // no cross-origin isolation required

const pipes = new Map();

async function getPipe(model, device) {
  const key = `${model}|${device}`;
  if (!pipes.has(key)) {
    pipes.set(key, pipeline('automatic-speech-recognition', model, {
      device,
      dtype: device === 'webgpu' ? 'fp32' : 'q8',
      progress_callback: (p) => {
        if (p.status === 'progress' || p.status === 'done' || p.status === 'initiate') {
          self.postMessage({ type: 'progress', file: p.file, progress: p.progress ?? (p.status === 'done' ? 100 : 0), status: p.status });
        }
      },
    }).catch((e) => { pipes.delete(key); throw e; }));
  }
  return pipes.get(key);
}

self.onmessage = async ({ data }) => {
  const { id, type, model, audio, language, device = 'wasm' } = data;
  try {
    if (type === 'preload') {
      await getPipe(model, device);
      self.postMessage({ type: 'ready', id });
      return;
    }
    const asr = await getPipe(model, device);
    const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false };
    if (!model.endsWith('.en')) {
      opts.task = 'transcribe';
      if (language && language !== 'auto') opts.language = language;
    }
    const out = await asr(audio, opts);
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text) || '';
    self.postMessage({ type: 'result', id, text: text.trim() });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err?.message || String(err) });
  }
};
