// Correction step: Claude (official Anthropic SDK, browser build) with an offline fallback
// that always succeeds. The user always ends up with text.

import { buildSystemPrompt, buildUserMessage } from './correction-prompt.js';
import { localCleanup } from './local-cleanup.js';
import { wordCount } from './util.js';

let AnthropicCtor = null;
async function sdk() {
  if (!AnthropicCtor) AnthropicCtor = (await import('../../vendor/anthropic.js')).default;
  return AnthropicCtor;
}

export async function correctText(rawText, cfg) {
  const t0 = performance.now();
  const offline = (reason) => ({
    text: localCleanup(rawText, { removeFillers: cfg.removeFillers, style: cfg.style }),
    provider: 'offline',
    model: 'rules',
    ms: Math.round(performance.now() - t0),
    fallback: !!reason,
    note: reason || '',
  });

  if (!rawText.trim()) return { text: '', provider: 'none', model: '', ms: 0 };
  if (cfg.provider === 'none') return { text: rawText.trim(), provider: 'none', model: '', ms: 0 };
  if (cfg.provider === 'offline') return offline('');
  if (!cfg.anthropicKey) return offline('No Anthropic API key set — used offline cleanup.');

  const Anthropic = await sdk();
  const client = new Anthropic({ apiKey: cfg.anthropicKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 60_000 });
  try {
    const response = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      output_config: { effort: 'low' }, // short, latency-sensitive editing task
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // re-run on a fallback model if a safety classifier declines
      system: buildSystemPrompt({ style: cfg.style, customInstructions: cfg.customInstructions }),
      messages: [{ role: 'user', content: buildUserMessage(rawText) }],
    });
    if (response.stop_reason === 'refusal') return offline('The AI declined to edit this dictation — used offline cleanup.');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text && wordCount(rawText) > 3) return offline('The AI returned no text — used offline cleanup.');
    const result = { text, provider: 'claude', model: response.model, ms: Math.round(performance.now() - t0), fallback: false };
    if (response.stop_reason === 'max_tokens') result.note = 'Output may be truncated — check against the original.';
    const ratio = wordCount(text) / Math.max(1, wordCount(rawText));
    if (wordCount(rawText) > 12 && (ratio < 0.5 || ratio > 1.6)) result.flagged = true;
    return result;
  } catch (err) {
    return offline(describeError(err, Anthropic));
  }
}

function describeError(err, Anthropic) {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic API key was rejected — used offline cleanup. Check Settings → Correction.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Your Anthropic key lacks access to this model — used offline cleanup.';
  if (err instanceof Anthropic.NotFoundError) return 'Model not found — used offline cleanup. Pick another model in Settings.';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic rate limit reached — used offline cleanup. You can re-correct later.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach Anthropic (offline?) — used offline cleanup. You can re-correct later.';
  if (err instanceof Anthropic.APIError) return `Anthropic error ${err.status ?? ''} — used offline cleanup.`;
  return `Correction failed (${err?.message || err}) — used offline cleanup.`;
}

/** Quick connectivity check for the Settings screen. */
export async function testClaude(cfg) {
  const r = await correctText('so um this is a quick test of the the correction system', { ...cfg, provider: 'claude' });
  if (r.provider !== 'claude') throw new Error(r.note || 'Correction did not use Claude.');
  return r;
}
