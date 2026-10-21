/**
 * "Export with annotations" (L4): a copy of the PDF with highlights, ink and margin notes drawn
 * into the pages with pdf-lib. The stored book file is never modified.
 *
 * Coordinates: highlight rects and note positions are normalised to the page (0..1 of width
 * and height, origin top-left); ink points are in units of the page width (x and y), as the
 * viewer stores them.
 */
import { PDFDocument, BlendMode, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { Annotation } from '../model/types';
import { CURRENT_INK, HIGHLIGHTER_ALPHA, outlineToSvgPath, strokeOutline } from '../ink/render';

function color(hex: string, fallback: RGB = rgb(0.12, 0.14, 0.16)): RGB {
  if (hex === CURRENT_INK) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()) ?? /^#?([0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

/** Replaces characters the standard fonts cannot encode (WinAnsi). */
function winAnsi(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
}

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of winAnsi(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(cand, size) <= width || !line) line = cand;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function drawNote(page: PDFPage, font: PDFFont, a: Annotation) {
  if (a.locator.type !== 'pdf') return;
  const { width: W, height: H } = page.getSize();
  const px = a.locator.region.x * W;
  const py = H - a.locator.region.y * H;
  const c = color(a.color, rgb(0.96, 0.84, 0.26));
  // marker at the anchor
  page.drawRectangle({ x: px - 4, y: py - 4, width: 8, height: 8, color: c, borderColor: rgb(0.4, 0.33, 0.05), borderWidth: 0.5 });
  const size = 7;
  const boxW = Math.min(150, W * 0.3);
  const lines = wrapText(a.text ?? '', font, size, boxW - 8).slice(0, 30);
  const boxH = lines.length * (size + 2) + 6;
  // in the margin on the side with more room, clamped to the page
  const bx = px > W / 2 ? Math.max(2, Math.min(W - boxW - 2, px - boxW - 10)) : Math.min(W - boxW - 2, px + 10);
  const by = Math.max(2, Math.min(H - boxH - 2, py - boxH / 2));
  page.drawRectangle({ x: bx, y: by, width: boxW, height: boxH, color: rgb(1, 0.98, 0.85), opacity: 0.95, borderColor: c, borderWidth: 0.8 });
  lines.forEach((l, i) => page.drawText(l, { x: bx + 4, y: by + boxH - 4 - (i + 1) * (size + 2) + 2, size, font, color: rgb(0.1, 0.1, 0.1) }));
}

/** Returns a new PDF with the annotations drawn into it. */
export async function flattenAnnotations(pdfBytes: Uint8Array | ArrayBuffer, annotations: Annotation[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ordered = [...annotations].sort((a, b) => order(a) - order(b) || a.created - b.created);
  for (const a of ordered) {
    if (a.locator.type !== 'pdf') continue;
    const page = pages[a.locator.page - 1];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    if (a.kind === 'highlight') {
      for (const r of a.rects ?? [a.locator.region]) {
        page.drawRectangle({ x: r.x * W, y: H - (r.y + r.h) * H, width: r.w * W, height: r.h * H, color: color(a.color), opacity: 0.4, blendMode: BlendMode.Multiply });
      }
    } else if (a.kind === 'ink') {
      for (const s of a.strokes ?? []) {
        const pts: number[] = [];
        for (let i = 0; i + 2 < s.pts.length; i += 3) pts.push(s.pts[i] * W, s.pts[i + 1] * W, s.pts[i + 2]);
        const outline = strokeOutline({ pts, size: s.size * W, tool: s.tool });
        if (!outline.length) continue;
        page.drawSvgPath(outlineToSvgPath(outline), {
          x: 0,
          y: H,
          color: color(s.color),
          opacity: s.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1,
          blendMode: s.tool === 'highlighter' ? BlendMode.Multiply : BlendMode.Normal,
          borderWidth: 0,
        });
      }
    } else if (a.kind === 'note') drawNote(page, font, a);
  }
  return doc.save();
}

/** Highlights first, then ink, then notes on top. */
function order(a: Annotation): number {
  return a.kind === 'highlight' ? 0 : a.kind === 'ink' ? 1 : 2;
}
