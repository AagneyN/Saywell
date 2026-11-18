// Word-level diff (LCS) between original transcript and corrected text, for the review UI.

export function wordDiff(a, b) {
  const A = tokenize(a), B = tokenize(b);
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return [{ type: 'del', text: a }, { type: 'add', text: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = norm(A[i]) === norm(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (norm(A[i]) === norm(B[j])) { push('same', B[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++]);
    else push('add', B[j++]);
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('add', B[j++]);
  return out;
}

function tokenize(s) { return (s || '').match(/\s+|[^\s]+/g) ?? []; }
function norm(t) { return /^\s+$/.test(t) ? ' ' : t; }
