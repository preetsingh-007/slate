/**
 * The view onto an unbounded canvas (C1, C2). A camera is the canvas point at the view's
 * top-left corner plus a zoom factor; `base` converts canvas units to CSS pixels at 100%.
 *
 *   screen = (canvas − camera) · zoom · base
 *
 * At 100% zoom 1,000 units span the default writing width (C1), so `base` is derived from the
 * window width (not the pane width, so moving the divider does not rescale the ink).
 */
import type { Pt, Rect } from '../model/types';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** Canvas units spanning the default writing width at 100% (C1). */
export const WRITING_WIDTH_UNITS = 1000;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * CSS pixels per canvas unit at 100%: the default writing width is the window width less a
 * margin, between 320 and 1200 px (an iPad in landscape writes about 1,100 px wide).
 */
export function baseScale(windowWidth: number): number {
  const writing = Math.min(1200, Math.max(320, windowWidth - 48));
  return writing / WRITING_WIDTH_UNITS;
}

/** CSS pixels per canvas unit. */
export function pxPerUnit(cam: Camera, base: number): number {
  return cam.zoom * base;
}

export function toScreen(cam: Camera, base: number, p: Pt): Pt {
  const k = cam.zoom * base;
  return { x: (p.x - cam.x) * k, y: (p.y - cam.y) * k };
}

export function toCanvas(cam: Camera, base: number, sx: number, sy: number): Pt {
  const k = cam.zoom * base;
  return { x: cam.x + sx / k, y: cam.y + sy / k };
}

/** Canvas rectangle visible in a view of `w` × `h` CSS pixels. */
export function viewRect(cam: Camera, base: number, w: number, h: number): Rect {
  const k = cam.zoom * base;
  return { x: cam.x, y: cam.y, w: w / k, h: h / k };
}

/** Zooms to `zoom`, keeping the canvas point under the screen point (sx, sy) in place. */
export function zoomAt(cam: Camera, base: number, zoom: number, sx: number, sy: number): Camera {
  const z = clampZoom(zoom);
  const p = toCanvas(cam, base, sx, sy);
  const k = z * base;
  return { x: p.x - sx / k, y: p.y - sy / k, zoom: z };
}

/** Pans by a screen-space delta (positive dx moves the content right). */
export function panBy(cam: Camera, base: number, dx: number, dy: number): Camera {
  const k = cam.zoom * base;
  return { ...cam, x: cam.x - dx / k, y: cam.y - dy / k };
}

/**
 * Two-finger pinch: the canvas point that was under the starting midpoint `m0` (at `start`)
 * follows the current midpoint `m1`, at `start.zoom · d1 / d0`.
 */
export function pinch(start: Camera, base: number, m0: Pt, d0: number, m1: Pt, d1: number): Camera {
  const anchor = toCanvas(start, base, m0.x, m0.y);
  const z = clampZoom(start.zoom * (d1 / Math.max(1, d0)));
  const k = z * base;
  return { x: anchor.x - m1.x / k, y: anchor.y - m1.y / k, zoom: z };
}

/** A camera showing `r` centred in a view of `w` × `h` px with `pad` px of margin. */
export function fitRect(r: Rect, w: number, h: number, base: number, pad = 32, maxZoom = 2): Camera {
  const zw = (w - 2 * pad) / Math.max(1, r.w) / base;
  const zh = (h - 2 * pad) / Math.max(1, r.h) / base;
  const zoom = clampZoom(Math.min(zw, zh, maxZoom));
  const k = zoom * base;
  return { x: r.x + r.w / 2 - w / 2 / k, y: r.y + r.h / 2 - h / 2 / k, zoom };
}

/** A camera at `zoom` centring the canvas point `p` in a view of `w` × `h` px. */
export function centerOn(p: Pt, w: number, h: number, base: number, zoom: number): Camera {
  const k = clampZoom(zoom) * base;
  return { x: p.x - w / 2 / k, y: p.y - h / 2 / k, zoom: clampZoom(zoom) };
}
