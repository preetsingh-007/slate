/** Text selections in a PDF text layer, reported page-normalised (L4; from Axiom's SelectionMenu). */
import type { Rect } from '../../../core/model/types';

export interface PdfSelection {
  text: string;
  page: number;
  /** normalised rects on the page, merged per line */
  rects: Rect[];
  /** union of the rects */
  region: Rect;
  /** client rect of the selection, for placing the menu */
  anchor: DOMRect;
}

/** Reads the current selection if it lies in one page of the viewer. */
export function readPdfSelection(container: HTMLElement): PdfSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as HTMLElement | null;
  const pageEl = startEl?.closest<HTMLElement>('.pdfv-page');
  if (!pageEl || !container.contains(pageEl)) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const pr = pageEl.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < pr.top || r.top > pr.bottom) continue; // other pages
    rects.push({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height });
  }
  const merged = mergeRects(rects);
  if (!merged.length) return null;
  const x0 = Math.min(...merged.map((r) => r.x));
  const y0 = Math.min(...merged.map((r) => r.y));
  const x1 = Math.max(...merged.map((r) => r.x + r.w));
  const y1 = Math.max(...merged.map((r) => r.y + r.h));
  return { text, page: Number(pageEl.dataset.page), rects: merged, region: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, anchor: range.getBoundingClientRect() };
}

/** Merges per-glyph rects on the same line into line rects (keeps highlights clean). */
export function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < r.h * 0.5 && r.x <= last.x + last.w + 0.02) {
      const x0 = Math.min(last.x, r.x);
      const x1 = Math.max(last.x + last.w, r.x + r.w);
      const y0 = Math.min(last.y, r.y);
      const y1 = Math.max(last.y + last.h, r.y + r.h);
      out[out.length - 1] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else out.push({ ...r });
  }
  return out;
}
