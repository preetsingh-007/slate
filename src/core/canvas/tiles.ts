/**
 * Tiled rendering of the ink layer (C3): strokes and shapes are drawn into square tiles at a
 * small set of zoom levels and composited to the screen, so panning and zooming only copy
 * bitmaps; a tile is redrawn only when an object whose bounds touch it changes.
 *
 * Levels are √2 apart: level L renders at 2^(L/2) × the 100% scale, and the level used for a
 * zoom z is the smallest one at least as sharp as z (so tiles are never upscaled by more than
 * a rounding error, and never rendered at more than √2 × the needed resolution).
 */
import type { Rect } from '../model/types';
import { rectsIntersect } from './bounds';

/** Tile edge in CSS pixels (device pixels = this × devicePixelRatio). */
export const TILE_PX = 256;

export function levelFor(zoom: number): number {
  return Math.ceil(2 * Math.log2(Math.max(1e-6, zoom)) - 1e-6);
}

export function levelScale(level: number): number {
  return Math.pow(2, level / 2);
}

/** Edge of a tile of `level`, in canvas units. */
export function tileUnits(level: number, base: number): number {
  return TILE_PX / (levelScale(level) * base);
}

export interface TileId {
  level: number;
  tx: number;
  ty: number;
}

export const tileKey = (t: TileId) => `${t.level}:${t.tx}:${t.ty}`;

export function tileRect(t: TileId, base: number): Rect {
  const u = tileUnits(t.level, base);
  return { x: t.tx * u, y: t.ty * u, w: u, h: u };
}

/**
 * Tiles of `level` covering the canvas rectangle `view`, nearest to the view's centre first
 * (so the middle of the screen fills in first). `margin` adds a ring of tiles around the view.
 */
export function tilesFor(view: Rect, level: number, base: number, margin = 0): TileId[] {
  const u = tileUnits(level, base);
  const x0 = Math.floor(view.x / u) - margin;
  const y0 = Math.floor(view.y / u) - margin;
  const x1 = Math.floor((view.x + view.w) / u) + margin;
  const y1 = Math.floor((view.y + view.h) / u) + margin;
  const out: TileId[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ level, tx, ty });
  const cx = (view.x + view.w / 2) / u - 0.5;
  const cy = (view.y + view.h / 2) / u - 0.5;
  return out.sort((a, b) => Math.hypot(a.tx - cx, a.ty - cy) - Math.hypot(b.tx - cx, b.ty - cy));
}

interface Entry<T> {
  id: TileId;
  rect: Rect;
  value: T;
  dirty: boolean;
}

/**
 * LRU cache of rendered tiles. Tiles touched by changed bounds are marked dirty: a dirty tile
 * can still be shown (better than a hole) while it is being redrawn.
 */
export class TileCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(
    private capacity: number,
    private base: number,
    private dispose: (value: T) => void = () => {},
  ) {}

  get size(): number {
    return this.map.size;
  }

  setCapacity(n: number) {
    this.capacity = Math.max(1, n);
    this.trim();
  }

  /** Changes the 100% scale; every tile is dropped (their canvas extent changed). */
  setBase(base: number) {
    if (base === this.base) return;
    this.base = base;
    this.clear();
  }

  get(t: TileId): { value: T; dirty: boolean } | undefined {
    const k = tileKey(t);
    const e = this.map.get(k);
    if (!e) return undefined;
    this.map.delete(k);
    this.map.set(k, e);
    return e;
  }

  peek(t: TileId): { value: T; dirty: boolean } | undefined {
    return this.map.get(tileKey(t));
  }

  set(t: TileId, value: T) {
    const k = tileKey(t);
    const prev = this.map.get(k);
    if (prev) {
      this.map.delete(k);
      if (prev.value !== value) this.dispose(prev.value);
    }
    this.map.set(k, { id: t, rect: tileRect(t, this.base), value, dirty: false });
    this.trim();
  }

  /** Takes a tile out of the cache to reuse its bitmap (the caller disposes or re-sets it). */
  take(t: TileId): T | undefined {
    const k = tileKey(t);
    const e = this.map.get(k);
    if (!e) return undefined;
    this.map.delete(k);
    return e.value;
  }

  /** Marks every cached tile intersecting one of `rects` dirty. Returns how many were marked. */
  invalidate(rects: readonly Rect[]): number {
    if (!rects.length) return 0;
    let n = 0;
    for (const e of this.map.values()) {
      if (e.dirty) continue;
      for (const r of rects) {
        if (rectsIntersect(e.rect, r)) {
          e.dirty = true;
          n++;
          break;
        }
      }
    }
    return n;
  }

  /** Cached tiles (any level) intersecting `r`, for painting new strokes straight into them. */
  intersecting(r: Rect): { id: TileId; value: T; dirty: boolean }[] {
    const out: { id: TileId; value: T; dirty: boolean }[] = [];
    for (const e of this.map.values()) if (!e.dirty && rectsIntersect(e.rect, r)) out.push(e);
    return out;
  }

  /** Cached tiles of `level` overlapping `r` (used to show other levels while one renders). */
  levelTiles(level: number, r: Rect): { id: TileId; value: T; dirty: boolean }[] {
    const out: { id: TileId; value: T; dirty: boolean }[] = [];
    for (const t of tilesFor(r, level, this.base)) {
      const e = this.map.get(tileKey(t));
      if (e) out.push(e);
    }
    return out;
  }

  clear() {
    for (const e of this.map.values()) this.dispose(e.value);
    this.map.clear();
  }

  private trim() {
    while (this.map.size > this.capacity) {
      const k = this.map.keys().next().value as string;
      const e = this.map.get(k)!;
      this.map.delete(k);
      this.dispose(e.value);
    }
  }
}

// ---------------------------------------------------------------- level of detail

export type Lod = 'full' | 'line' | 'dot';

/** Below this many CSS pixels per unit, strokes are drawn as simplified centre-lines. */
export const LINE_LOD_PX_PER_UNIT = 0.45;

/**
 * How to draw a stroke at a scale (C3: simplify strokes when zoomed far out): a mark smaller
 * than two pixels is a dot; far out, a stroke is its decimated centre-line (no outline to
 * compute); otherwise the full pressure-sensitive outline.
 */
export function strokeLod(w: number, h: number, pxPerUnit: number): Lod {
  if (Math.max(w, h) * pxPerUnit < 2) return 'dot';
  if (pxPerUnit < LINE_LOD_PX_PER_UNIT) return 'line';
  return 'full';
}

/** Decimates flat [x, y, p, …] to [x, y, …] keeping points at least `minDist` apart (and the ends). */
export function decimate(pts: readonly number[], minDist: number): number[] {
  const n = Math.floor(pts.length / 3);
  if (n === 0) return [];
  const out = [pts[0], pts[1]];
  let lx = pts[0];
  let ly = pts[1];
  const d2 = minDist * minDist;
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 3];
    const y = pts[i * 3 + 1];
    if ((x - lx) * (x - lx) + (y - ly) * (y - ly) >= d2) {
      out.push(x, y);
      lx = x;
      ly = y;
    }
  }
  if (n > 1) out.push(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1]);
  return out;
}
