/**
 * The committed ink layer (C3): strokes and shapes rendered into cached tiles and composited
 * onto one screen-sized canvas. Only tiles under the view are drawn, nearest the centre first,
 * within a time budget per frame; while a tile renders, cached tiles of neighbouring levels
 * stand in for it. Changed bounds invalidate the tiles they touch; a new stroke on top of
 * everything is painted straight into the cached tiles instead.
 */
import type { CanvasChange, CanvasModel } from '../../../core/canvas/model';
import type { CanvasObject, Rect } from '../../../core/model/types';
import type { Camera } from '../../../core/canvas/camera';
import { objectBounds } from '../../../core/canvas/bounds';
import { levelFor, levelScale, TILE_PX, TileCache, tileKey, tileRect, tilesFor, type TileId } from '../../../core/canvas/tiles';
import { compareZ } from '../../../core/util/zindex';
import { ctx2d, drawInk, makeCanvas } from './draw';

type Bitmap = HTMLCanvasElement | OffscreenCanvas;

const isInk = (o: CanvasObject) => o.kind === 'stroke' || o.kind === 'shape';

export class TileLayer {
  private cache: TileCache<Bitmap>;
  private pool: Bitmap[] = [];
  /** last known bounds of every ink object (to invalidate where an object was) */
  private known = new Map<string, Rect>();
  private topZ = '';
  private hidden = new Set<string>();
  ink = '#1f2328';
  /** tiles rendered since the last call to `takeRendered` (for tests and perf counters) */
  rendered = 0;

  constructor(
    private model: CanvasModel,
    private base: number,
    private dpr: number,
    private capacity = 96,
  ) {
    this.cache = new TileCache<Bitmap>(capacity, base, (c) => this.pool.length < 16 && this.pool.push(c));
    for (const o of model.objects()) this.track(o);
  }

  setBase(base: number, dpr: number) {
    if (base === this.base && dpr === this.dpr) return;
    this.base = base;
    this.dpr = dpr;
    this.pool = [];
    this.cache = new TileCache<Bitmap>(this.capacity, base, (c) => this.pool.length < 16 && this.pool.push(c));
  }

  setInk(ink: string) {
    if (ink === this.ink) return;
    this.ink = ink;
    this.cache.clear();
  }

  clear() {
    this.cache.clear();
  }

  private track(o: CanvasObject) {
    if (!isInk(o)) return;
    this.known.set(o.id, objectBounds(o));
    if (o.z > this.topZ) this.topZ = o.z;
  }

  /** Objects hidden from the tiles (being dragged, erased, moved by space insertion). */
  setHidden(ids: Iterable<string>) {
    const next = new Set(ids);
    const rects: Rect[] = [];
    for (const id of this.hidden) if (!next.has(id)) pushKnown(rects, this.known.get(id));
    for (const id of next) if (!this.hidden.has(id)) pushKnown(rects, this.known.get(id));
    this.hidden = next;
    this.invalidate(rects);
  }

  isHidden(id: string): boolean {
    return this.hidden.has(id);
  }

  invalidate(rects: Rect[]) {
    if (rects.length > 400) this.cache.invalidate([unionAll(rects)]);
    else this.cache.invalidate(rects);
  }

  /** Applies a model change: invalidates touched tiles, or paints a new top stroke directly. */
  onChange(change: CanvasChange) {
    const rects: Rect[] = [];
    const paint: CanvasObject[] = [];
    for (const id of change.removed) {
      pushKnown(rects, this.known.get(id));
      this.known.delete(id);
    }
    for (const id of change.changed) {
      const o = this.model.get(id);
      const prev = this.known.get(id);
      if (!o || !isInk(o)) {
        if (prev) rects.push(prev);
        this.known.delete(id);
        continue;
      }
      const b = objectBounds(o);
      const onTop = !prev && !change.remote && o.z >= this.topZ && !this.hidden.has(id) && !(o.kind === 'stroke' && o.beautifiedInto);
      this.track(o);
      if (onTop) paint.push(o);
      else {
        if (prev) rects.push(prev);
        rects.push(b);
      }
    }
    this.invalidate(rects);
    if (paint.length) this.paintOnto(paint.sort(compareZ));
  }

  private paintOnto(objs: CanvasObject[]) {
    for (const o of objs) {
      for (const e of this.cache.intersecting(objectBounds(o))) {
        const ctx = ctx2d(e.value);
        if (!ctx) continue;
        this.setTileTransform(ctx, e.id);
        drawInk(ctx, [o], { ink: this.ink, pxPerUnit: levelScale(e.id.level) * this.base });
      }
    }
  }

  private setTileTransform(ctx: CanvasRenderingContext2D, t: TileId) {
    const r = tileRect(t, this.base);
    const k = levelScale(t.level) * this.base * this.dpr;
    ctx.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
  }

