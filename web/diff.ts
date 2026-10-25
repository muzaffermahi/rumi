// A word-level diff between the passage and a suggested rewrite, for "Replace passage". Longest common subsequence
// over words, with whitespace kept on the word before it so the text reads naturally.
export type Part = {type: 'same' | 'add' | 'del'; text: string};

const words = (s: string) => s.match(/\s*\S+|\s+$/g) || [];

export function diffWords(before: string, after: string): Part[] {
  const a = words(before),
    b = words(after);
  // Very long texts: fall back to "all removed, all added" rather than an n×m table.
  if (a.length * b.length > 4_000_000)
    return [
      {type: 'del', text: before},
      {type: 'add', text: after},
    ];
  const norm = (w: string) => w.trim().toLowerCase();
  const m = a.length,
    n = b.length;
  const dp: Uint32Array[] = Array.from({length: m + 1}, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--) dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Part[] = [];
  const push = (type: Part['type'], text: string) => {
    const last = out.at(-1);
    if (last?.type === type) last.text += text;
    else out.push({type, text});
  };
  let i = 0,
    j = 0;
  while (i < m && j < n) {
    if (norm(a[i]) === norm(b[j])) {
      push('same', b[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', a[i++]);
    else push('add', b[j++]);
  }
  while (i < m) push('del', a[i++]);
  while (j < n) push('add', b[j++]);
  return out;
}

// How much of the passage survives in the rewrite (0–1): decides whether Replace is offered first.
export function similarity(before: string, after: string) {
  const parts = diffWords(before, after);
  const same = parts.filter(p => p.type === 'same').reduce((n, p) => n + p.text.length, 0);
  return same / Math.max(1, before.length);
}
