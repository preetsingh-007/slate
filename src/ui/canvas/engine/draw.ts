/**
 * Drawing ink objects (strokes and shapes) onto a 2D context in canvas units. The caller sets
 * the transform (canvas units → device pixels); `pxPerUnit` picks the level of detail (C3).
 */
import type { CanvasObject, ShapeGeometry, ShapeObject, StrokeObject } from '../../../core/model/types';
import { HIGHLIGHTER_ALPHA, PathCache, resolveInkColor } from '../../../core/ink/render';
import { arrowHeadSize } from '../../../core/ink/shapes';
import { decimate, strokeLod } from '../../../core/canvas/tiles';

export const pathCache = new PathCache();

export interface DrawStyle {
  ink: string;
  pxPerUnit: number;
}

function strokeColor(s: StrokeObject, ink: string): string {
  return resolveInkColor(s.color, ink);
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeObject, st: DrawStyle) {
  if (s.pts.length < 3) return;
  const lod = strokeLod(s.w + s.size, s.h + s.size, st.pxPerUnit);
  ctx.globalAlpha = s.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1;
  const color = strokeColor(s, st.ink);
  if (lod === 'dot') {
    ctx.fillStyle = color;
    const px = 1.5 / st.pxPerUnit;
    ctx.fillRect(s.x, s.y, Math.max(px, s.w), Math.max(px, s.h));
  } else if (lod === 'line') {
    const flat = decimate(s.pts, 1.5 / st.pxPerUnit);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(s.size * 0.8, 0.8 / st.pxPerUnit);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(flat[0], flat[1]);
    if (flat.length === 2) ctx.lineTo(flat[0] + 0.01, flat[1]);
    for (let i = 2; i + 1 < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill(pathCache.get(s));
  }
  ctx.globalAlpha = 1;
}

function arrowHeadPath(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, tip: { x: number; y: number }, size: number) {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const h = size * 0.42;
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(bx - uy * h, by + ux * h);
  ctx.lineTo(bx + uy * h, by - ux * h);
  ctx.closePath();
  return { x: tip.x - ux * size * 0.8, y: tip.y - uy * size * 0.8 };
}

/** Traces a closed geometry's outline as the current path. */
function traceClosed(ctx: CanvasRenderingContext2D, g: ShapeGeometry) {
  switch (g.kind) {
    case 'circle':
      ctx.moveTo(g.cx + g.r, g.cy);
      ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
      break;
    case 'ellipse':
      ctx.ellipse(g.cx, g.cy, g.rx, g.ry, (g.rotation * Math.PI) / 180, 0, Math.PI * 2);
      break;
    case 'rectangle': {
      ctx.save();
      ctx.translate(g.cx, g.cy);
      if (g.rotation) ctx.rotate((g.rotation * Math.PI) / 180);
      const r = Math.min(6, Math.min(g.w, g.h) * 0.08);
      ctx.roundRect(-g.w / 2, -g.h / 2, g.w, g.h, r);
      ctx.restore();
      break;
    }
    case 'triangle':
      ctx.moveTo(g.points[0].x, g.points[0].y);
      ctx.lineTo(g.points[1].x, g.points[1].y);
      ctx.lineTo(g.points[2].x, g.points[2].y);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(g.cx, g.cy - g.h / 2);
      ctx.lineTo(g.cx + g.w / 2, g.cy);
      ctx.lineTo(g.cx, g.cy + g.h / 2);
      ctx.lineTo(g.cx - g.w / 2, g.cy);
      ctx.closePath();
      break;
    default:
      break;
  }
}

/** Draws a shape like Axiom's geometryToSvg: outline plus a faint tint for closed shapes. */
export function drawShape(ctx: CanvasRenderingContext2D, s: Pick<ShapeObject, 'geometry' | 'lineWidth' | 'color'>, st: DrawStyle) {
  const g = s.geometry;
  const color = resolveInkColor(s.color, st.ink);
  const sw = Math.max(s.lineWidth, 0.8 / st.pxPerUnit);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1;
  if (g.kind === 'line' || g.kind === 'arrow') {
    let a = g.a;
    let b = g.b;
    ctx.beginPath();
    if (g.kind === 'arrow') {
      const size = arrowHeadSize(Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), s.lineWidth);
      b = arrowHeadPath(ctx, g.a, g.b, size);
      if (g.heads === 'both') a = arrowHeadPath(ctx, g.b, g.a, size);
      ctx.fill();
      ctx.lineWidth = sw * 0.6;
      ctx.stroke();
      ctx.lineWidth = sw;
      ctx.beginPath();
    }
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  traceClosed(ctx, g);
  ctx.globalAlpha = 0.07;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
}

/**
 * Draws ink objects (z order is the caller's); hidden and non-ink objects are skipped.
 * Far out, runs of consecutive strokes with the same colour and width are drawn as one path
 * (one stroke() call for hundreds of centre-lines), which keeps zoomed-out tiles cheap (C3).
 */
export function drawInk(ctx: CanvasRenderingContext2D, objects: Iterable<CanvasObject>, st: DrawStyle, hidden?: ReadonlySet<string>) {
  let run: { color: string; width: number; alpha: number } | null = null;
  const flush = () => {
    if (!run) return;
    ctx.stroke();
    run = null;
  };
  for (const o of objects) {
    if (hidden?.has(o.id)) continue;
    if (o.kind === 'stroke') {
      if (o.beautifiedInto || o.pts.length < 3) continue;
      if (strokeLod(o.w + o.size, o.h + o.size, st.pxPerUnit) === 'line') {
        const color = resolveInkColor(o.color, st.ink);
        const width = Math.max(o.size * 0.8, 0.8 / st.pxPerUnit);
        const alpha = o.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1;
        if (!run || run.color !== color || run.width !== width || run.alpha !== alpha) {
          flush();
          run = { color, width, alpha };
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
        }
        const flat = decimate(o.pts, 1.5 / st.pxPerUnit);
        ctx.moveTo(flat[0], flat[1]);
        if (flat.length === 2) ctx.lineTo(flat[0] + 0.01, flat[1]);
        for (let i = 2; i + 1 < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
        continue;
      }
      flush();
      drawStroke(ctx, o, st);
    } else if (o.kind === 'shape') {
      flush();
      drawShape(ctx, o, st);
    }
  }
  flush();
  ctx.globalAlpha = 1;
}

/** A detached 2D canvas (OffscreenCanvas when available). */
export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export function ctx2d(c: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | null {
  return (c.getContext('2d') as CanvasRenderingContext2D | null) ?? null;
}
