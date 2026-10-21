/**
 * Stroke rendering: perfect-freehand outlines → Path2D (canvas) or SVG path data (export).
 * All geometry is in canvas units; canvases apply `scale * dpr` as a transform so cached
 * paths stay valid across zoom levels.
 */
import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { InkStroke as Stroke } from './types';
import { bboxIntersects, strokeBBox, type BBox } from './geometry';

/** Special colour value stored in strokes: resolved at render time to `--ink-default`. */
export const CURRENT_INK = 'currentInk';
/** Opacity applied to highlighter strokes. */
export const HIGHLIGHTER_ALPHA = 0.35;
/** Highlighter strokes are this much wider than their stored `size`. */
export const HIGHLIGHTER_WIDTH_FACTOR = 1;

const easeOutSine = (t: number) => Math.sin((t * Math.PI) / 2);

/** perfect-freehand options tuned for handwriting (pen) and flat markers (highlighter). */
export function freehandOptions(stroke: Pick<Stroke, 'size' | 'tool'>, last = true): StrokeOptions {
  if (stroke.tool === 'highlighter') {
    return {
      size: stroke.size * HIGHLIGHTER_WIDTH_FACTOR,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.45,
      simulatePressure: false,
      start: { cap: false, taper: 0 },
      end: { cap: false, taper: 0 },
      last,
    };
  }
  return {
    size: stroke.size,
    thinning: 0.6,
    smoothing: 0.55,
    streamline: 0.3,
    easing: easeOutSine,
    simulatePressure: false,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    last,
  };
}

/** Converts flat [x, y, p, ...] into perfect-freehand input. */
export function toFreehandInput(pts: readonly number[], extra?: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) out.push([pts[i], pts[i + 1], pts[i + 2] || 0.5]);
  if (extra) for (let i = 0; i + 2 < extra.length; i += 3) out.push([extra[i], extra[i + 1], extra[i + 2] || 0.5]);
  return out;
}

