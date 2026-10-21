/**
 * The lasso used over every source in the side pane (S1): free-form or rectangle. Draws over
 * its positioned parent and reports the polygon in the parent's client coordinates. Pen,
 * mouse and one finger draw; two fingers fall through to scrolling and zooming.
 */
import { useRef, useState } from 'react';

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

  const local = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const finish = () => {
    const svg = ref.current;
    drawing.current = null;
    if (!svg || pts.length < 2) return setPts([]);
    const r = svg.getBoundingClientRect();
    const poly = mode === 'rect' ? rectPoints(pts[0], pts[pts.length - 1]) : pts;
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const box = new DOMRect(Math.min(...xs) + r.left, Math.min(...ys) + r.top, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    setPts([]);
    if (box.width < 4 || box.height < 4) return;
    onLasso({ points: poly.map((p) => ({ x: p.x + r.left, y: p.y + r.top })), rect: box });
  };

  const shown = mode === 'rect' && pts.length ? rectPoints(pts[0], pts[pts.length - 1]) : pts;

  return (
    <svg
      ref={ref}
      className="lasso-overlay"
      role="application"
      aria-label={label}
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
