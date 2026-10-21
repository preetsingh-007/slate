/**
 * Local space insertion and removal (C4), as a pure function of the objects' bounds.
 *
 * A split line, perpendicular to the axis, passes through the midpoint between the fingers
 * (or the drag start). Only the visible area is in scope:
 *
 * - objects that intersect the visible area and lie wholly on one side of the split move with
 *   that side (`before` / `after`: displacement along the axis, in canvas units);
 * - objects crossing the split line do not move;
 * - objects wholly outside the visible area do not move, except that an outside object a moved
 *   object would overlap (on its way: the swept area counts) is pushed by the same amount,
 *   repeating until nothing overlaps;
 * - removing space moves a side toward the split only until its objects are `gap` (8) units from
 *   another object; it never creates an overlap. Each side moves rigidly, so the layout within
 *   a side (handwriting, a diagram) is never compressed.
 *
 * Items are "units": the caller merges objects that must move together (a group, an image
 * with the strokes drawn on it) into one item with their union bounds.
 */
import type { Rect } from '../model/types';
import { SpatialIndex } from './spatial';

export type Axis = 'x' | 'y';

export interface SpaceItem {
  id: string;
  rect: Rect;
}

export interface SpaceRequest {
  items: readonly SpaceItem[];
  visible: Rect;
  axis: Axis;
  /** coordinate of the split line along the axis */
  split: number;
  /** displacement of the side before the split (negative: away from it, inserting space) */
  before: number;
  /** displacement of the side after the split (positive: away from it, inserting space) */
  after: number;
  /** minimum distance kept when removing space (C4: 8 units) */
  gap?: number;
}

export interface SpacePlan {
  /** item id → displacement along the axis (only items that move) */
  moves: Map<string, number>;
  /** displacements actually applied to each side (removal may be limited) */
  before: number;
  after: number;
  beforeIds: string[];
  afterIds: string[];
  /** outside items pushed along */
  pushedIds: string[];
}

export const SPACE_GAP = 8;

/** Dominant axis of a movement: the split runs perpendicular to it. */
export function dominantAxis(dx: number, dy: number): Axis {
  return Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
}

const lo = (r: Rect, a: Axis) => (a === 'y' ? r.y : r.x);
const hi = (r: Rect, a: Axis) => (a === 'y' ? r.y + r.h : r.x + r.w);
const crossLo = (r: Rect, a: Axis) => (a === 'y' ? r.x : r.y);
const crossHi = (r: Rect, a: Axis) => (a === 'y' ? r.x + r.w : r.y + r.h);

/** Positive-area overlap (touching does not count). */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function touchesView(r: Rect, v: Rect): boolean {
  return r.x <= v.x + v.w && v.x <= r.x + r.w && r.y <= v.y + v.h && v.y <= r.y + r.h;
}

function shifted(r: Rect, a: Axis, d: number): Rect {
  return a === 'y' ? { ...r, y: r.y + d } : { ...r, x: r.x + d };
}

/** The area a rectangle passes through when shifted by d along the axis. */
function swept(r: Rect, a: Axis, d: number): Rect {
  if (a === 'y') return { x: r.x, y: Math.min(r.y, r.y + d), w: r.w, h: r.h + Math.abs(d) };
  return { x: Math.min(r.x, r.x + d), y: r.y, w: r.w + Math.abs(d), h: r.h };
}

/** Builds a rectangle from axis and cross-axis intervals. */
function band(a: Axis, from: number, to: number, cFrom: number, cTo: number): Rect {
  return a === 'y' ? { x: cFrom, y: from, w: cTo - cFrom, h: to - from } : { x: from, y: cFrom, w: to - from, h: cTo - cFrom };
}

function indexOf(items: readonly SpaceItem[]): SpatialIndex {
  const idx = new SpatialIndex();
  for (const it of items) idx.set(it.id, it.rect);
  return idx;
}

