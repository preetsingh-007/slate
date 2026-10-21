/**
 * Maps between rendered HTML (EPUB chapters, clipping Reader view) and its text, for text-quote
 * anchors (S5, S6, L5, L11): character offsets ↔ DOM ranges. The text is the same walk as
 * `documentText` in core/library/snapshot.ts (and the snapshot frame), so offsets agree.
 */
import { pointInLasso } from '../sources/LassoOverlay';

export interface TextMap {
  text: string;
  nodes: Text[];
  /** start offset of each node in `text` */
  starts: number[];
}

function skip(el: Element): boolean {
  return /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD)$/i.test(el.tagName) || el.classList.contains('katex-mathml') || el.hasAttribute('data-no-text');
}

export function buildTextMap(root: Node): TextMap {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      nodes.push(n as Text);
      starts.push(text.length);
      text += n.nodeValue ?? '';
      return;
    }
    if (n.nodeType === 1 && skip(n as Element)) return;
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(root);
  return { text, nodes, starts };
}

/** Text offset of a DOM boundary point (as in a Range or Selection). */
export function offsetOf(map: TextMap, node: Node, offset: number): number {
  if (node.nodeType === 3) {
    const i = map.nodes.indexOf(node as Text);
    if (i >= 0) return map.starts[i] + Math.min(offset, (node.nodeValue ?? '').length);
  }
  // element boundary: the first mapped text node at or after the boundary
  const probe = document.createRange();
  probe.setStart(node, offset);
  probe.collapse(true);
  for (let i = 0; i < map.nodes.length; i++) {
    const r = document.createRange();
    r.selectNodeContents(map.nodes[i]);
    if (r.compareBoundaryPoints(Range.START_TO_START, probe) >= 0) return map.starts[i];
  }
  return map.text.length;
}

/** DOM range for text offsets [start, end). */
export function rangeFromOffsets(map: TextMap, start: number, end: number): Range | null {
  if (!map.nodes.length || end < start) return null;
  const locate = (off: number, isEnd: boolean): [Text, number] | null => {
    let lo = 0;
    let hi = map.nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (map.starts[mid] < off || (!isEnd && map.starts[mid] === off)) lo = mid;
      else hi = mid - 1;
    }
    const node = map.nodes[lo];
    return [node, Math.max(0, Math.min((node.nodeValue ?? '').length, off - map.starts[lo]))];
  };
  const a = locate(start, false);
  const b = locate(end, true);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a[0], a[1]);
  r.setEnd(b[0], b[1]);
  return r;
}

export interface DomHit {
  /** text offsets of the first and last picked word */
  start: number;
  end: number;
  range: Range;
}

/**
 * Words (and images and maths) whose centres fall inside a lasso polygon (client coordinates),
 * as one range from the first to the last in document order (S2). Null when nothing is inside.
 */
export function hitInPolygon(root: HTMLElement, map: TextMap, poly: { x: number; y: number }[]): DomHit | null {
  let first: { node: Node; offset: number; text: number } | null = null;
  let last: { node: Node; offset: number; text: number } | null = null;
  const r = document.createRange();
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  for (let i = 0; i < map.nodes.length; i++) {
    const node = map.nodes[i];
    const value = node.nodeValue ?? '';
    if (!value.trim()) continue;
    r.selectNodeContents(node);
    const nb = r.getBoundingClientRect();
    if (nb.bottom < box.y0 || nb.top > box.y1 || nb.right < box.x0 || nb.left > box.x1) continue;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[0].length);
      const wb = r.getBoundingClientRect();
      if (!wb.width && !wb.height) continue;
      if (!pointInLasso({ x: wb.left + wb.width / 2, y: wb.top + wb.height / 2 }, poly)) continue;
      const startText = map.starts[i] + m.index;
      if (!first) first = { node, offset: m.index, text: startText };
      last = { node, offset: m.index + m[0].length, text: startText + m[0].length };
    }
  }
  // images and KaTeX/MathML blocks count as content too
  for (const el of Array.from(root.querySelectorAll('img, svg, .katex, math'))) {
    if (el.closest('.katex-mathml')) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 4 || !pointInLasso({ x: b.left + b.width / 2, y: b.top + b.height / 2 }, poly)) continue;
    const pr = document.createRange();
    pr.selectNode(el);
    const startText = offsetOf(map, pr.startContainer, pr.startOffset);
    const endText = offsetOf(map, pr.endContainer, pr.endOffset);
    if (!first || startText < first.text) first = { node: pr.startContainer, offset: pr.startOffset, text: startText };
    if (!last || endText > last.text) last = { node: pr.endContainer, offset: pr.endOffset, text: endText };
  }
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
  return { start: first.text, end: Math.max(first.text, last.text), range };
}

/** Rects of a range relative to a container's content box (for overlays that scroll with it). */
export function rangeRectsIn(range: Range, container: HTMLElement): { x: number; y: number; w: number; h: number }[] {
  const cb = container.getBoundingClientRect();
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue;
    out.push({ x: r.left - cb.left + container.scrollLeft, y: r.top - cb.top + container.scrollTop, w: r.width, h: r.height });
  }
  return mergeLineRects(out);
}

/** Merges rects on the same line (a highlight per line, not per text node). */
export function mergeLineRects(rects: { x: number; y: number; w: number; h: number }[]): { x: number; y: number; w: number; h: number }[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < r.h * 0.5 && r.x <= last.x + last.w + 4) {
      const x1 = Math.max(last.x + last.w, r.x + r.w);
      const y1 = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.y = Math.min(last.y, r.y);
      last.w = x1 - last.x;
      last.h = y1 - last.y;
    } else out.push({ ...r });
  }
  return out;
}

const STRUCTURE = /^(TABLE|THEAD|TBODY|TFOOT|TR|UL|OL|LI|PRE|BLOCKQUOTE|CODE|H[1-6]|DL|DT|DD|FIGURE|STRONG|EM|B|I)$/;

/**
 * A range's contents with its structural ancestors (table, list, pre…) re-created around it, so a
 * lasso inside a table or list converts to a GFM table or list, not loose text (S2).
 */
export function rangeFragment(range: Range, root: Node): DocumentFragment {
  let frag: DocumentFragment | Element = range.cloneContents();
  const doc = range.startContainer.ownerDocument!;
  for (let n: Node | null = range.commonAncestorContainer; n && n !== root; n = n.parentNode) {
    if (n.nodeType !== 1 || !STRUCTURE.test((n as Element).tagName)) continue;
    const shell = (n as Element).cloneNode(false) as Element;
    shell.appendChild(frag);
    frag = shell;
  }
  if (frag.nodeType === 11) return frag as DocumentFragment;
  const out = doc.createDocumentFragment();
  out.appendChild(frag);
  return out;
}
