/**
 * Mapping between a gym file's Markdown source and its rendered form, so a lasso over the
 * rendered page captures the part's Markdown **source** (S2: maths keeps its LaTeX, links and
 * structure survive) and a gym source link can be found again (S6).
 *
 * The reader renders a file block by block (top-level tokens from the same lexer as
 * `renderMarkdown`) and tags every block, list item, table row and code line with its source
 * range. A lasso then yields pieces:
 * - units wholly inside the lasso contribute their source as is;
 * - a paragraph, heading or simple list item partly inside contributes the source from its
 *   first to its last selected word or formula, widened so links and emphasis stay balanced;
 * - code blocks contribute the selected lines, re-fenced; tables their header plus the
 *   selected rows.
 * This module is the DOM-free part: block layout, word alignment, balancing and joining.
 */
import type { Token, Tokens } from 'marked';
import { lexMarkdown } from '../markdown/render';
import { resolveLink } from './paths';

export interface SourceRange {
  start: number;
  end: number;
}

export interface DocBlock {
  type: string;
  /** source range in the file, surrounding whitespace excluded */
  start: number;
  end: number;
  /** the block's source as lexed (rendered on its own) */
  raw: string;
  /** list: one range per top-level item, in order */
  items?: SourceRange[];
  /** table: one range per line: header, delimiter row, then body rows */
  rows?: SourceRange[];
  /** fenced code: the fence lines and one range per content line */
  code?: { open: string; close: string; lines: SourceRange[] };
}

export interface DocLayout {
  blocks: DocBlock[];
  /** link reference definitions (`[x]: url`), appended to each block when rendering */
  defs: string;
}

