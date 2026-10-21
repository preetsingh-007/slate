/**
 * Lasso over a rendered gym file (S1, S2): the capture's text is the Markdown source of the
 * selected part (maths keeps its LaTeX), its image the rendered region, its source link a gym
 * locator (S5). Also the reverse (S6): flashing the rendered part of a source range.
 */
import type { Capture } from '../../core/model/capture';
import { gymSourceLink } from '../../core/gym/locator';
import { absolutizeLinks, alignAtoms, itemMarker, joinPieces, partialRange, type Atom, type DocLayout, type Piece, type SourceRange } from '../../core/gym/sourceMap';
import { uid } from '../../core/util/ids';
import { pointInLasso, type LassoResult } from '../sources/LassoOverlay';
import { rasterizeRegion } from '../sources/rasterize';

interface Placed {
  atom: Atom;
  rect: DOMRect;
}

/** Words, formulas and images of an element in document order, with their screen rectangles. */
export function collectAtoms(el: Element): Placed[] {
  const out: Placed[] = [];
  const range = document.createRange();
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      for (const m of t.data.matchAll(/\S+/g)) {
        range.setStart(t, m.index);
        range.setEnd(t, m.index + m[0].length);
        const rects = range.getClientRects();
        out.push({ atom: { kind: 'text', text: m[0] }, rect: rects.length ? rects[0] : range.getBoundingClientRect() });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as Element;
    if (e.classList.contains('katex')) {
      out.push({ atom: { kind: 'math', tex: e.querySelector('annotation')?.textContent ?? '' }, rect: e.getBoundingClientRect() });
      return;
    }
    if (e.tagName === 'IMG') {
      out.push({ atom: { kind: 'image', src: e.getAttribute('data-rel-src') ?? e.getAttribute('src') ?? '' }, rect: e.getBoundingClientRect() });
      return;
    }
    if (e.tagName === 'INPUT' || e.classList.contains('gym-flash-layer')) return;
    for (const c of e.childNodes) walk(c);
  };
  walk(el);
  return out;
}

const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const rangeOf = (el: Element): SourceRange => ({ start: Number(el.getAttribute('data-s')), end: Number(el.getAttribute('data-e')) });

/** Screen rectangles of the lines of a code block, in order. */
function codeLineRects(code: Element): DOMRect[] {
  const nodes: { node: Text; start: number }[] = [];
  let total = 0;
  const tw = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    nodes.push({ node: n as Text, start: total });
    total += (n as Text).data.length;
  }
  const full = nodes.map((n) => n.node.data).join('');
  const at = (off: number): [Text, number] => {
    for (let i = nodes.length - 1; i >= 0; i--) if (off >= nodes[i].start) return [nodes[i].node, Math.min(off - nodes[i].start, nodes[i].node.data.length)];
    return [nodes[0].node, 0];
  };
  const rects: DOMRect[] = [];
  if (!nodes.length) return rects;
  const range = document.createRange();
  let s = 0;
  for (const line of full.replace(/\n$/, '').split('\n')) {
    const [sn, so] = at(s);
    const [en, eo] = at(s + Math.max(1, line.length));
    range.setStart(sn, so);
    range.setEnd(en, eo);
    rects.push(range.getBoundingClientRect());
    s += line.length + 1;
  }
  return rects;
}

