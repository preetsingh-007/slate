/**
 * Relative links in the Markdown the app writes (G9): gym's `scripts/check.py` fails on any
 * relative link whose target does not exist. Generated links are only written to targets that
 * exist; user content (text boxes, clipping text, to-dos) may contain arbitrary links, so every
 * Markdown file passes through `neutralizeLinks` before it is committed. It finds links exactly
 * as check.py does (same patterns, code stripped the same way) and turns a broken one into
 * literal text by escaping its `(`: `[a](b)` → `[a]\(b)`, which renders as `[a](b)`.
 */
import { normalizePath, dirOf } from '../paths';

// check.py's patterns, ported with Python's semantics: `\s` is Python's whitespace (it includes
// \x1c-\x1f and \x85; JavaScript's includes \ufeff instead), and re.M's `^` matches only after
// '\n' (JavaScript's `m` flag also matches after '\r', U+2028 and U+2029)
const PY_WS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const LINK = new RegExp(`!?\\[[^\\]]*\\]\\([${PY_WS}]*<?([^)${PY_WS}>]+)>?(?:[${PY_WS}]+"[^"]*")?[${PY_WS}]*\\)`, 'g');
const FENCE = /(?:^|(?<=\n))[ \t]*(```|~~~)[\s\S]*?(?<=\n)[ \t]*\1/g;
const INLINE_CODE = /`[^`\n]*`/g;

interface Stripped {
  text: string;
  /** index in `text` → index in the original */
  map: number[];
}

function strip(text: string, re: RegExp, map?: number[]): Stripped {
  const outChars: string[] = [];
  const outMap: number[] = [];
  let last = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  const keep = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      outChars.push(text[i]);
      outMap.push(map ? map[i] : i);
    }
  };
  while ((m = re.exec(text))) {
    keep(last, m.index);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  keep(last, text.length);
  return { text: outChars.join(''), map: outMap };
}

export interface LinkHit {
  target: string;
  /** index of the link's '(' in the original text */
  paren: number;
}

/** The text as check.py's `read_text` sees it: '\r\n' and '\r' become '\n' (universal newlines). */
function pythonText(md: string): Stripped {
  if (!md.includes('\r')) return { text: md, map: [...md].map((_, i) => i) };
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < md.length; i++) {
    if (md[i] === '\r') {
      chars.push('\n');
      map.push(i);
      if (md[i + 1] === '\n') i++;
    } else {
      chars.push(md[i]);
      map.push(i);
    }
  }
  return { text: chars.join(''), map };
}

/** Links check.py would see in `md` (code fences and inline code removed first). */
export function findLinks(md: string): LinkHit[] {
  const py = pythonText(md);
  const a = strip(py.text, FENCE, py.map);
  const b = strip(a.text, INLINE_CODE, a.map);
  const out: LinkHit[] = [];
  LINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK.exec(b.text))) {
    const close = m[0].indexOf('](');
    out.push({ target: m[1], paren: b.map[m.index + close + 1] });
  }
  return out;
}

/** True for link targets check.py does not check (URLs, mail, anchors). */
export function isExternal(target: string): boolean {
  return target.includes('://') || target.startsWith('mailto:') || target.startsWith('#');
}

/** Repository path a relative link points to, as check.py resolves it; null when outside. */
export function linkPath(fromFile: string, target: string): string | null {
  let t = target.split('#', 1)[0].split('?', 1)[0];
  try {
    t = decodeURIComponent(t);
  } catch {
    // check.py's unquote leaves malformed escapes as they are
  }
  if (t.startsWith('/')) return normalizePath(t);
  return normalizePath(`${dirOf(fromFile)}/${t}`);
}

/**
 * Escapes every relative link in `md` (a file at `file`) whose target `exists` rejects.
 * `exists` receives normalised repository paths ('' is the root) and must accept folders.
 */
export function neutralizeLinks(md: string, file: string, exists: (path: string) => boolean): string {
  return neutralizeLinksTracked(md, file, exists).text;
}

/**
 * `neutralizeLinks`, also returning where the backslashes went (ascending positions in the
 * result), so content that must come back exactly (clippings, L11) can remove them again.
 */
export function neutralizeLinksTracked(md: string, file: string, exists: (path: string) => boolean): { text: string; inserted: number[] } {
  let text = md;
  let inserted: number[] = [];
  // escaping one link can never create another, but loop defensively until stable
  for (let round = 0; round < 4; round++) {
    const broken = findLinks(text).filter((l) => {
      if (isExternal(l.target)) return false;
      const p = linkPath(file, l.target);
      return p === null || !exists(p);
    });
    if (!broken.length) break;
    for (const l of broken.sort((x, y) => y.paren - x.paren)) {
      text = text.slice(0, l.paren) + '\\' + text.slice(l.paren);
      inserted = inserted.map((i) => (i >= l.paren ? i + 1 : i));
      inserted.push(l.paren);
    }
  }
  return { text, inserted: inserted.sort((a, b) => a - b) };
}

/** Builds an `exists` predicate over a set of file paths (folders exist when they contain a file). */
export function pathExists(files: Iterable<string>): (path: string) => boolean {
  const all = new Set<string>(['']);
  for (const f of files) {
    all.add(f);
    const segs = f.split('/');
    for (let i = 1; i < segs.length; i++) all.add(segs.slice(0, i).join('/'));
  }
  return (p) => all.has(p.replace(/\/+$/, ''));
}
