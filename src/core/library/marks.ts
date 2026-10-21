/**
 * Links back from a source (S7): clips that point into a book or clipping, grouped into light
 * marks in the margin. PDF marks come straight from the locator's page and region; EPUB and
 * clipping marks are placed by re-anchoring the quote in the viewer (UI).
 */
import type { ClipRef } from '../stores/canvases';
import type { TextQuote } from '../model/types';

export interface PdfMark {
  page: number;
  /** top and height of the marked band, normalised to the page */
  y: number;
  h: number;
  clips: ClipRef[];
}

/** Groups PDF clips into one mark per page band (overlapping regions merge). */
export function pdfClipMarks(refs: ClipRef[]): PdfMark[] {
  const byPage = new Map<number, PdfMark[]>();
  const sorted = refs
    .filter((r) => r.clip.source.locator.type === 'pdf')
    .sort((a, b) => {
      const la = a.clip.source.locator as { page: number; region: { y: number } };
      const lb = b.clip.source.locator as { page: number; region: { y: number } };
      return la.page - lb.page || la.region.y - lb.region.y;
    });
  for (const r of sorted) {
    const loc = r.clip.source.locator as { page: number; region: { y: number; h: number } };
    const list = byPage.get(loc.page) ?? [];
    const last = list[list.length - 1];
    const y = loc.region.y;
    const h = Math.max(0.01, loc.region.h);
    if (last && y <= last.y + last.h + 0.005) {
      const bottom = Math.max(last.y + last.h, y + h);
      last.h = bottom - last.y;
      last.clips.push(r);
    } else list.push({ page: loc.page, y, h, clips: [r] });
    byPage.set(loc.page, list);
  }
  return [...byPage.values()].flat();
}

/** The text quote of an EPUB or clipping locator. */
export function quoteOf(ref: ClipRef): TextQuote | null {
  const l = ref.clip.source.locator;
  return l.type === 'epub' || l.type === 'clipping' ? l.quote : null;
}
