// Tiny fuzzy matcher for the command menu. Substring matches rank above
// scattered-letter matches; matches at word starts and early in the text
// rank higher. Returns null when the query doesn't match at all.

export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();

  const at = t.indexOf(q);
  if (at >= 0) {
    const wordStart = at === 0 || /[\s\-_/.(]/.test(t[at - 1]);
    return 1000 + (wordStart ? 200 : 0) - at * 2 - (t.length - q.length) * 0.2;
  }

  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    streak = found === ti ? streak + 1 : 0;
    const boundary = found === 0 || /[\s\-_/.(]/.test(t[found - 1]);
    score += 10 + streak * 6 + (boundary ? 15 : 0) - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return score;
}
