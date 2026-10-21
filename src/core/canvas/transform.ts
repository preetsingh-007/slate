/**
 * Moving, scaling and rotating canvas objects (C15), and translating them for space insertion
 * (C4). Strokes and shapes store absolute geometry, so their points are transformed; text
 * boxes, images and clips keep a frame and a rotation around its centre.
 *
 * A transform is p' = o + d + R(rot) · s · (p − o): uniform scale `s` and rotation `rot`
 * (degrees, clockwise with y down) around the origin `o`, then a translation `d`.
 */
import type { CanvasObject, ImageObject, Pt, ShapeGeometry, ShapeObject, StrokeObject } from '../model/types';
import { geometryBBox } from '../ink/shapes';
import type { ObjectPatch } from './model';
import { pointsBounds } from './bounds';

export interface Affine {
  ox: number;
  oy: number;
  s: number;
  rot: number;
  dx: number;
  dy: number;
}

export const IDENTITY: Affine = { ox: 0, oy: 0, s: 1, rot: 0, dx: 0, dy: 0 };

export const translation = (dx: number, dy: number): Affine => ({ ox: 0, oy: 0, s: 1, rot: 0, dx, dy });

export function isIdentity(t: Affine): boolean {
  return Math.abs(t.dx) < 1e-6 && Math.abs(t.dy) < 1e-6 && Math.abs(t.s - 1) < 1e-9 && Math.abs(t.rot % 360) < 1e-9;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function applyAffine(t: Affine, p: Pt): Pt {
  const a = (t.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const x = (p.x - t.ox) * t.s;
  const y = (p.y - t.oy) * t.s;
  return { x: t.ox + t.dx + x * cos - y * sin, y: t.oy + t.dy + x * sin + y * cos };
}

/** Normalises degrees into (-180, 180]. */
export function normDeg(d: number): number {
  let r = d % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r;
}

function mapPts(t: Affine, pts: readonly number[]): number[] {
  const out = pts.slice();
  for (let i = 0; i + 1 < out.length; i += 3) {
    const q = applyAffine(t, { x: pts[i], y: pts[i + 1] });
    out[i] = r1(q.x);
    out[i + 1] = r1(q.y);
  }
  return out;
}

const mp = (t: Affine, p: Pt): Pt => {
  const q = applyAffine(t, p);
  return { x: r1(q.x), y: r1(q.y) };
};

export function transformGeometry(g: ShapeGeometry, t: Affine): ShapeGeometry {
  switch (g.kind) {
    case 'line':
      return { ...g, a: mp(t, g.a), b: mp(t, g.b) };
    case 'arrow':
      return { ...g, a: mp(t, g.a), b: mp(t, g.b) };
    case 'circle': {
      const c = mp(t, { x: g.cx, y: g.cy });
      return { ...g, cx: c.x, cy: c.y, r: r1(g.r * t.s) };
    }
    case 'ellipse': {
      const c = mp(t, { x: g.cx, y: g.cy });
      return { ...g, cx: c.x, cy: c.y, rx: r1(g.rx * t.s), ry: r1(g.ry * t.s), rotation: r2(normDeg(g.rotation + t.rot)) };
    }
    case 'rectangle': {
      const c = mp(t, { x: g.cx, y: g.cy });
      return { ...g, cx: c.x, cy: c.y, w: r1(g.w * t.s), h: r1(g.h * t.s), rotation: r2(normDeg(g.rotation + t.rot)) };
    }
    case 'triangle':
      return { ...g, points: g.points.map((p) => mp(t, p)) as [Pt, Pt, Pt] };
    case 'diamond': {
      // a diamond has no rotation of its own: quarter turns swap its axes, other angles keep its orientation
      const c = mp(t, { x: g.cx, y: g.cy });
      const quarter = Math.round(normDeg(t.rot) / 90);
      const swap = Math.abs(normDeg(t.rot) - quarter * 90) < 1 && Math.abs(quarter) % 2 === 1;
      const w = r1(g.w * t.s);
      const h = r1(g.h * t.s);
      return { ...g, cx: c.x, cy: c.y, w: swap ? h : w, h: swap ? w : h };
    }
  }
}

/** Header frame (x, y, w, h) of a shape: the bounds of its rendered geometry. */
export function shapeFrame(g: ShapeGeometry, lineWidth: number): { x: number; y: number; w: number; h: number } {
  const b = geometryBBox(g, lineWidth);
  return { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) };
}

/** Frame of a stroke (bounds of its points). */
export function strokeFrame(pts: readonly number[]): { x: number; y: number; w: number; h: number } {
  const b = pointsBounds(pts);
  return { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) };
}