/** Outline polygon of a stroke (logical units). `extra` = predicted points (wet ink only). */
export function strokeOutline(stroke: Pick<Stroke, 'pts' | 'size' | 'tool'>, opts: { last?: boolean; extra?: readonly number[] } = {}): [number, number][] {
  const input = toFreehandInput(stroke.pts, opts.extra);
  if (!input.length) return [];
  return getStroke(input, freehandOptions(stroke, opts.last ?? true)) as [number, number][];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** SVG path data (quadratic smoothing through midpoints) for an outline polygon. */
export function outlineToSvgPath(outline: readonly [number, number][], scale = 1): string {
  const n = outline.length;
  if (n === 0) return '';
  const p = (i: number) => outline[i % n];
  if (n < 4) {
    return `M${outline.map(([x, y]) => `${r1(x * scale)},${r1(y * scale)}`).join('L')}Z`;
  }
  let d = `M${r1(((p(0)[0] + p(1)[0]) / 2) * scale)},${r1(((p(0)[1] + p(1)[1]) / 2) * scale)}`;
  for (let i = 1; i <= n; i++) {
    const a = p(i);
    const b = p(i + 1);
    d += `Q${r1(a[0] * scale)},${r1(a[1] * scale)} ${r1(((a[0] + b[0]) / 2) * scale)},${r1(((a[1] + b[1]) / 2) * scale)}`;
  }
  return d + 'Z';
}

/** SVG path data of a stroke's filled outline, in logical units. */
export function strokeToSvgPath(stroke: Pick<Stroke, 'pts' | 'size' | 'tool'>): string {
  return outlineToSvgPath(strokeOutline(stroke));
}

/** Appends an outline to a Path2D (or any CanvasPath-like sink) with midpoint quadratic smoothing. */
export function traceOutline(path: Pick<Path2D, 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'closePath'>, outline: readonly [number, number][], scale = 1) {
  const n = outline.length;
  if (n === 0) return;
  if (n < 4) {
    path.moveTo(outline[0][0] * scale, outline[0][1] * scale);
    for (let i = 1; i < n; i++) path.lineTo(outline[i][0] * scale, outline[i][1] * scale);
    path.closePath();
    return;
  }
  const p = (i: number) => outline[i % n];
  path.moveTo(((p(0)[0] + p(1)[0]) / 2) * scale, ((p(0)[1] + p(1)[1]) / 2) * scale);
  for (let i = 1; i <= n; i++) {
    const a = p(i);
    const b = p(i + 1);
    path.quadraticCurveTo(a[0] * scale, a[1] * scale, ((a[0] + b[0]) / 2) * scale, ((a[1] + b[1]) / 2) * scale);
  }
  path.closePath();
}

/** Path2D of the stroke outline. With the default scale of 1 the path is in logical units. */
export function strokeToPath2D(stroke: Pick<Stroke, 'pts' | 'size' | 'tool'>, scale = 1): Path2D {
  const path = new Path2D();
  traceOutline(path, strokeOutline(stroke), scale);
  return path;
}

interface CacheEntry {
  pts: readonly number[];
  size: number;
  tool: Stroke['tool'];
  /** built lazily: bbox queries (hit testing) never need a Path2D */
  path: Path2D | null;
  box: BBox;
}

/**
 * Per-stroke Path2D cache keyed by stroke id and validated by the identity of the `pts`
 * array (strokes are immutable values in the Y.Array: an edit replaces the object).
 */
export class PathCache {
  private map = new Map<string, CacheEntry>();

  private entry(stroke: Stroke): CacheEntry {
    const hit = this.map.get(stroke.id);
    if (hit && hit.pts === stroke.pts && hit.size === stroke.size && hit.tool === stroke.tool) return hit;
    const e: CacheEntry = { pts: stroke.pts, size: stroke.size, tool: stroke.tool, path: null, box: strokeBBox(stroke) };
    this.map.set(stroke.id, e);
    return e;
  }

  get(stroke: Stroke): Path2D {
    const e = this.entry(stroke);
    if (!e.path) e.path = strokeToPath2D(stroke);
    return e.path;
  }

  /** Bounding box of the stroke centre-line (cached). */
  box(stroke: Stroke): BBox {
    return this.entry(stroke).box;
  }

  delete(id: string) {
    this.map.delete(id);
  }

  /** Drops entries for ids not in `keep`. */
  prune(keep: Set<string>) {
    for (const id of this.map.keys()) if (!keep.has(id)) this.map.delete(id);
  }

  clear() {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** Resolves a stored stroke colour to a CSS colour. */
export function resolveInkColor(color: string, inkDefault: string): string {
  if (!color || color === CURRENT_INK) return inkDefault;
  return color;
}

export interface RenderOptions {
  cache?: PathCache;
  /** resolved value of --ink-default */
  inkColor?: string;
  /** stroke ids to skip (e.g. hidden under beautified items, or being dragged) */
  hidden?: ReadonlySet<string>;
  /** clear the whole canvas first (default true) */
  clear?: boolean;
  /** logical-space rectangle; strokes outside are skipped */
  viewport?: BBox;
  /** force a single colour for every stroke (e.g. black for OCR rasterisation) */
  colorOverride?: string;
  /** logical-space offset applied before drawing (used by the rasteriser) */
  offset?: { x: number; y: number };
}

const fallbackCache = new PathCache();

/**
 * Draws strokes onto a 2D context. `scale` maps logical units to CSS pixels and `dpr`
 * CSS pixels to device pixels. Returns the number of strokes drawn.
 */
export function renderStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], scale: number, dpr: number, opts: RenderOptions = {}): number {
  const cache = opts.cache ?? fallbackCache;
  const ink = opts.inkColor ?? '#1d2230';
  if (opts.clear !== false) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  const k = scale * dpr;
  const ox = opts.offset?.x ?? 0;
  const oy = opts.offset?.y ?? 0;
  ctx.setTransform(k, 0, 0, k, -ox * k, -oy * k);
  let drawn = 0;
  let lastAlpha = -1;
  let lastColor = '';
  for (const s of strokes) {
    if (opts.hidden?.has(s.id)) continue;
    if (s.pts.length < 3) continue;
    if (opts.viewport) {
      const b = cache.box(s);
      const pad = s.size;
      if (!bboxIntersects({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, opts.viewport)) continue;
    }
    const alpha = s.tool === 'highlighter' && !opts.colorOverride ? HIGHLIGHTER_ALPHA : 1;
    if (alpha !== lastAlpha) {
      ctx.globalAlpha = alpha;
      lastAlpha = alpha;
    }
    const color = opts.colorOverride ?? resolveInkColor(s.color, ink);
    if (color !== lastColor) {
      ctx.fillStyle = color;
      lastColor = color;
    }
    ctx.fill(cache.get(s));
    drawn++;
  }
  ctx.globalAlpha = 1;
  return drawn;
}

