/**
 * Full-text search over gym's Markdown (G7), offline from the mirror: titles, paths and
 * text. Every query word must occur, case-insensitively, anywhere (so results appear while a
 * word is still being typed); titles and paths weigh more than the text. Hits point at the
 * section (heading anchor) of the first match.
 */
import { firstHeading, parseFrontMatter } from './frontmatter';
import { headingAt, headings, type Heading } from './headings';

export interface SearchDoc {
  path: string;
  title: string;
  /** the file's text (front matter included: offsets match the file) */
  text: string;
  lower: string;
  bodyStart: number;
  headings: Heading[];
}

export interface SearchHit {
  path: string;
  title: string;
  /** heading slug of the section with the first match in the text, if any */
  anchor?: string;
  /** a short plain excerpt around the first match */
  snippet: string;
  /** [start, end) ranges of the query words in `snippet` */
  marks: [number, number][];
  score: number;
}

export function searchDoc(path: string, text: string): SearchDoc {
  const fm = parseFrontMatter(text);
  const title = (fm.fields?.title || firstHeading(fm.body)) ?? path.slice(path.lastIndexOf('/') + 1);
  const hs = headings(fm.body).map((h) => ({ ...h, offset: h.offset + fm.bodyStart }));
  return { path, title, text, lower: text.toLowerCase(), bodyStart: fm.bodyStart, headings: hs };
}

export function queryWords(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

function count(hay: string, needle: string, cap: number): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && n < cap; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

const SNIPPET = 140;

export function search(docs: SearchDoc[], q: string, limit = 50): SearchHit[] {
  const words = queryWords(q);
  if (!words.length) return [];
  const phrase = words.join(' ');
  const hits: SearchHit[] = [];
  for (const d of docs) {
    const title = d.title.toLowerCase();
    const path = d.path.toLowerCase();
    let score = 0;
    let ok = true;
    for (const w of words) {
      const inTitle = title.includes(w);
      const inPath = path.includes(w);
      const inText = count(d.lower, w, 20);
      if (!inTitle && !inPath && !inText) {
        ok = false;
        break;
      }
      score += (inTitle ? 10 : 0) + (inPath ? 4 : 0) + Math.min(inText, 20) * 0.5;
    }
    if (!ok) continue;
    if (title.includes(phrase)) score += 15;
    // first match in the body: the whole phrase when present, else the first word
    let at = d.lower.indexOf(phrase, d.bodyStart);
    if (at >= 0) score += 5;
    else {
      for (const w of words) {
        at = d.lower.indexOf(w, d.bodyStart);
        if (at >= 0) break;
      }
    }
    let snippet = '';
    let marks: [number, number][] = [];
    let anchor: string | undefined;
    if (at >= 0) {
      const h = headingAt(d.headings, at);
      anchor = h?.slug;
      const start = Math.max(d.bodyStart, at - 50);
      const raw = d.text.slice(start, start + SNIPPET);
      const lead = start > d.bodyStart ? '…' : '';
      snippet = lead + raw.replace(/\s+/g, ' ').trim() + (start + SNIPPET < d.text.length ? '…' : '');
      marks = markWords(snippet, words);
    }
    hits.push({ path: d.path, title: d.title, anchor, snippet, marks, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

function markWords(s: string, words: string[]): [number, number][] {
  const lower = s.toLowerCase();
  const out: [number, number][] = [];
  for (const w of words) for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + w.length)) out.push([i, i + w.length]);
  out.sort((a, b) => a[0] - b[0]);
  // merge overlaps
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r] as [number, number]);
  }
  return merged;
}