export function computeSpace(req: SpaceRequest): SpacePlan {
  const { axis: a, split, visible } = req;
  const gap = req.gap ?? SPACE_GAP;
  const byId = new Map(req.items.map((it) => [it.id, it]));
  const before: SpaceItem[] = [];
  const after: SpaceItem[] = [];
  const cross: SpaceItem[] = [];
  const outside: SpaceItem[] = [];
  for (const it of req.items) {
    if (!touchesView(it.rect, visible)) outside.push(it);
    else if (hi(it.rect, a) <= split) before.push(it);
    else if (lo(it.rect, a) >= split) after.push(it);
    else cross.push(it);
  }

  const plan: SpacePlan = { moves: new Map(), before: 0, after: 0, beforeIds: before.map((i) => i.id), afterIds: after.map((i) => i.id), pushedIds: [] };
  const removeBefore = req.before > 0 && before.length > 0;
  const removeAfter = req.after < 0 && after.length > 0;

  // ---- removal: how far each side may move toward the split
  let tB = removeBefore ? req.before : 0;
  let tA = removeAfter ? -req.after : 0;
  if (removeBefore || removeAfter) {
    // obstacles that do not move toward the split: crossing and outside items, plus the other side when it is not also closing in
    const statics = [...cross, ...outside, ...(removeAfter ? [] : after), ...(removeBefore ? [] : before)];
    const sIdx = indexOf(statics);
    const limit = (movers: SpaceItem[], t: number, dir: 1 | -1) => {
      let lim = t;
      for (const m of movers) {
        const r = m.rect;
        const region = dir > 0 ? band(a, hi(r, a), hi(r, a) + lim + gap, crossLo(r, a) - gap, crossHi(r, a) + gap) : band(a, lo(r, a) - lim - gap, lo(r, a), crossLo(r, a) - gap, crossHi(r, a) + gap);
        for (const id of sIdx.query(region)) {
          const o = byId.get(id)!.rect;
          if (crossLo(o, a) >= crossHi(r, a) + gap || crossHi(o, a) <= crossLo(r, a) - gap) continue;
          // only obstacles ahead (already overlapping ones are beside, not in the way)
          if (dir > 0 && lo(o, a) >= hi(r, a)) lim = Math.min(lim, Math.max(0, lo(o, a) - hi(r, a) - gap));
          if (dir < 0 && hi(o, a) <= lo(r, a)) lim = Math.min(lim, Math.max(0, lo(r, a) - hi(o, a) - gap));
        }
        if (lim <= 0) return 0;
      }
      return lim;
    };
    if (removeBefore) tB = limit(before, tB, 1);
    if (removeAfter) tA = limit(after, tA, -1);
    if (removeBefore && removeAfter && tA + tB > 0) {
      // the two sides close in on each other: their combined travel is limited by the closest pair
      const bIdx = indexOf(before);
      let room = tA + tB;
      for (const m of after) {
        const r = m.rect;
        for (const id of bIdx.query(band(a, lo(r, a) - room - gap, lo(r, a), crossLo(r, a) - gap, crossHi(r, a) + gap))) {
          const o = byId.get(id)!.rect;
          if (crossLo(o, a) >= crossHi(r, a) + gap || crossHi(o, a) <= crossLo(r, a) - gap) continue;
          if (hi(o, a) <= lo(r, a)) room = Math.min(room, Math.max(0, lo(r, a) - hi(o, a) - gap));
        }
      }
      if (tA + tB > room) {
        const k = room / (tA + tB);
        tA *= k;
        tB *= k;
      }
    }
  }
  plan.before = req.before > 0 ? (removeBefore ? tB : 0) : req.before;
  plan.after = req.after < 0 ? (removeAfter && tA ? -tA : 0) : req.after;

  for (const it of before) if (plan.before) plan.moves.set(it.id, plan.before);
  for (const it of after) if (plan.after) plan.moves.set(it.id, plan.after);

  // ---- insertion: push outside items a moving item would run into, transitively
  const oIdx = indexOf(outside);
  const push = (movers: SpaceItem[], d: number) => {
    if (!d) return;
    const queue = [...movers];
    while (queue.length) {
      const u = queue.pop()!;
      const sw = swept(u.rect, a, d);
      for (const id of oIdx.query(sw)) {
        if (plan.moves.has(id)) continue;
        const v = byId.get(id)!;
        if (!overlaps(sw, v.rect) || overlaps(u.rect, v.rect)) continue;
        plan.moves.set(id, d);
        plan.pushedIds.push(id);
        queue.push(v);
      }
    }
  };
  if (plan.before < 0) push(before, plan.before);
  if (plan.after > 0) push(after, plan.after);
  return plan;
}

/** New bounds of every moved item (for previews and tests). */
export function applySpace(items: readonly SpaceItem[], plan: SpacePlan, axis: Axis): SpaceItem[] {
  return items.map((it) => {
    const d = plan.moves.get(it.id);
    return d ? { id: it.id, rect: shifted(it.rect, axis, d) } : it;
  });
}