function trimmed(text: string, start: number, end: number): SourceRange {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

/** Splits `text` (a whole file) into top-level blocks with source ranges; the body starts at `bodyStart`. */
export function layoutDoc(text: string, bodyStart = 0): DocLayout {
  const body = text.slice(bodyStart);
  const tokens = lexMarkdown(body);
  const blocks: DocBlock[] = [];
  const defs: string[] = [];
  let cursor = 0;
  for (const tok of tokens) {
    let at = body.indexOf(tok.raw, cursor);
    if (at < 0) at = cursor; // the lexer normalised something; stay approximately right
    cursor = at + tok.raw.length;
    if (tok.type === 'space') continue;
    if (tok.type === 'def') {
      defs.push(tok.raw.trim());
      continue;
    }
    const abs = bodyStart + at;
    const r = trimmed(text, abs, abs + tok.raw.length);
    const block: DocBlock = { type: tok.type, start: r.start, end: r.end, raw: tok.raw };
    if (tok.type === 'list') block.items = itemRanges(text, abs, tok as Tokens.List);
    else if (tok.type === 'table') block.rows = lineRanges(text, r.start, r.end).filter((l) => l.end > l.start);
    else if (tok.type === 'code') block.code = codeLines(text, r.start, r.end);
    blocks.push(block);
  }
  return { blocks, defs: defs.join('\n') };
}

function itemRanges(text: string, abs: number, list: Tokens.List): SourceRange[] {
  const out: SourceRange[] = [];
  let cursor = abs;
  for (const item of list.items) {
    let at = text.indexOf(item.raw, cursor);
    if (at < 0) at = cursor;
    cursor = at + item.raw.length;
    out.push(trimmed(text, at, at + item.raw.length));
  }
  return out;
}

function lineRanges(text: string, start: number, end: number): SourceRange[] {
  const out: SourceRange[] = [];
  let s = start;
  for (let i = start; i <= end; i++) {
    if (i === end || text[i] === '\n') {
      out.push({ start: s, end: i });
      s = i + 1;
    }
  }
  return out;
}

function codeLines(text: string, start: number, end: number): DocBlock['code'] {
  const lines = lineRanges(text, start, end);
  const first = text.slice(lines[0].start, lines[0].end);
  const fence = /^\s*(`{3,}|~{3,})/.exec(first);
  if (!fence) return undefined; // indented code: captured whole
  const last = lines[lines.length - 1];
  const closes = lines.length > 1 && new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`).test(text.slice(last.start, last.end));
  return {
    open: first.trim(),
    close: fence[1],
    lines: lines.slice(1, closes ? -1 : undefined),
  };
}

// ---------------------------------------------------------------- word alignment

/** Something rendered in a text unit, in document order. */
export type Atom = { kind: 'text'; text: string } | { kind: 'math'; tex: string } | { kind: 'image'; src: string };

/** How far ahead of the previous match a word may be found (long link URLs sit between words). */
const WINDOW = 1200;

/**
 * Aligns rendered atoms to their source in `text[start, end)`, in order. An atom whose source
 * cannot be found (entities, escapes) maps to null and does not move the cursor.
 */
export function alignAtoms(text: string, start: number, end: number, atoms: Atom[]): (SourceRange | null)[] {
  let cursor = start;
  const find = (needle: string) => {
    if (!needle) return -1;
    const i = text.indexOf(needle, cursor);
    return i < 0 || i + needle.length > end || i - cursor > WINDOW ? -1 : i;
  };
  return atoms.map((a) => {
    if (a.kind === 'text') {
      const i = find(a.text);
      if (i < 0) return null;
      cursor = i + a.text.length;
      return { start: i, end: cursor };
    }
    if (a.kind === 'math') {
      const i = find(a.tex);
      if (i < 0) return null;
      let s = i;
      let e = i + a.tex.length;
      // widen to the `$`/`$$` delimiters (display maths may have spaces inside them)
      let p = s;
      while (p > start && /[ \t\n]/.test(text[p - 1])) p--;
      if (text[p - 1] === '$') {
        s = p - 1;
        if (text[s - 1] === '$' && s - 1 >= start) s--;
      }
      p = e;
      while (p < end && /[ \t\n]/.test(text[p])) p++;
      if (text[p] === '$') {
        e = p + 1;
        if (text[e] === '$' && e < end) e++;
      }
      cursor = e;
      return { start: s, end: e };
    }
    const i = find(a.src);
    if (i < 0) return null;
    const open = text.lastIndexOf('![', i);
    const close = text.indexOf(')', i + a.src.length);
    if (open < start || close < 0 || close >= end) return null;
    cursor = close + 1;
    return { start: open, end: close + 1 };
  });
}

/**
 * Widens `[s, e)` within `[lo, hi)` so inline Markdown stays balanced: a link whose text is cut
 * gets its brackets and target, cut emphasis or code gets its delimiters. Maths and code spans
 * are masked first, so `A^*` or `x_i` inside a formula never count as delimiters.
 */
export function balanceInline(text: string, s: number, e: number, lo: number, hi: number): SourceRange {
  const t = text.slice(0, lo) + maskInline(text.slice(lo, hi)) + text.slice(hi);
  for (let guard = 0; guard < 8; guard++) {
    const part = t.slice(s, e);
    const opens = (part.match(/(?<!\\)\[/g) ?? []).length;
    const closes = (part.match(/(?<!\\)\]/g) ?? []).length;
    let changed = false;
    if (closes > opens) {
      const b = t.lastIndexOf('[', s - 1);
      if (b >= lo) {
        s = t[b - 1] === '!' && b - 1 >= lo ? b - 1 : b;
        changed = true;
      }
    } else if (opens > closes) {
      const m = /\](\([^)]*\))?/.exec(t.slice(e, hi));
      if (m) {
        e += m.index + m[0].length;
        changed = true;
      }
    } else if (/\]\([^)]*$/.test(part) || (part.endsWith(']') && t[e] === '(')) {
      // a link target cut in the middle, or a link whose `(target)` follows right after
      const close = t.indexOf(')', e);
      if (close >= 0 && close < hi) {
        e = close + 1;
        changed = true;
      }
    }
    for (const d of ['**', '__', '~~', '`']) {
      if (count(t.slice(s, e), d) % 2 === 0) continue;
      const before = t.lastIndexOf(d, s - 1);
      const after = t.indexOf(d, e);
      const okBefore = before >= lo && before + d.length <= s;
      const okAfter = after >= 0 && after + d.length <= hi;
      if (okAfter && (!okBefore || after - e <= s - before - d.length)) e = after + d.length;
      else if (okBefore) s = before;
      else continue;
      changed = true;
    }
    // single `*` emphasis (stars that are not part of `**`)
    if ((t.slice(s, e).replace(/\*\*/g, '').match(/(?<!\\)\*/g)?.length ?? 0) % 2 === 1) {
      const before = t.lastIndexOf('*', s - 1);
      const after = t.indexOf('*', e);
      if (after >= 0 && after < hi && (before < lo || after - e <= s - before - 1)) {
        e = after + 1;
        changed = true;
      } else if (before >= lo) {
        s = before;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { start: s, end: e };
}

/** Replaces the inside of maths and code spans with spaces (same length). */
function maskInline(s: string): string {
  const blank = (m: string) => m[0] + ' '.repeat(m.length - 2) + m[m.length - 1];
  return s
    .replace(/`[^`\n]+`/g, blank)
    .replace(/\$\$[\s\S]+?\$\$|\$(?=\S)(?:\\\$|[^$\n])+?\$/g, (m) => ' '.repeat(m.length));
}

function count(s: string, d: string): number {
  let n = 0;
  for (let i = s.indexOf(d); i >= 0; i = s.indexOf(d, i + d.length)) n++;
  return n;
}

/** Source range of a partly selected text unit: first to last selected atom, balanced. */
export function partialRange(text: string, unit: SourceRange, ranges: (SourceRange | null)[], selected: boolean[]): SourceRange | null {
  let first: SourceRange | null = null;
  let last: SourceRange | null = null;
  ranges.forEach((r, i) => {
    if (!r || !selected[i]) return;
    if (!first) first = r;
    last = r;
  });
  if (!first || !last) return null;
  return balanceInline(text, (first as SourceRange).start, (last as SourceRange).end, unit.start, unit.end);
}

const ITEM_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;

/** The list marker (`- `, `1. `, `- [ ] `) a partial list item keeps. */
export function itemMarker(text: string, item: SourceRange): string {
  return ITEM_MARKER.exec(text.slice(item.start, item.end))?.[0].trimStart() ?? '';
}

// ---------------------------------------------------------------- joining

export interface Piece extends SourceRange {
  /** index of the top-level block the piece belongs to */
  block: number;
  /** text to use instead of `text.slice(start, end)` (re-fenced code, table with header, list marker) */
  text?: string;
}

/**
 * Joins pieces (in any order) into one Markdown text. Pieces separated in the source only by
 * whitespace keep that separation (at most one blank line); otherwise items of one block are
 * joined by a newline and blocks by a blank line. Also returns the source range covered.
 */
export function joinPieces(text: string, pieces: Piece[]): { markdown: string; start: number; end: number } | null {
  if (!pieces.length) return null;
  const list = [...pieces].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (i > 0) {
      const prev = list[i - 1];
      const gap = text.slice(prev.end, p.start);
      if (p.start < prev.end) out += '\n';
      else if (!gap.trim()) out += gap.includes('\n\n') ? '\n\n' : gap.includes('\n') ? '\n' : gap;
      else out += p.block === prev.block ? '\n' : '\n\n';
    }
    out += p.text ?? text.slice(p.start, p.end);
  }
  return { markdown: out, start: list[0].start, end: Math.max(...list.map((p) => p.end)) };
}

// ---------------------------------------------------------------- links in captured text

/**
 * Rewrites relative links and images in Markdown taken from the gym file `fromFile` to
 * repository-absolute paths (`/math/…`), so the captured text keeps working on the canvas
 * and in derived journal files, which live elsewhere in the repository. Code is left alone.
 */
export function absolutizeLinks(markdown: string, fromFile: string): string {
  const rewrite = (target: string) => {
    if (target.startsWith('#')) return `/${fromFile}${target}`;
    if (target.startsWith('/')) return target;
    const r = resolveLink(fromFile, target);
    if (!r) return target;
    return `/${r.path}${r.anchor ? `#${r.anchor}` : ''}`;
  };
  return mapOutsideCode(markdown, (prose) =>
    prose
      .replace(/(!?\[[^\]]*\]\()(\s*)(<?)([^)\s>]+)(>?)/g, (_m, head: string, sp: string, lt: string, target: string, gt: string) => `${head}${sp}${lt}${rewrite(target)}${gt}`)
      .replace(/^([ \t]*\[[^\]]+\]:[ \t]*)(\S+)/gm, (_m, head: string, target: string) => `${head}${rewrite(target)}`),
  );
}

/** Applies `fn` to the parts of a Markdown text outside fenced code and code spans. */
function mapOutsideCode(md: string, fn: (prose: string) => string): string {
  const parts = md.split(/(^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$|`[^`\n]*`)/m);
  return parts.map((p, i) => (i % 2 === 1 ? p : fn(p))).join('');
}

/** Exposed for tests: the token types the lexer produced for a text. */
export function blockTypes(text: string): string[] {
  return lexMarkdown(text)
    .filter((t: Token) => t.type !== 'space')
    .map((t: Token) => t.type);
}
