/**
 * Freehand ink on a PDF page with the canvas pen and highlighter (L4). Strokes are smoothed and
 * rendered with core/ink (perfect-freehand outlines) and stored page-normalised: x, y and the
 * size in units of the page width, so they scale with zoom and export exactly.
 *
 * Pen and mouse draw; fingers scroll unless finger drawing is on (C13). On iPad Safari a Pencil
 * is a touch with touchType "stylus": its touchmove is cancelled so it draws instead of
 * scrolling.
 */
import { memo, useEffect, useRef, useState } from 'react';
import type { Annotation, StrokeTool } from '../../../core/model/types';
import { HIGHLIGHTER_ALPHA, resolveInkColor, strokeToPath2D } from '../../../core/ink/render';
import { PointSmoother, PressureSimulator } from '../../../core/ink/smoothing';
import { usePageHide } from '../../common/pageHide';
import { EAGER_DRAFT_POINTS, draftThrottle } from '../../common/drafts';

export interface InkStyle {
  tool: StrokeTool;
  color: string;
  /** size in page-width units */
  size: number;
}

export type InkMode = 'draw' | 'erase' | 'note' | null;

interface Props {
  width: number;
  height: number;
  annotations: Annotation[];
  mode: InkMode;
  style: InkStyle;
  fingerDrawing: boolean;
  onStroke(pts: number[]): void;
  /**
   * Durability NFR: the stroke being drawn so far (page-normalised, as `onStroke` gets it),
   * reported about every 150 ms and at page hide; null when it is cancelled.
   */
  onDraft?(pts: number[] | null): void;
  /** eraser touched these ink annotations */
  onErase(ids: string[]): void;
  /** note tool tapped at a normalised point */
  onNote(x: number, y: number): void;
}

/** PDF pages stay white in dark mode, so the default ink colour is always dark there. */
const PAGE_INK = '#1f2328';

