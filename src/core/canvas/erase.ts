/**
 * The eraser (C12). Whole-stroke mode removes every stroke the eraser touches; partial mode
 * removes only the touched parts, splitting a stroke into the pieces that remain. The eraser
 * affects strokes only.
 */
import type { Pt } from '../model/types';
import { distPointSegment, strokeHitBySegment } from '../ink/geometry';
import type { InkStroke } from '../ink/types';

/** Squared distance from p to segment ab. */
function d2Seg(px: number, py: number, a: Pt, b: Pt): number {
  const d = distPointSegment({ x: px, y: py }, a, b);
  return d * d;
}

/**
 * Removes the parts of a stroke within `radius` of the eraser path (a polyline in canvas
 * units; `radius` should include the stroke's half width). Segments near the eraser are
 * subdivided first so a fast stroke with sparse points is cut where it was touched, not at
 * its nearest sample. Returns null when nothing was touched, otherwise the remaining pieces
 * (flat [x, y, p, …], each with at least two points; possibly none).
 */
export function splitStroke(pts: readonly number[], path: readonly Pt[], radius: number): number[][] | null {
  const n = Math.floor(pts.length / 3);
  if (!n || !path.length) return null;
  const segs: [Pt, Pt][] = path.length === 1 ? [[path[0], path[0]]] : path.slice(1).map((p, i) => [path[i], p]);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of path) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const reach = radius * 2;
  const near = (x: number, y: number) => x >= x0 - reach && x <= x1 + reach && y >= y0 - reach && y <= y1 + reach;
  const r2 = radius * radius;
  const erased = (x: number, y: number) => {
    if (x < x0 - radius || x > x1 + radius || y < y0 - radius || y > y1 + radius) return false;
    for (const [a, b] of segs) if (d2Seg(x, y, a, b) <= r2) return true;
    return false;
  };

  // densify near the eraser so cuts land where the eraser passed
  const step = Math.max(0.2, radius / 3);
  const dense: number[] = [pts[0], pts[1], pts[2]];
  for (let i = 1; i < n; i++) {
    const ax = pts[(i - 1) * 3];
    const ay = pts[(i - 1) * 3 + 1];
    const ap = pts[(i - 1) * 3 + 2];
    const bx = pts[i * 3];
    const by = pts[i * 3 + 1];
    const bp = pts[i * 3 + 2];
    const len = Math.hypot(bx - ax, by - ay);
    if (len > step && (near(ax, ay) || near(bx, by) || near((ax + bx) / 2, (ay + by) / 2))) {
      const k = Math.ceil(len / step);
      for (let j = 1; j < k; j++) {
        const t = j / k;
        dense.push(Math.round((ax + (bx - ax) * t) * 10) / 10, Math.round((ay + (by - ay) * t) * 10) / 10, Math.round((ap + (bp - ap) * t) * 100) / 100);
      }
    }
    dense.push(bx, by, bp);
  }

  const m = dense.length / 3;
  let touched = false;
  const pieces: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < m; i++) {
    const x = dense[i * 3];
    const y = dense[i * 3 + 1];
    if (erased(x, y)) {
      touched = true;
      if (cur.length >= 6) pieces.push(cur);
      cur = [];
    } else cur.push(x, y, dense[i * 3 + 2]);
  }
  if (cur.length >= 6) pieces.push(cur);
  if (!touched) return null;
  // drop crumbs too short to see
  return pieces.filter((p) => {
    let len = 0;
    for (let i = 3; i + 1 < p.length; i += 3) len += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]);
    return len >= Math.min(1, radius / 4);
  });
}

/** Whole-stroke mode: does the eraser segment a→b touch the stroke? */
export function touchesStroke(stroke: InkStroke, a: Pt, b: Pt, radius: number): boolean {
  return strokeHitBySegment(stroke, a, b, radius);
}