/** The source pieces under a lasso. */
export function regionPieces(article: HTMLElement, layout: DocLayout, text: string, lasso: LassoResult): Piece[] {
  const inside = (r: DOMRect) => r.width + r.height > 0 && pointInLasso({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, lasso.points);
  const pieces: Piece[] = [];

  const unit = (el: Element, range: SourceRange, block: number, partial: boolean, marker = ''): Piece | null => {
    const placed = collectAtoms(el);
    if (!placed.length) return inside(el.getBoundingClientRect()) ? { ...range, block } : null;
    const sel = placed.map((p) => inside(p.rect));
    const n = sel.filter(Boolean).length;
    if (!n) return null;
    if (n === sel.length || !partial) return { ...range, block };
    const r = partialRange(text, range, alignAtoms(text, range.start, range.end, placed.map((p) => p.atom)), sel);
    if (!r) return { ...range, block };
    return marker && r.start > range.start ? { ...r, block, text: marker + text.slice(r.start, r.end) } : { ...r, block };
  };

  for (const div of article.querySelectorAll<HTMLElement>(':scope > .gym-block')) {
    const bi = Number(div.dataset.b);
    const block = layout.blocks[bi];
    if (!block || !overlaps(div.getBoundingClientRect(), lasso.rect)) continue;
    const whole = { start: block.start, end: block.end, block: bi };
    if (block.items) {
      for (const li of div.querySelectorAll(':scope > ul > li[data-s], :scope > ol > li[data-s]')) {
        if (!overlaps(li.getBoundingClientRect(), lasso.rect)) continue;
        const r = rangeOf(li);
        const simple = !li.querySelector('ul, ol, pre, table, blockquote, .md-math-display');
        const p = unit(li, r, bi, simple, itemMarker(text, r));
        if (p) pieces.push(p);
      }
    } else if (block.rows) {
      const trs = [...div.querySelectorAll('tr[data-s]')];
      const chosen = trs.filter((tr) => {
        const atoms = collectAtoms(tr);
        return atoms.length ? atoms.some((a) => inside(a.rect)) : inside(tr.getBoundingClientRect());
      });
      if (!chosen.length) continue;
      if (chosen.length === trs.length) pieces.push(whole);
      else {
        const rows = block.rows;
        const body = chosen.filter((tr) => tr !== trs[0]).map(rangeOf);
        const line = (r: SourceRange) => text.slice(r.start, r.end);
        const first = chosen[0] === trs[0] ? rows[0] : body[0];
        const last = body.length ? body[body.length - 1] : rows[1];
        pieces.push({ start: first.start, end: last.end, block: bi, text: [line(rows[0]), line(rows[1]), ...body.map(line)].join('\n') });
      }
    } else if (block.code) {
      const code = div.querySelector('pre > code');
      const rects = code ? codeLineRects(code) : [];
      const sel = rects.map(inside);
      const idx = sel.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) {
        if (!rects.length && inside(div.getBoundingClientRect())) pieces.push(whole);
        continue;
      }
      const lines = block.code.lines;
      if (rects.length !== lines.length || (idx.length === lines.length)) {
        pieces.push(whole);
        continue;
      }
      const a = lines[idx[0]];
      const b = lines[idx[idx.length - 1]];
      pieces.push({ start: a.start, end: b.end, block: bi, text: `${block.code.open}\n${text.slice(a.start, b.end)}\n${block.code.close}` });
    } else {
      const p = unit(div, block, bi, block.type === 'paragraph' || block.type === 'heading');
      if (p) pieces.push(p);
    }
  }
  return pieces;
}

/**
 * Image of the lassoed region. Only the blocks under it are cloned into an off-screen copy of
 * the article (a long notebook would be slow to clone whole), laid out at the same width.
 */
