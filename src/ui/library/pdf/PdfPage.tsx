/**
 * One PDF page of the virtualised viewer (L2, L4; from Axiom): canvas (rendered offscreen then
 * swapped, so zooming never flashes blank), pdf.js text layer (selection, search, screen
 * readers), highlight layer, ink layer, margin notes, clip marks (S7) and the 2 s flash (S6).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { StickyNote } from 'lucide-react';
import type { Annotation, Rect } from '../../../core/model/types';
import type { PdfMark } from '../../../core/library/marks';
import { loadPdfjs, type PDFDocumentProxy, type PDFPageProxy } from '../../../core/library/pdf';
import { ClipMark } from '../ClipMarks';
import { InkLayer, type InkMode, type InkStyle } from './InkLayer';

const MAX_CANVAS_PIXELS = 12_000_000;

export interface PageProps {
  pdf: PDFDocumentProxy;
  n: number;
  top: number;
  cssWidth: number;
  cssHeight: number;
  annotations: Annotation[];
  marks: PdfMark[];
  flash: { rect: Rect; nonce: number } | null;
  inkMode: InkMode;
  inkStyle: InkStyle;
  fingerDrawing: boolean;
  search: string;
  onSize(n: number, w: number, h: number): void;
  onStroke(page: number, pts: number[]): void;
  /** Durability NFR: ink being drawn on this page (see InkLayer) */
  onInkDraft(page: number, pts: number[] | null): void;
  onErase(ids: string[]): void;
  onNoteAt(page: number, x: number, y: number, anchor: DOMRect): void;
  onOpenNote(a: Annotation, anchor: DOMRect): void;
  onHighlightClick(a: Annotation, anchor: DOMRect): void;
}

export const PdfPage = memo(function PdfPage(p: PageProps) {
  const { pdf, n, top, cssWidth, cssHeight } = p;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [rendered, setRendered] = useState(false);
  const [textReady, setTextReady] = useState(0);

  useEffect(() => {
    let alive = true;
    let proxy: PDFPageProxy | null = null;
    void pdf.getPage(n).then((pg) => {
      if (!alive) return;
      proxy = pg;
      const vp = pg.getViewport({ scale: 1 });
      p.onSize(n, vp.width, vp.height);
      setPage(pg);
    });
    return () => {
      alive = false;
      // release the page's resources when it scrolls far away (memory stays bounded)
      proxy?.cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, n]);

  useEffect(() => {
    if (!page || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let scale = (cssWidth / base.width) * dpr;
    if (base.width * base.height * scale * scale > MAX_CANVAS_PIXELS) scale = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height));
    const vp = page.getViewport({ scale });
    let task: ReturnType<PDFPageProxy['render']> | null = null;
    const t = setTimeout(
      () => {
        const off = document.createElement('canvas');
        off.width = Math.floor(vp.width);
        off.height = Math.floor(vp.height);
        task = page.render({ canvasContext: off.getContext('2d')!, canvas: off, viewport: vp });
        task.promise
          .then(() => {
            canvas.width = off.width;
            canvas.height = off.height;
            canvas.getContext('2d')!.drawImage(off, 0, 0);
            off.width = off.height = 0;
            setRendered(true);
          })
          .catch(() => {});
      },
      rendered ? 120 : 0,
    );
    return () => {
      clearTimeout(t);
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, cssWidth]);

  // free the bitmap when the page unmounts
  useEffect(() => {
    const c = canvasRef.current;
    return () => {
      if (c) c.width = c.height = 0;
    };
  }, []);

  useEffect(() => {
    if (!page || !textRef.current) return;
    const container = textRef.current;
    let cancelled = false;
    let layer: { cancel(): void } | null = null;
    void (async () => {
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      container.replaceChildren();
      const vp = page.getViewport({ scale: cssWidth / page.getViewport({ scale: 1 }).width });
      container.style.setProperty('--total-scale-factor', String(vp.scale));
      container.style.setProperty('--scale-factor', String(vp.scale));
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport: vp });
      layer = tl;
      await tl.render().catch(() => {});
      if (!cancelled) setTextReady((x) => x + 1);
    })();
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [page, cssWidth]);

  // search matches in the text layer
  useEffect(() => {
    const c = textRef.current;
    if (!c) return;
    const q = p.search.trim().toLowerCase();
    for (const s of Array.from(c.querySelectorAll('span'))) {
      const hit = !!q && (s.textContent ?? '').toLowerCase().includes(q);
      s.classList.toggle('search-hit', hit);
    }
  }, [p.search, textReady]);

  const highlights = p.annotations.filter((a) => a.kind === 'highlight');
  const notes = p.annotations.filter((a) => a.kind === 'note');

  return (
    <div
      ref={pageRef}
      className="pdfv-page"
      data-page={n}
      style={{ top, width: cssWidth, height: cssHeight }}
      onClick={(e) => {
        // a click (not a drag-selection) on a highlight opens its menu
        if (p.inkMode || window.getSelection()?.isCollapsed === false) return;
        const r = pageRef.current!.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        const h = highlights.find((a) => (a.rects ?? []).some((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h));
        if (h) p.onHighlightClick(h, new DOMRect(e.clientX, e.clientY, 1, 1));
      }}
    >
      <canvas ref={canvasRef} className={`pdfv-canvas-el${rendered ? ' ready' : ''}`} style={{ width: cssWidth, height: cssHeight }} aria-hidden />
      <div className="pdfv-hl-layer" aria-hidden>
        {highlights.map((h) =>
          (h.rects ?? []).map((r, i) => (
            <div
              key={h.id + i}
              className="pdfv-hl"
              data-annotation={h.id}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: h.color }}
            />
          )),
        )}
      </div>
      <div ref={textRef} className="textLayer" />
      <InkLayer
        width={cssWidth}
        height={cssHeight}
        annotations={p.annotations}
        mode={p.inkMode}
        style={p.inkStyle}
        fingerDrawing={p.fingerDrawing}
        onStroke={(pts) => p.onStroke(n, pts)}
        onDraft={(pts) => p.onInkDraft(n, pts)}
        onErase={p.onErase}
        onNote={(x, y) => {
          const r = pageRef.current!.getBoundingClientRect();
          p.onNoteAt(n, x, y, new DOMRect(r.left + x * r.width, r.top + y * r.height, 1, 1));
        }}
      />
      {notes.map((a) => {
        if (a.locator.type !== 'pdf') return null;
        const y = a.locator.region.y;
        return (
          <button
            key={a.id}
            className="pdf-note"
            style={{ top: `calc(${y * 100}% - 11px)` }}
            aria-label={`Margin note: ${a.text || 'empty'}`}
            title={a.text}
            data-testid="pdf-note"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => p.onOpenNote(a, e.currentTarget.getBoundingClientRect())}
          >
            <StickyNote size={14} />
          </button>
        );
      })}
      {p.marks.map((m) => (
        <ClipMark key={`${m.y}`} clips={m.clips} style={{ top: `${m.y * 100}%`, height: `${Math.max(1.5, m.h * 100)}%` }} />
      ))}
      {p.flash && (
        <div
          key={p.flash.nonce}
          className="lib-flash"
          data-testid="flash"
          style={{ left: `${p.flash.rect.x * 100}%`, top: `${p.flash.rect.y * 100}%`, width: `${Math.max(1, p.flash.rect.w * 100)}%`, height: `${Math.max(1, p.flash.rect.h * 100)}%` }}
        />
      )}
      <div className="pdfv-pagenum" aria-hidden>
        {n}
      </div>
    </div>
  );
});
