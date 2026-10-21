/**
 * Canvas objects → standalone SVG, used for selection export (C15), drag-out (S11) and the
 * derived day and mark files (G5). Text boxes are written as plain text lines (their
 * Markdown source), so the SVG renders anywhere, including GitHub.
 */
import type { CanvasObject, ShapeGeometry, Rect } from '../model/types';
import { geometryToSvg } from '../ink/shapes';
import { strokeToSvgPath, HIGHLIGHTER_ALPHA, CURRENT_INK } from '../ink/render';
import { escapeXml, safeColor } from '../ink/svgsafe';
import { compareZ } from '../util/zindex';
import { objectBounds, unionRect } from './bounds';

const f = (n: number) => String(Math.round(n * 10) / 10);

export interface SvgOptions {
  /** href for an asset (e.g. `../assets/<hash>.png`, or a data: URI for rasterising) */
  assetHref(hash: string, mime: string): string;
  /** colour for strokes stored as the current ink colour */
  inkColor?: string;
  background?: string;
  padding?: number;
  /** clip to this region instead of the objects' bounds */
  region?: Rect;
}

/** Bounds of a set of objects as drawn. */
export function objectsBounds(objects: readonly CanvasObject[]): Rect | null {
  let r: Rect | null = null;
  for (const o of objects) {
    if (o.kind === 'stroke' && o.beautifiedInto) continue;
    r = unionRect(r, objectBounds(o));
  }
  return r;
}

export function objectsToSvg(objects: readonly CanvasObject[], opts: SvgOptions): string {
  const ink = opts.inkColor ?? '#1f2328';
  const pad = opts.padding ?? 16;
  const visible = [...objects].filter((o) => !(o.kind === 'stroke' && o.beautifiedInto)).sort(compareZ);
  const b = opts.region ?? objectsBounds(visible) ?? { x: 0, y: 0, w: 1, h: 1 };
  const vb = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${f(vb.x)} ${f(vb.y)} ${f(vb.w)} ${f(vb.h)}" width="${f(vb.w)}" height="${f(vb.h)}">`,
  ];
  if (opts.background) parts.push(`<rect x="${f(vb.x)}" y="${f(vb.y)}" width="${f(vb.w)}" height="${f(vb.h)}" fill="${safeColor(opts.background, '#ffffff')}"/>`);
  // non-ink objects first (they render under the ink layer in the app too)
  for (const o of visible) if (o.kind === 'text' || o.kind === 'image' || o.kind === 'clip') parts.push(objectSvg(o, ink, opts));
  for (const o of visible) if (o.kind === 'stroke' || o.kind === 'shape') parts.push(objectSvg(o, ink, opts));
  parts.push('</svg>');
  return parts.join('');
}

function rotation(o: CanvasObject): string {
  if (!o.rotation) return '';
  return ` transform="rotate(${f(o.rotation)} ${f(o.x + o.w / 2)} ${f(o.y + o.h / 2)})"`;
}

function color(c: string, ink: string): string {
  return c === CURRENT_INK ? ink : safeColor(c, ink);
}

function objectSvg(o: CanvasObject, ink: string, opts: SvgOptions): string {
  switch (o.kind) {
    case 'stroke': {
      const op = o.tool === 'highlighter' ? ` fill-opacity="${HIGHLIGHTER_ALPHA}"` : '';
      return `<path d="${strokeToSvgPath(o)}" fill="${color(o.color, ink)}"${op}/>`;
    }
    case 'shape':
      return `<g color="${color(o.color, ink)}">${shapeSvg(o.geometry, o.lineWidth)}</g>`;
    case 'text': {
      const size = o.fontSize || 18;
      const lines = o.content.split('\n');
      const tspans = lines.map((ln, i) => `<tspan x="${f(o.x)}" y="${f(o.y + size * (i + 1) * 1.3)}">${escapeXml(ln) || ' '}</tspan>`).join('');
      return `<text font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="${f(size)}" fill="${ink}" xml:space="preserve"${rotation(o)}>${tspans}</text>`;
    }
    case 'image': {
      const href = escapeXml(opts.assetHref(o.asset, o.mime));
      if (o.crop) {
        const c = o.crop;
        // scale the full image so the cropped part fills the frame
        const fw = o.w / c.w;
        const fh = o.h / c.h;
        const id = `c${o.id}`;
        return `<g${rotation(o)}><clipPath id="${id}"><rect x="${f(o.x)}" y="${f(o.y)}" width="${f(o.w)}" height="${f(o.h)}"/></clipPath><image clip-path="url(#${id})" href="${href}" x="${f(o.x - c.x * fw)}" y="${f(o.y - c.y * fh)}" width="${f(fw)}" height="${f(fh)}" preserveAspectRatio="none"/></g>`;
      }
      return `<image href="${href}" x="${f(o.x)}" y="${f(o.y)}" width="${f(o.w)}" height="${f(o.h)}" preserveAspectRatio="none"${rotation(o)}/>`;
    }
    case 'clip': {
      if (o.asset && o.display !== 'text') {
        return `<image href="${escapeXml(opts.assetHref(o.asset, o.mime ?? 'image/png'))}" x="${f(o.x)}" y="${f(o.y)}" width="${f(o.w)}" height="${f(o.h)}" preserveAspectRatio="xMidYMid meet"${rotation(o)}/>`;
      }
      const size = 16;
      const lines = o.text.split('\n').slice(0, Math.max(1, Math.floor(o.h / (size * 1.3))));
      const tspans = lines.map((ln, i) => `<tspan x="${f(o.x + 8)}" y="${f(o.y + size * (i + 1) * 1.3)}">${escapeXml(ln) || ' '}</tspan>`).join('');
      return `<g${rotation(o)}><rect x="${f(o.x)}" y="${f(o.y)}" width="${f(o.w)}" height="${f(o.h)}" fill="none" stroke="#9aa1a8" stroke-width="1"/><text font-family="sans-serif" font-size="${size}" fill="${ink}" xml:space="preserve">${tspans}</text></g>`;
    }
  }
}

/** SVG for a shape geometry; colours use currentColor (Axiom's generator, see core/ink/shapes). */
export function shapeSvg(g: ShapeGeometry, sw: number): string {
  return geometryToSvg(g, sw);
}