export async function regionImage(article: HTMLElement, rect: DOMRect): Promise<{ blob: Blob; w: number; h: number } | null> {
  const blocks = [...article.querySelectorAll<HTMLElement>(':scope > .gym-block')].filter((b) => overlaps(b.getBoundingClientRect(), rect));
  if (!blocks.length) return null;
  const host = document.createElement('div');
  const ar = article.getBoundingClientRect();
  const first = blocks[0].getBoundingClientRect();
  host.style.cssText = `position:fixed;left:${ar.left}px;top:${first.top}px;width:${ar.width}px;visibility:hidden;pointer-events:none;z-index:-1;`;
  const inner = document.createElement('div');
  inner.className = article.className;
  inner.style.cssText = 'display:flow-root;margin:0;';
  for (const b of blocks) inner.appendChild(b.cloneNode(true));
  inner.querySelector('.gym-flash-layer')?.remove();
  host.appendChild(inner);
  (article.parentElement ?? document.body).appendChild(host);
  try {
    await Promise.all([...inner.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
    const clone = inner.children[0].getBoundingClientRect();
    const dx = first.left - clone.left;
    const dy = first.top - clone.top;
    const r = new DOMRect(rect.x - dx, rect.y - dy, rect.width, rect.height);
    return await rasterizeRegion(inner, r);
  } finally {
    host.remove();
  }
}

export interface CaptureSource {
  path: string;
  title: string;
  sha: string;
  commit: string;
  text: string;
  layout: DocLayout;
}

/** Builds a capture from a lasso over the rendered file; null when nothing was under it. */
export async function captureRegion(article: HTMLElement, src: CaptureSource, lasso: LassoResult): Promise<Capture | null> {
  const joined = joinPieces(src.text, regionPieces(article, src.layout, src.text, lasso));
  if (!joined) return null;
  const image = await regionImage(article, lasso.rect).catch(() => null);
  return {
    id: uid(),
    image: image?.blob,
    imageSize: image ? { w: image.w, h: image.h } : undefined,
    text: absolutizeLinks(joined.markdown, src.path),
    source: gymSourceLink({ path: src.path, title: src.title, commit: src.commit, sha: src.sha, source: src.text, start: joined.start, end: joined.end }),
    created: Date.now(),
  };
}

// ---------------------------------------------------------------- S6: flash a source range

/** Screen rectangles of the rendered part of `text[start, end)`, merged per line. */
export function rangeRects(article: HTMLElement, text: string, start: number, end: number): DOMRect[] {
  const units = [...article.querySelectorAll<HTMLElement>('[data-s]')].filter((el) => {
    const r = rangeOf(el);
    if (r.end <= start || r.start >= end) return false;
    // a list or table is represented by its items or rows
    return !el.querySelector('[data-s]');
  });
  const rects: DOMRect[] = [];
  for (const el of units) {
    const r = rangeOf(el);
    const textBlock = el.classList.contains('gym-block') && el.children.length === 1 && /^(P|H[1-6])$/.test(el.children[0].tagName);
    const simpleText = (el.tagName === 'LI' || textBlock) && !el.querySelector('pre, table, ul, ol, .md-math-display');
    if ((start <= r.start && end >= r.end) || !simpleText) {
      rects.push(el.getBoundingClientRect());
      continue;
    }
    const placed = collectAtoms(el);
    const ranges = alignAtoms(text, r.start, r.end, placed.map((p) => p.atom));
    const hit = placed.filter((_p, i) => ranges[i] && ranges[i]!.end > start && ranges[i]!.start < end).map((p) => p.rect);
    if (!hit.length) rects.push(el.getBoundingClientRect());
    else rects.push(...mergeLines(hit));
  }
  return rects;
}

function mergeLines(rects: DOMRect[]): DOMRect[] {
  const lines: DOMRect[] = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.top - r.top) < r.height / 2) {
      const left = Math.min(last.left, r.left);
      const right = Math.max(last.right, r.right);
      const top = Math.min(last.top, r.top);
      lines[lines.length - 1] = new DOMRect(left, top, right - left, Math.max(last.bottom, r.bottom) - top);
    } else lines.push(r);
  }
  return lines;
}

/** Draws rectangles over the article that fade out after `ms` (S6: 2 seconds). */
export function flashRects(article: HTMLElement, rects: DOMRect[], ms = 2000) {
  let layer = article.querySelector<HTMLElement>(':scope > .gym-flash-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'gym-flash-layer';
    layer.setAttribute('aria-hidden', 'true');
    article.appendChild(layer);
  }
  layer.replaceChildren();
  const box = article.getBoundingClientRect();
  for (const r of rects) {
    const d = document.createElement('div');
    d.className = 'gym-flash';
    d.style.cssText = `left:${r.left - box.left - 2}px;top:${r.top - box.top - 1}px;width:${r.width + 4}px;height:${r.height + 2}px;animation-duration:${ms}ms`;
    layer.appendChild(d);
  }
  const l = layer;
  setTimeout(() => {
    if (l.isConnected) l.replaceChildren();
  }, ms);
}