export const InkLayer = memo(function InkLayer({ width, height, annotations, mode, style, fingerDrawing, onStroke, onDraft, onErase, onNote }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wet = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const ink = annotations.filter((a) => a.kind === 'ink');

  // committed ink
  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const a of ink) {
      for (const s of a.strokes ?? []) {
        const pts = s.pts.map((v, i) => (i % 3 === 2 ? v : v * width));
        ctx.globalAlpha = s.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1;
        ctx.globalCompositeOperation = s.tool === 'highlighter' ? 'multiply' : 'source-over';
        ctx.fillStyle = resolveInkColor(s.color, PAGE_INK);
        ctx.fill(strokeToPath2D({ pts, size: s.size * width, tool: s.tool }));
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }, [ink, width, height]);

  // a Pencil on iPad Safari must not scroll while drawing
  useEffect(() => {
    const el = overlay.current;
    if (!el || mode !== 'draw' && mode !== 'erase') return;
    const stop = (e: TouchEvent) => {
      for (const t of Array.from(e.touches)) if ((t as Touch & { touchType?: string }).touchType === 'stylus') return e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, [mode]);

  const drawing = useRef<{ id: number; pts: number[]; smoother: PointSmoother; pressure: PressureSimulator; real: boolean } | null>(null);
  // page-normalised: x and y in units of the page width
  const normalise = (pts: number[]) => {
    const norm: number[] = [];
    for (let i = 0; i + 2 < pts.length; i += 3) norm.push(round(pts[i] / width), round(pts[i + 1] / width), Math.round(pts[i + 2] * 100) / 100);
    return norm;
  };
  const latestDraft = useRef<() => void>(() => {});
  latestDraft.current = () => {
    const d = drawing.current;
    if (d && mode === 'draw' && d.pts.length >= 3) onDraft?.(normalise(d.pts));
  };
  const [draft] = useState(() => draftThrottle(() => latestDraft.current(), { eager: () => (drawing.current?.pts.length ?? 0) <= 3 * EAGER_DRAFT_POINTS }));

  const local = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const paintWet = () => {
    const c = wet.current;
    const d = drawing.current;
    if (!c || !d) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(width * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = style.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1;
    ctx.fillStyle = resolveInkColor(style.color, PAGE_INK);
    ctx.fill(strokeToPath2D({ pts: d.pts, size: style.size * width, tool: style.tool }));
  };

  const eraseAt = (p: { x: number; y: number }) => {
    const r = 10;
    const hit: string[] = [];
    for (const a of ink) {
      outer: for (const s of a.strokes ?? []) {
        for (let i = 0; i + 1 < s.pts.length; i += 3) {
          if (Math.hypot(s.pts[i] * width - p.x, s.pts[i + 1] * width - p.y) <= r + (s.size * width) / 2) {
            hit.push(a.id);
            break outer;
          }
        }
      }
    }
    if (hit.length) onErase(hit);
  };

  const accepts = (e: React.PointerEvent) => e.pointerType !== 'touch' || fingerDrawing;

  /** Ends a stroke: clears the wet layer and stores the ink drawn so far. */
  const finish = (d: NonNullable<typeof drawing.current>) => {
    drawing.current = null;
    draft.cancel();
    const c = wet.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    if (mode !== 'draw') return;
    if (d.pts.length < 3) return onDraft?.(null);
    onStroke(normalise(d.pts));
  };
  // Durability NFR: a stroke still being drawn when the page goes away is kept
  usePageHide(() => {
    if (drawing.current) finish(drawing.current);
  });

  if (!mode) {
    return <canvas ref={canvas} className="pdf-ink" style={{ width, height }} aria-hidden />;
  }

  return (
    <>
      <canvas ref={canvas} className="pdf-ink" style={{ width, height }} aria-hidden />
      <canvas ref={wet} className="pdf-ink wet" style={{ width, height }} aria-hidden />
      <div
        ref={overlay}
        className={`pdf-ink-input mode-${mode}`}
        style={{ touchAction: fingerDrawing ? 'none' : 'pan-x pan-y pinch-zoom' }}
        data-testid="ink-input"
        onPointerDown={(e) => {
          if (!accepts(e) || e.button !== 0) return;
          const p = local(e);
          if (mode === 'note') {
            onNote(p.x / width, p.y / height);
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          e.preventDefault();
          if (mode === 'erase') {
            drawing.current = { id: e.pointerId, pts: [], smoother: new PointSmoother(), pressure: new PressureSimulator(), real: false };
            eraseAt(p);
            return;
          }
          const real = e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5;
          const d = { id: e.pointerId, pts: [] as number[], smoother: new PointSmoother(), pressure: new PressureSimulator(), real };
          const [x, y] = e.pointerType === 'pen' ? [p.x, p.y] : d.smoother.filter(p.x, p.y, e.timeStamp);
          d.pts.push(x, y, real ? e.pressure : d.pressure.next(x, y, e.timeStamp));
          drawing.current = d;
          paintWet();
          draft.schedule();
        }}
        onPointerMove={(e) => {
          const d = drawing.current;
          if (!d || d.id !== e.pointerId) return;
          const events = (e.nativeEvent.getCoalescedEvents?.() ?? []).length ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
          for (const ev of events) {
            const p = local(ev);
            if (mode === 'erase') {
              eraseAt(p);
              continue;
            }
            const [x, y] = e.pointerType === 'pen' ? [p.x, p.y] : d.smoother.filter(p.x, p.y, ev.timeStamp);
            d.pts.push(x, y, d.real ? ev.pressure : d.pressure.next(x, y, ev.timeStamp));
          }
          if (mode === 'draw') {
            paintWet();
            draft.schedule();
          }
        }}
        onPointerUp={(e) => {
          const d = drawing.current;
          if (!d || d.id !== e.pointerId) return;
          finish(d);
        }}
        onPointerCancel={() => {
          if (drawing.current && mode === 'draw') onDraft?.(null);
          draft.cancel();
          drawing.current = null;
          const c = wet.current;
          c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
        }}
      />
    </>
  );
});

const round = (v: number) => Math.round(v * 100000) / 100000;