/** The patch that applies `t` to one object. */
export function transformObject(o: CanvasObject, t: Affine): ObjectPatch {
  switch (o.kind) {
    case 'stroke': {
      const pts = mapPts(t, o.pts);
      return { pts, size: r2(Math.max(0.3, o.size * t.s)), ...strokeFrame(pts) };
    }
    case 'shape': {
      const geometry = transformGeometry(o.geometry, t);
      const lineWidth = r2(Math.min(40, Math.max(0.5, o.lineWidth * t.s)));
      return { geometry, lineWidth, ...shapeFrame(geometry, lineWidth) };
    }
    default: {
      const c = applyAffine(t, { x: o.x + o.w / 2, y: o.y + o.h / 2 });
      const w = o.w * t.s;
      const h = o.h * t.s;
      const patch: ObjectPatch = { x: r1(c.x - w / 2), y: r1(c.y - h / 2), w: r1(w), h: r1(h) };
      if (t.rot) patch.rotation = r2(normDeg(o.rotation + t.rot));
      if (o.kind === 'text' && t.s !== 1) patch.fontSize = r2(Math.max(4, o.fontSize * t.s));
      return patch;
    }
  }
}

/** Fast translation patch (space insertion moves thousands of objects). */
export function translateObject(o: CanvasObject, dx: number, dy: number): ObjectPatch {
  if (o.kind === 'stroke') {
    const pts = o.pts.slice();
    for (let i = 0; i + 1 < pts.length; i += 3) {
      pts[i] = r1(pts[i] + dx);
      pts[i + 1] = r1(pts[i + 1] + dy);
    }
    return { pts, x: r1(o.x + dx), y: r1(o.y + dy) };
  }
  if (o.kind === 'shape') {
    const geometry = transformGeometry(o.geometry, translation(dx, dy));
    return { geometry, x: r1(o.x + dx), y: r1(o.y + dy) };
  }
  return { x: r1(o.x + dx), y: r1(o.y + dy) };
}

/** Read access to the canvas for dependents (attached strokes, connected arrows). */
export interface ObjectLookup {
  get(id: string): CanvasObject | undefined;
  /** strokes attached to an image */
  attachedTo(imageId: string): StrokeObject[];
  /** arrows and lines connected to a shape */
  connectedTo(shapeId: string): ShapeObject[];
}

/**
 * Patches for transforming a selection: the selected objects, the strokes drawn on selected
 * images (C8: they move, scale and rotate with the image) and the attached ends of arrows
 * connected to selected shapes that are not themselves selected (C10).
 */
export function transformSelection(objects: readonly CanvasObject[], t: Affine, lookup: ObjectLookup): Map<string, ObjectPatch> {
  const out = new Map<string, ObjectPatch>();
  const ids = new Set(objects.map((o) => o.id));
  const all: CanvasObject[] = [...objects];
  for (const o of objects) {
    if (o.kind !== 'image') continue;
    for (const s of lookup.attachedTo(o.id)) if (!ids.has(s.id)) (ids.add(s.id), all.push(s));
  }
  for (const o of all) out.set(o.id, transformObject(o, t));
  for (const o of objects) {
    if (o.kind !== 'shape') continue;
    for (const c of lookup.connectedTo(o.id)) {
      if (ids.has(c.id) || !c.connects || (c.geometry.kind !== 'line' && c.geometry.kind !== 'arrow')) continue;
      const prev = (out.get(c.id)?.geometry as ShapeGeometry | undefined) ?? c.geometry;
      if (prev.kind !== 'line' && prev.kind !== 'arrow') continue;
      const g = { ...prev };
      if (c.connects[0] === o.id) g.a = mp(t, prev.a);
      if (c.connects[1] === o.id) g.b = mp(t, prev.b);
      out.set(c.id, { geometry: g, ...shapeFrame(g, c.lineWidth) });
    }
  }
  return out;
}

/** Strokes drawn on an image, found among `objects` (C8). */
export function attachedStrokes(objects: Iterable<CanvasObject>, image: ImageObject | string): StrokeObject[] {
  const id = typeof image === 'string' ? image : image.id;
  const out: StrokeObject[] = [];
  for (const o of objects) if (o.kind === 'stroke' && o.attached === id) out.push(o);
  return out;
}
