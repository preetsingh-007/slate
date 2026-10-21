/**
 * Shared, bounded cache of open PDF documents (L2; from Axiom). Every viewer goes through here
 * so a textbook is parsed once per session; documents not in use are closed when evicted, so
 * memory stays bounded however many books are opened.
 */
import { closePdf, openPdf, type PDFDocumentProxy } from '../../../core/library/pdf';
import { LRU } from '../../../core/util/lru';

/** open viewers per file: a referenced document is never evicted */
const refs = new Map<string, number>();

const docs = new LRU<string, Promise<PDFDocumentProxy>>(3, (k, p) => {
  if ((refs.get(k) ?? 0) > 0) return false;
  void p.then((d) => closePdf(d)).catch(() => {});
  return true;
});

export class MissingFileError extends Error {
  constructor() {
    super('The file of this book is not on this device.');
    this.name = 'MissingFileError';
  }
}

/** Pins a document (by file hash) while in use; call release() when done. */
export function acquirePdf(fileHash: string, load: () => Promise<Blob | undefined>): { pdf: Promise<PDFDocumentProxy>; release: () => void } {
  refs.set(fileHash, (refs.get(fileHash) ?? 0) + 1);
  let released = false;
  let p = docs.get(fileHash);
  if (!p) {
    p = (async () => {
      const blob = await load();
      if (!blob) throw new MissingFileError();
      // hand the buffer to pdf.js without a copy: an 800-page book stays light
      return openPdf(new Uint8Array(await blob.arrayBuffer()), { transfer: true });
    })();
    docs.set(fileHash, p);
    p.catch(() => docs.delete(fileHash));
  }
  return {
    pdf: p,
    release: () => {
      if (released) return;
      released = true;
      const n = (refs.get(fileHash) ?? 1) - 1;
      if (n <= 0) refs.delete(fileHash);
      else refs.set(fileHash, n);
    },
  };
}

/**
 * Renders a region (normalised 0..1 page rect) of a page to a PNG at `scale` × PDF points
 * (S2: the viewer passes twice the on-screen resolution). Capped at 16 M pixels.
 */
export async function cropPage(pdf: PDFDocumentProxy, page: number, rect: { x: number; y: number; w: number; h: number }, scale: number): Promise<{ blob: Blob; w: number; h: number } | null> {
  const pg = await pdf.getPage(page);
  const base = pg.getViewport({ scale: 1 });
  const pxW = rect.w * base.width;
  const pxH = rect.h * base.height;
  const s = Math.min(scale, Math.sqrt(16_000_000 / Math.max(1, pxW * pxH)), 8);
  const vp = pg.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  const cw = Math.max(1, Math.round(rect.w * vp.width));
  const ch = Math.max(1, Math.round(rect.h * vp.height));
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  await pg.render({ canvasContext: ctx, canvas, viewport: vp, transform: [1, 0, 0, 1, -rect.x * vp.width, -rect.y * vp.height] }).promise;
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  canvas.width = canvas.height = 0;
  return blob ? { blob, w: cw, h: ch } : null;
}
