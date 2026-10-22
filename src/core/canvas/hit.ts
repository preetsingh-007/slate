/**
 * Hit testing and selection (C14): which object a tap lands on, and which objects a free-form
 * or rectangle lasso encloses. Strokes hidden by Beautify are never hit.
 */
import type { CanvasObject, Pt, Rect } from '../model/types';
import { bbox, bboxContains, distPointSegment, distToPolygon, fractionInsidePolygon, pointInPolygon, strokeHitBySegment } from '../ink/geometry';
import { geometryOutline } from '../ink/recognize';
import { objectBounds, rectsIntersect } from './bounds';
import { compareZ } from '../util/zindex';

export function isHidden(o: CanvasObject): boolean {
  return o.kind === 'stroke' && !!o.beautifiedInto;
}

/** Inverse-rotates p into an object's unrotated frame. */
function unrotate(o: CanvasObject, p: Pt): Pt {
  if (!o.rotation) return p;
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const a = (-o.rotation * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** Is p (canvas units) on the object, within `tol` units? */
export function hitObject(o: CanvasObject, p: Pt, tol: number): boolean {
  if (isHidden(o)) return false;
  const b = objectBounds(o);
  if (!bboxContains({ x: b.x - tol, y: b.y - tol, w: b.w + 2 * tol, h: b.h + 2 * tol }, p)) return false;
  switch (o.kind) {
    case 'stroke':
      return strokeHitBySegment(o, p, p, tol);
    case 'shape': {
      const g = o.geometry;
      const reach = tol + o.lineWidth / 2;
      if (g.kind === 'line' || g.kind === 'arrow') return distPointSegment(p, g.a, g.b) <= reach;
      const outline = geometryOutline(g, 48);
      return pointInPolygon(p, outline) || distToPolygon(p, outline) <= reach;
    }
    default: {
      const q = unrotate(o, p);
      return q.x >= o.x - tol && q.x <= o.x + o.w + tol && q.y >= o.y - tol && q.y <= o.y + o.h + tol;
    }
  }
}

const isInk = (o: CanvasObject) => o.kind === 'stroke' || o.kind === 'shape';

/**
 * The object a tap at p selects: ink is drawn above text boxes, images and clips, so the
 * topmost ink object wins, then the topmost of the others.
 */
export function topHit(candidates: readonly CanvasObject[], p: Pt, tol: number): CanvasObject | null {
  const sorted = [...candidates].sort(compareZ);
  for (let i = sorted.length - 1; i >= 0; i--) if (isInk(sorted[i]) && hitObject(sorted[i], p, tol)) return sorted[i];
  for (let i = sorted.length - 1; i >= 0; i--) if (!isInk(sorted[i]) && hitObject(sorted[i], p, tol)) return sorted[i];
  return null;
}

/** Fraction of points that a lasso must enclose for a stroke to be selected. */
export const LASSO_FRACTION = 0.5;

/** Is the object enclosed by the lasso polygon (canvas units)? */
export function inLasso(o: CanvasObject, poly: readonly Pt[], polyBox: Rect = bbox(poly)): boolean {
  if (isHidden(o) || poly.length < 3) return false;
  const b = objectBounds(o);
  if (!rectsIntersect(b, polyBox)) return false;
  switch (o.kind) {
    case 'stroke':
      // a dot or very short stroke: its centre decides
      if (o.pts.length <= 6) return pointInPolygon({ x: o.x + o.w / 2, y: o.y + o.h / 2 }, poly);
      return fractionInsidePolygon(o, poly, polyBox) >= LASSO_FRACTION;
    case 'shape': {
      const outline = o.geometry.kind === 'line' || o.geometry.kind === 'arrow' ? [o.geometry.a, { x: (o.geometry.a.x + o.geometry.b.x) / 2, y: (o.geometry.a.y + o.geometry.b.y) / 2 }, o.geometry.b] : geometryOutline(o.geometry, 24);
      const inside = outline.filter((q) => pointInPolygon(q, poly)).length;
      return inside / outline.length >= LASSO_FRACTION;
    }
    default:
      return pointInPolygon({ x: o.x + o.w / 2, y: o.y + o.h / 2 }, poly);
  }
}

export function rectPolygon(r: Rect): Pt[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Ids of the candidates a lasso polygon selects (any mix of kinds). */
export function lassoSelect(candidates: Iterable<CanvasObject>, poly: readonly Pt[]): string[] {
  const box = bbox(poly);
  const out: string[] = [];
  for (const o of candidates) if (inLasso(o, poly, box)) out.push(o.id);
  return out;
}

/**
 * Adds the other members of every group touched by the selection. `members(group)` returns
 * the ids of a group's objects.
 */
export function expandGroups(ids: Iterable<string>, get: (id: string) => CanvasObject | undefined, members: (group: string) => Iterable<string>): string[] {
  const out = new Set<string>();
  const groups = new Set<string>();
  for (const id of ids) {
    out.add(id);
    const g = get(id)?.group;
    if (g) groups.add(g);
  }
  for (const g of groups) for (const id of members(g)) out.add(id);
  return [...out];
}

/** C8: the image a stroke is drawn over (most of its points inside the frame), topmost first. */
export function imageUnder(query: (r: Rect) => Iterable<CanvasObject>, pts: number[]): string | undefined {
  const flat: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i += 3) flat.push({ x: pts[i], y: pts[i + 1] });
  const images = [...query(bbox(flat))].filter((o) => o.kind === 'image').sort(compareZ).reverse();
  for (const img of images) {
    const poly = rotatedRectPolygon(img);
    let inside = 0;
    for (const p of flat) if (pointInPolygon(p, poly)) inside++;
    if (inside / flat.length >= 0.6) return img.id;
  }
  return undefined;
}

/** The corners of an object's frame, rotated with it. */
function rotatedRectPolygon(o: CanvasObject): Pt[] {
  const poly = rectPolygon(o);
  if (!o.rotation) return poly;
  const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  const a = (o.rotation * Math.PI) / 180;
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a), y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a) }));
}
