import type { CanvasObject, Pt, Rect } from '../model/types';

/** Centre of an object's frame. */
export function frameCenter(o: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h'>): Pt {
  return { x: o.x + o.w / 2, y: o.y + o.h / 2 };
}

/** The four corners of an object's (possibly rotated) frame, clockwise from top-left. */
export function frameCorners(o: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>): Pt[] {
  const pts = [
    { x: o.x, y: o.y },
    { x: o.x + o.w, y: o.y },
    { x: o.x + o.w, y: o.y + o.h },
    { x: o.x, y: o.y + o.h },
  ];
  if (!o.rotation) return pts;
  const c = frameCenter(o);
  const r = (o.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }));
}

/** Axis-aligned bounds of an object as drawn, including stroke width. */
export function objectBounds(o: CanvasObject): Rect {
  let pad = 0;
  if (o.kind === 'stroke') pad = o.size / 2;
  else if (o.kind === 'shape') pad = o.lineWidth * 2;
  if (!o.rotation) return { x: o.x - pad, y: o.y - pad, w: o.w + 2 * pad, h: o.h + 2 * pad };
  const cs = frameCorners(o);
  const xs = cs.map((p) => p.x);
  const ys = cs.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: x - pad, y: y - pad, w: Math.max(...xs) - x + 2 * pad, h: Math.max(...ys) - y + 2 * pad };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Bounds of a stroke's points (flat [x, y, p, ...]). */
export function pointsBounds(pts: readonly number[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 3) {
    const x = pts[i];
    const y = pts[i + 1];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