  private renderTile(t: TileId): Bitmap {
    const px = Math.round(TILE_PX * this.dpr);
    const reuse = this.cache.take(t);
    const c = reuse ?? this.pool.pop() ?? makeCanvas(px, px);
    if (c.width !== px) c.width = px;
    if (c.height !== px) c.height = px;
    const ctx = ctx2d(c);
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      const r = tileRect(t, this.base);
      const objs = this.model.query(r).filter(isInk);
      this.setTileTransform(ctx, t);
      drawInk(ctx, objs, { ink: this.ink, pxPerUnit: levelScale(t.level) * this.base }, this.hidden);
    }
    this.cache.set(t, c);
    this.rendered++;
    return c;
  }

  /** Cache size for a view of w × h CSS pixels: the view and a ring around it, plus one more level. */
  sizeFor(w: number, h: number) {
    // tiles show at 1/√2 to 1 × their size, so up to √2 more of them per axis than at 100%
    const cols = Math.ceil((w * Math.SQRT2) / TILE_PX) + 1;
    const rows = Math.ceil((h * Math.SQRT2) / TILE_PX) + 1;
    this.capacity = Math.min(200, (cols + 2) * (rows + 2) + cols * rows);
    this.cache.setCapacity(this.capacity);
  }

  /**
   * Renders missing or stale tiles under the view (plus a ring around it when time allows)
   * within `budgetMs`. Returns true when everything visible is fresh.
   */
  renderPending(cam: Camera, w: number, h: number, budgetMs: number): boolean {
    const level = levelFor(cam.zoom);
    const view = this.view(cam, w, h);
    const t0 = performance.now();
    const visible = tilesFor(view, level, this.base);
    // the visible tiles are the most recently used: rendering others never evicts them
    for (const t of visible) this.cache.get(t);
    for (const t of visible) {
      const e = this.cache.peek(t);
      if (e && !e.dirty) continue;
      if (performance.now() - t0 > budgetMs) return false;
      this.renderTile(t);
    }
    const ring = tilesFor(view, level, this.base, 1);
    if (ring.length <= this.capacity - visible.length / 2 && performance.now() - t0 < budgetMs / 2) {
      // prefetch one ring around the view for panning
      const inView = new Set(visible.map(tileKey));
      for (const t of ring) {
        if (inView.has(tileKey(t))) continue;
        const e = this.cache.peek(t);
        if (e && !e.dirty) continue;
        if (performance.now() - t0 > budgetMs / 2) break;
        this.renderTile(t);
        for (const v of visible) this.cache.get(v);
      }
    }
    return this.isFresh(cam, w, h);
  }

  private view(cam: Camera, w: number, h: number): Rect {
    const k = cam.zoom * this.base;
    return { x: cam.x, y: cam.y, w: w / k, h: h / k };
  }

  /** True when every tile under the view is rendered and current. */
  isFresh(cam: Camera, w: number, h: number): boolean {
    const level = levelFor(cam.zoom);
    for (const t of tilesFor(this.view(cam, w, h), level, this.base)) {
      const e = this.cache.peek(t);
      if (!e || e.dirty) return false;
    }
    return true;
  }

  /** Draws the tiles under the view onto the screen canvas (device pixels). */
  composite(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number) {
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const level = levelFor(cam.zoom);
    const view = this.view(cam, w, h);
    const k = cam.zoom * this.base * dpr;
    const place = (r: Rect) => {
      const x0 = Math.round((r.x - cam.x) * k);
      const y0 = Math.round((r.y - cam.y) * k);
      const x1 = Math.round((r.x + r.w - cam.x) * k);
      const y1 = Math.round((r.y + r.h - cam.y) * k);
      return [x0, y0, x1 - x0, y1 - y0] as const;
    };
    ctx.imageSmoothingEnabled = true;
    for (const t of tilesFor(view, level, this.base)) {
      const e = this.cache.get(t);
      if (e) {
        ctx.drawImage(e.value as CanvasImageSource, ...place(tileRect(t, this.base)));
        continue;
      }
      // stand-ins from neighbouring levels while this tile renders
      const r = tileRect(t, this.base);
      for (const l of [level + 1, level - 1, level + 2, level - 2, level - 3]) {
        const subs = this.cache.levelTiles(l, r);
        if (!subs.length) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(...place(r));
        ctx.clip();
        for (const s of subs) ctx.drawImage(s.value as CanvasImageSource, ...place(tileRect(s.id, this.base)));
        ctx.restore();
        break;
      }
    }
  }
}

function pushKnown(rects: Rect[], r: Rect | undefined) {
  if (r) rects.push(r);
}

function unionAll(rects: Rect[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
