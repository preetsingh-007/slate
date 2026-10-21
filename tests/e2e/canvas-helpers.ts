/**
 * Helpers for the canvas end-to-end tests: opening a canvas, drawing with the mouse, a pen
 * (real pen pointer events through the DevTools protocol) or fingers (real touch events), and
 * reading the canvas model through the test hook (`window.__slateCanvas`, test builds only).
 */
import type { CDPSession, Page } from '@playwright/test';

export type Pt = [number, number];

export async function openCanvas(page: Page, slug = 'main') {
  await page.goto('/');
  await page.locator(`.cv-view[data-canvas="${slug}"][data-ready="true"]`).first().waitFor();
}

/** Client rectangle of a canvas surface. */
export async function surface(page: Page, slug = 'main') {
  const box = await page.locator(`.cv-view[data-canvas="${slug}"] .cv-root`).first().boundingBox();
  if (!box) throw new Error('canvas not visible');
  return box;
}

/** Mouse stroke through points relative to the canvas surface. */
export async function drawMouse(page: Page, pts: Pt[], slug = 'main') {
  const b = await surface(page, slug);
  await page.mouse.move(b.x + pts[0][0], b.y + pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + x, b.y + y, { steps: 2 });
  await page.mouse.up();
}

/** A straight line of `n` points from a to b. */
export function line(a: Pt, b: Pt, n = 12): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return out;
}

export function wave(x: number, y: number, w = 160, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push([x + (w * i) / n, y + Math.sin((i / n) * Math.PI * 2) * 20]);
  return out;
}

async function cdp(page: Page): Promise<CDPSession> {
  const p = page as Page & { __cdp?: CDPSession };
  if (!p.__cdp) p.__cdp = await page.context().newCDPSession(page);
  return p.__cdp;
}

/** A Pencil stroke: real pen pointer events with pressure (CDP Input.dispatchMouseEvent). */
export async function drawPen(page: Page, pts: Pt[], slug = 'main', opts: { eraserButton?: boolean } = {}) {
  const b = await surface(page, slug);
  const s = await cdp(page);
  const ev = (type: string, [x, y]: Pt, force = 0.5) =>
    s.send('Input.dispatchMouseEvent', {
      type,
      x: b.x + x,
      y: b.y + y,
      button: opts.eraserButton ? 'right' : 'left',
      buttons: type === 'mouseReleased' ? 0 : opts.eraserButton ? 2 : 1,
      clickCount: 1,
      pointerType: 'pen',
      force,
    } as never);
  await ev('mouseMoved', pts[0], 0);
  await ev('mousePressed', pts[0]);
  for (const p of pts.slice(1)) await ev('mouseMoved', p, 0.6);
  await ev('mouseReleased', pts[pts.length - 1], 0);
}

/**
 * Real touch input: each track is one finger's points (relative to the canvas), all moving in
 * step. `holdMs` keeps the fingers still after they land (two-finger hold, C4).
 */
export async function touch(page: Page, tracks: Pt[][], slug = 'main', opts: { holdMs?: number; stepMs?: number } = {}) {
  const b = await surface(page, slug);
  const s = await cdp(page);
  const pts = (i: number) => tracks.map((t, id) => ({ x: b.x + t[Math.min(i, t.length - 1)][0], y: b.y + t[Math.min(i, t.length - 1)][1], id, radiusX: 4, radiusY: 4, force: 0.5 }));
  const steps = Math.max(...tracks.map((t) => t.length));
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
  if (opts.holdMs) await page.waitForTimeout(opts.holdMs);
  for (let i = 1; i < steps; i++) {
    await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(i) });
    if (opts.stepMs) await page.waitForTimeout(opts.stepMs);
  }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export interface ObjSummary {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: string;
  color?: string;
  size?: number;
  tool?: string;
  group?: string;
  topics: string[];
  content?: string;
  attached?: string;
  beautifiedInto?: string;
  shape?: string;
  display?: string;
  pts?: number[];
  crop?: unknown;
  created: number;
  edited: number;
}

