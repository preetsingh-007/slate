/**
 * W3C Web Annotation text quote selectors (S5) and re-anchoring (S6): find the quoted text in
 * a document's text, exactly when possible, otherwise the closest match.
 */
import type { TextQuote } from '../model/types';

const CONTEXT = 32;

/** Normalises whitespace so quotes survive reflow and different renderers. */
export function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Builds a quote selector for `text.slice(start, end)`. */
export function makeQuote(text: string, start: number, end: number): TextQuote {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  };
}

export interface QuoteMatch {
  start: number;
  end: number;
  /** true when the exact quote was found (with matching context when it occurs several times) */
  exact: boolean;
  /** 0..1, 1 for exact */
  score: number;
}

/**
 * Locates a quote in `text`. Exact matches are disambiguated by prefix and suffix and by the
 * `hint` offset; otherwise a fuzzy search returns the most similar window (null if nothing
 * reasonably similar exists).
 */
export function findQuote(text: string, quote: TextQuote, hint?: number): QuoteMatch | null {
  const exact = quote.exact;
  if (!exact) return null;
  const hits: number[] = [];
  for (let i = text.indexOf(exact); i >= 0 && hits.length < 1000; i = text.indexOf(exact, i + 1)) hits.push(i);
  if (hits.length) {
    let best = hits[0];
    let bestScore = -Infinity;
    for (const i of hits) {
      const s =
        commonSuffix(text.slice(Math.max(0, i - quote.prefix.length), i), quote.prefix) +
        commonPrefix(text.slice(i + exact.length, i + exact.length + quote.suffix.length), quote.suffix) -
        (hint !== undefined ? Math.abs(i - hint) / 1e6 : 0);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return { start: best, end: best + exact.length, exact: true, score: 1 };
  }
  // whitespace-insensitive exact match
  const ws = whitespaceInsensitiveFind(text, exact);
  if (ws) return { ...ws, exact: true, score: 1 };
  return fuzzyFind(text, quote, hint);
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function whitespaceInsensitiveFind(text: string, quote: string): { start: number; end: number } | null {
  const q = normalizeSpace(quote);
  if (!q) return null;
  // map normalised text positions back to the original
  const map: number[] = [];
  let norm = '';
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (!space && norm.length) {
        norm += ' ';
        map.push(i);
      }
      space = true;
    } else {
      norm += c;
      map.push(i);
      space = false;
    }
  }
  const i = norm.indexOf(q);
  if (i < 0) return null;
  return { start: map[i], end: map[i + q.length - 1] + 1 };
}

/**
 * Fuzzy search: slides a window of the quote's length over the text, scoring windows by
 * shared character trigrams, then refines the best candidates with an edit-distance check.
 */
function fuzzyFind(text: string, quote: TextQuote, hint?: number): QuoteMatch | null {
  const q = normalizeSpace(quote.exact).toLowerCase();
  if (q.length < 3 || !text) return null;
  const grams = trigramSet(q);
  const lower = text.toLowerCase();
  const n = q.length;
  const step = Math.max(1, Math.floor(n / 8));
  const candidates: { i: number; s: number }[] = [];
  for (let i = 0; i <= Math.max(0, lower.length - n); i += step) {
    const w = lower.slice(i, i + n);
    let shared = 0;
    for (const g of trigramSet(w)) if (grams.has(g)) shared++;
    candidates.push({ i, s: shared / grams.size });
  }
  candidates.sort((a, b) => b.s - a.s);
  let best: QuoteMatch | null = null;
  for (const c of candidates.slice(0, 8)) {
    // refine around the candidate
    for (let d = -step; d <= step; d++) {
      const i = Math.max(0, c.i + d);
      const w = lower.slice(i, i + n);
      const sim = 1 - levenshtein(w, q) / Math.max(n, 1);
      const penalty = hint !== undefined ? Math.min(0.05, Math.abs(i - hint) / 1e6) : 0;
      if (!best || sim - penalty > best.score) best = { start: i, end: Math.min(text.length, i + n), exact: false, score: sim - penalty };
    }
  }
  return best && best.score >= 0.5 ? best : null;
}

function trigramSet(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Levenshtein distance with a two-row table. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}
