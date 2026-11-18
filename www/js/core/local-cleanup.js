// Deterministic offline cleaner. Conservative by design: it never changes meaning,
// so it is safe as the fallback whenever the AI step is off, offline, or fails.

const FILLERS = /(^|[\s,])(?:u+m+|u+h+m*|e+r+m+|e+r+|a+h+|h+m+|m+h*m+)(?=[\s,.!?]|$)[,]?/gi;
const QUESTION_START = /^(who|what|when|where|why|how|which|whose|whom|is|are|am|was|were|do|does|did|can|could|would|should|will|shall|may|might|have|has|had|isn't|aren't|don't|doesn't|didn't|can't|couldn't|wouldn't|shouldn't|won't)\b/i;
const KEEP_DOUBLE = new Set(['had', 'that', 'is', 'do', 'very', 'so', 'bye', 'no', 'yes', 'ha', 'really', 'well']);

export function localCleanup(input, { removeFillers = true, style = 'standard' } = {}) {
  let t = (input || '').replace(/\r\n?/g, '\n');

  // Spoken layout commands.
  t = t.replace(/[,.]?\s*\bnew paragraph\b[,.]?\s*/gi, '\n\n').replace(/[,.]?\s*\bnew line\b[,.]?\s*/gi, '\n');

  if (removeFillers && style !== 'light') {
    t = t.replace(FILLERS, '$1');
    // Immediate word repetitions ("the the", "I I") — stutters.
    t = t.replace(/\b(\w+)(\s+\1\b)+/gi, (m, w) => (KEEP_DOUBLE.has(w.toLowerCase()) ? m : w));
  }

  t = t
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  // Spacing around punctuation.
  t = t.replace(/[ \t]+([,.;:!?])/g, '$1').replace(/([,;:!?])(?=[^\s\d"')\]])/g, '$1 ').replace(/,{2,}/g, ',').replace(/^[,.;: \t]+/gm, '');

  // Pronoun "I" and its contractions.
  t = t.replace(/\bi\b(?=('m|'ve|'ll|'d)?\b)/g, 'I');

  // Capitalize sentence starts and line starts.
  t = t.replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());

  // Terminal punctuation per paragraph.
  t = t
    .split('\n')
    .map((line) => {
      if (!line || /[.!?:;…"')\]]$/.test(line) || /^[-*•]\s|^\d+\.\s/.test(line)) return line;
      const lastSentence = line.split(/(?<=[.!?])\s+/).pop();
      return line + (QUESTION_START.test(lastSentence) ? '?' : '.');
    })
    .join('\n');

  return t.trim();
}
