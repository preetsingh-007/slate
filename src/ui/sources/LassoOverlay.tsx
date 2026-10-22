/**
 * The lasso used over every source in the side pane (S1): free-form or rectangle. Draws over
 * its positioned parent and reports the polygon in the parent's client coordinates. Pen,
 * mouse and one finger draw; two fingers fall through to scrolling and zooming.
 *
 * Keyboard (accessibility NFR): the overlay takes focus when the lasso is turned on; an arrow
 * key or Enter shows a rectangle, the arrows move it, Shift+arrows resize it (Alt: finer
 * steps), Enter captures it and Escape drops it.
 */
import { useEffect, useRef, useState } from 'react';

type Box = { x: number; y: number; w: number; h: number };

export type LassoMode = 'free' | 'rect';

export interface LassoResult {
  /** polygon in client (viewport) coordinates */
  points: { x: number; y: number }[];
  /** bounding box in client coordinates */
  rect: DOMRect;
}

export function LassoOverlay({ mode, onLasso, label = 'Lasso' }: { mode: LassoMode; onLasso(r: LassoResult): void; label?: string }) {
  const [pts, setPts] = useState<{ x: number; y: number }[]>([]);
  const ref = useRef<SVGSVGElement>(null);
  const drawing = useRef<number | null>(null);
  const touches = useRef(new Set<number>());
  const [kb, setKb] = useState<Box | null>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const report = (poly: { x: number; y: number }[]) => {
    const r = ref.current!.getBoundingClientRect();
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const box = new DOMRect(Math.min(...xs) + r.left, Math.min(...ys) + r.top, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (box.width < 4 || box.height < 4) return;
    onLasso({ points: poly.map((p) => ({ x: p.x + r.left, y: p.y + r.top })), rect: box });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    // the part of the overlay on screen
    const vw = Math.min(r.width, window.innerWidth - Math.max(0, r.left));
    const vh = Math.min(r.height, window.innerHeight - Math.max(0, r.top));
    const arrow = e.key.startsWith('Arrow');
    if (!kb) {
      if (!arrow && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      setKb({ x: Math.round(vw * 0.15), y: Math.round(vh * 0.25), w: Math.round(vw * 0.7), h: Math.round(vh * 0.3) });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setKb(null);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setKb(null);
      report(rectPoints({ x: kb.x, y: kb.y }, { x: kb.x + kb.w, y: kb.y + kb.h }));
      return;
    }
    if (!arrow) return;
    e.preventDefault();
    const step = e.altKey ? 4 : 16;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const b = e.shiftKey ? { ...kb, w: Math.max(8, kb.w + dx), h: Math.max(8, kb.h + dy) } : { ...kb, x: kb.x + dx, y: kb.y + dy };
    b.x = Math.max(0, Math.min(b.x, vw - 8));
    b.y = Math.max(0, Math.min(b.y, vh - 8));
    b.w = Math.min(b.w, vw - b.x);
    b.h = Math.min(b.h, vh - b.y);
    setKb(b);
  };

  const local = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const finish = () => {
    const svg = ref.current;
    drawing.current = null;
    if (!svg || pts.length < 2) return setPts([]);
    const poly = mode === 'rect' ? rectPoints(pts[0], pts[pts.length - 1]) : pts;
    setPts([]);
    report(poly);
  };

  const shown = kb ? rectPoints({ x: kb.x, y: kb.y }, { x: kb.x + kb.w, y: kb.y + kb.h }) : mode === 'rect' && pts.length ? rectPoints(pts[0], pts[pts.length - 1]) : pts;

  return (
    <svg
      ref={ref}
      className="lasso-overlay"
      role="application"
      aria-label={`${label}. Keyboard: arrows show and move a rectangle, Shift+arrows resize it, Enter captures it.`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onBlur={() => setKb(null)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 20, touchAction: 'pan-x pan-y pinch-zoom', cursor: 'crosshair' }}
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') {
          touches.current.add(e.pointerId);
          if (touches.current.size > 1) {
            drawing.current = null;
            setPts([]);
            return;
          }
        }
        if (e.button !== 0) return;
        drawing.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        setPts([local(e)]);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (drawing.current !== e.pointerId) return;
        const p = local(e);
        setPts((prev) => (mode === 'rect' ? [prev[0], p] : [...prev, p]));
      }}
      onPointerUp={(e) => {
        touches.current.delete(e.pointerId);
        if (drawing.current === e.pointerId) finish();
      }}
      onPointerCancel={(e) => {
        touches.current.delete(e.pointerId);
        drawing.current = null;
        setPts([]);
      }}
    >
      {shown.length > 1 && (
        <polygon
          points={shown.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="var(--selection)"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
      )}
    </svg>
  );
}

function rectPoints(a: { x: number; y: number }, b: { x: number; y: number }) {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

/** Whether a client point lies inside a client polygon (even-odd). */
export function pointInLasso(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