/** Every object of a canvas (plain values). */
export async function objects(page: Page, slug = 'main'): Promise<ObjSummary[]> {
  return page.evaluate((slug) => {
    const h = (window as unknown as { __slateCanvas: Record<string, { ctl: { model: { objects(): Iterable<Record<string, unknown>> } } }> }).__slateCanvas[slug];
    return [...h.ctl.model.objects()].map((o) => JSON.parse(JSON.stringify(o)));
  }, slug);
}

/** Runs a function against a canvas's test hook in the page. */
export async function withCanvas<T>(page: Page, fn: string, slug = 'main'): Promise<T> {
  return page.evaluate(
    ([slug, fn]) => {
      const h = (window as unknown as { __slateCanvas: Record<string, unknown> }).__slateCanvas[slug];
      return new Function('h', `return (${fn})(h)`)(h);
    },
    [slug, fn] as const,
  );
}

/** Client position of a canvas point. */
export async function toClient(page: Page, x: number, y: number, slug = 'main'): Promise<Pt> {
  const b = await surface(page, slug);
  const [sx, sy] = await withCanvas<[number, number]>(page, `(h) => { const c = h.engine.camera; const k = c.zoom * h.engine.base; return [(${x} - c.x) * k, (${y} - c.y) * k]; }`, slug);
  return [b.x + sx, b.y + sy];
}

export async function camera(page: Page, slug = 'main'): Promise<{ x: number; y: number; zoom: number }> {
  return withCanvas(page, '(h) => ({ ...h.engine.camera })', slug);
}

/** Waits until the engine has drawn a frame (after camera or model changes). */
export async function frames(page: Page, n = 2) {
  await page.evaluate((n) => new Promise<void>((r) => {
    let i = 0;
    const f = () => (++i >= n ? r() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n);
}

export async function selection(page: Page, slug = 'main'): Promise<string[]> {
  return withCanvas(page, '(h) => [...h.engine.getSelection()]', slug);
}

export type Spec = Record<string, unknown> & { kind: string };

/**
 * Adds objects (canvas units) through the controller, filling in the header: ids, z order,
 * times, device; strokes get their frame from their points. Returns the ids.
 */
export async function seed(page: Page, specs: Spec[], slug = 'main'): Promise<string[]> {
  return page.evaluate(
    ([slug, specs]) => {
      const h = (window as unknown as { __slateCanvas: Record<string, { ctl: { addObjects(o: unknown[]): void; device: string; model: { topZ(): string } } }> }).__slateCanvas[slug];
      const now = Date.now();
      let z = h.ctl.model.topZ();
      const next = (k: string) => k + 'i';
      const out = specs.map((s, i) => {
        const o: Record<string, unknown> = { id: `t${now.toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`, rotation: 0, created: now, edited: now, device: h.ctl.device, topics: [], ...s, z };
        z = next(z);
        if (s.kind === 'stroke') {
          const p = s.pts as number[];
          const xs = p.filter((_, j) => j % 3 === 0);
          const ys = p.filter((_, j) => j % 3 === 1);
          Object.assign(o, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), tool: s.tool ?? 'pen', color: s.color ?? '#1f2328', size: s.size ?? 2.5 });
        }
        if (s.kind === 'text') Object.assign(o, { fontSize: 18, h: 30, ...s });
        return o;
      });
      h.ctl.addObjects(out);
      return out.map((o) => o.id as string);
    },
    [slug, specs] as const,
  );
}

/** Flat stroke points along a line in canvas units. */
export function strokePts(x0: number, y0: number, x1: number, y1: number, n = 20): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(Math.round((x0 + ((x1 - x0) * i) / n) * 10) / 10, Math.round((y0 + ((y1 - y0) * i) / n) * 10) / 10, 0.5);
  return out;
}

/** Drags with the mouse between two client points. */
export async function dragClient(page: Page, from: Pt, to: Pt, steps = 10) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  await page.mouse.up();
}

/** Lasso (mouse) around a canvas rectangle. */
export async function lassoRect(page: Page, x: number, y: number, w: number, h: number, slug = 'main') {
  const a = await toClient(page, x, y, slug);
  const b = await toClient(page, x + w, y + h, slug);
  const pts: Pt[] = [a, [b[0], a[1]], b, [a[0], b[1]], [a[0], a[1] + 2]];
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 6 });
  await page.mouse.up();
}
