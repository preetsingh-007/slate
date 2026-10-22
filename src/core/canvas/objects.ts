/**
 * Constructors for new canvas objects. Every object records when it was created and last
 * edited (C18) and the device that created it.
 */
import type { CanvasObject, ClipDisplay, ClipObject, ImageObject, ShapeGeometry, ShapeObject, SourceLink, StrokeObject, StrokeTool, TextObject } from '../model/types';
import { shapeKindOf } from '../ink/beautify';
import { shapeFrame, strokeFrame } from './transform';

export interface NewObjectContext {
  id: string;
  now: number;
  device: string;
  z: string;
}

function header(ctx: NewObjectContext) {
  return { id: ctx.id, rotation: 0, z: ctx.z, created: ctx.now, edited: ctx.now, device: ctx.device, topics: [] as string[] };
}

export function makeStroke(ctx: NewObjectContext, s: { pts: number[]; tool: StrokeTool; color: string; size: number; attached?: string }): StrokeObject {
  const o: StrokeObject = { ...header(ctx), kind: 'stroke', ...strokeFrame(s.pts), pts: s.pts, tool: s.tool, color: s.color, size: s.size };
  if (s.attached) o.attached = s.attached;
  return o;
}

/** Default text box width and font size (canvas units). */
export const TEXT_WIDTH = 360;
export const TEXT_FONT = 18;

export function makeText(ctx: NewObjectContext, t: { x: number; y: number; w?: number; content: string; fontSize?: number }): TextObject {
  const fontSize = t.fontSize ?? TEXT_FONT;
  return { ...header(ctx), kind: 'text', x: t.x, y: t.y, w: t.w ?? TEXT_WIDTH, h: Math.round(fontSize * 1.6), content: t.content, fontSize };
}

export function makeImage(ctx: NewObjectContext, i: { asset: string; mime: string; natural: { w: number; h: number }; x: number; y: number; w: number; h: number; alt?: string }): ImageObject {
  const o: ImageObject = { ...header(ctx), kind: 'image', x: i.x, y: i.y, w: i.w, h: i.h, asset: i.asset, mime: i.mime, natural: i.natural };
  if (i.alt) o.alt = i.alt;
  return o;
}

export function makeClip(
  ctx: NewObjectContext,
  c: { x: number; y: number; w: number; h: number; text: string; source: SourceLink; display: ClipDisplay; asset?: string; mime?: string; natural?: { w: number; h: number } },
): ClipObject {
  const o: ClipObject = { ...header(ctx), kind: 'clip', x: c.x, y: c.y, w: c.w, h: c.h, text: c.text, display: c.display, source: c.source };
  if (c.asset) {
    o.asset = c.asset;
    o.mime = c.mime ?? 'image/png';
    if (c.natural) o.natural = c.natural;
  }
  return o;
}

export function makeShape(ctx: NewObjectContext, s: { geometry: ShapeGeometry; color: string; lineWidth: number; originals: string[]; connects?: [string | null, string | null] }): ShapeObject {
  const o: ShapeObject = {
    ...header(ctx),
    kind: 'shape',
    ...shapeFrame(s.geometry, s.lineWidth),
    shape: shapeKindOf(s.geometry),
    geometry: s.geometry,
    color: s.color,
    lineWidth: s.lineWidth,
    originals: s.originals,
  };
  if (s.connects && (s.connects[0] || s.connects[1])) o.connects = s.connects;
  return o;
}

/** Default size of an image placed on the canvas: its pixel size, at most `maxW` × `maxH` units. */
export function fitImage(natural: { w: number; h: number }, maxW = 640, maxH = 640): { w: number; h: number } {
  const w = natural.w || maxW;
  const h = natural.h || maxW * 0.75;
  const k = Math.min(1, maxW / w, maxH / h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** Plain colour of an object, when it has one (strokes and shapes). */
export function objectColor(o: CanvasObject): string | null {
  return o.kind === 'stroke' || o.kind === 'shape' ? o.color : null;
}
