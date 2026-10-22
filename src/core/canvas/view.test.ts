import { describe, expect, it } from 'vitest';
import { baseScale, clampZoom, fitRect, MAX_ZOOM, MIN_ZOOM, pinch, toCanvas, toScreen, viewRect, zoomAt } from './camera';
import { decimate, levelFor, levelScale, strokeLod, TileCache, tileRect, tilesFor, tileUnits } from './tiles';
import { SpatialIndex } from './spatial';

describe('camera (C1, C2)', () => {
  it('1,000 units span the default writing width at 100%', () => {
    const base = baseScale(1180);
    expect(1000 * base).toBeCloseTo(1132);
    expect(baseScale(5000) * 1000).toBe(1200);
    expect(baseScale(200) * 1000).toBe(320);
  });

  it('round-trips between screen and canvas', () => {
    const cam = { x: -120, y: 4000, zoom: 1.7 };
    const p = toCanvas(cam, 1.1, 300, 200);
    const s = toScreen(cam, 1.1, p);
    expect(s.x).toBeCloseTo(300);
    expect(s.y).toBeCloseTo(200);
  });

  it('zooms from 10% to 800%, anchored under the cursor', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(20)).toBe(MAX_ZOOM);
    const cam = { x: 50, y: 50, zoom: 1 };
    const before = toCanvas(cam, 1, 400, 300);
    const z = zoomAt(cam, 1, 3, 400, 300);
    const after = toCanvas(z, 1, 400, 300);
    expect(z.zoom).toBe(3);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('pinch keeps the canvas point under the fingers', () => {
    const start = { x: 0, y: 0, zoom: 1 };
    const anchor = toCanvas(start, 1, 200, 200);
    const cam = pinch(start, 1, { x: 200, y: 200 }, 100, { x: 260, y: 230 }, 250);
    expect(cam.zoom).toBeCloseTo(2.5);
    const p = toCanvas(cam, 1, 260, 230);
    expect(p.x).toBeCloseTo(anchor.x);
    expect(p.y).toBeCloseTo(anchor.y);
  });

  it('fits a rectangle in the view', () => {
    const cam = fitRect({ x: 0, y: 0, w: 2000, h: 1000 }, 1000, 800, 1, 0);
    expect(cam.zoom).toBeCloseTo(0.5);
    const v = viewRect(cam, 1, 1000, 800);
    expect(v.x).toBeCloseTo(0);
    expect(v.y + v.h / 2).toBeCloseTo(500);
  });
});

describe('tiles and visibility (C3)', () => {
  it('chooses the sharpest level not below the zoom, √2 apart', () => {
    for (const z of [0.1, 0.33, 0.5, 0.9, 1, 1.2, 2, 3.7, 8]) {
      const s = levelScale(levelFor(z));
      expect(s).toBeGreaterThanOrEqual(z - 1e-9);
      expect(s).toBeLessThan(z * Math.SQRT2 + 1e-9);
    }
  });

  it('lists only the tiles under the view, centre first', () => {
    const base = 1;
    const level = levelFor(1);
    const u = tileUnits(level, base);
    const view = { x: 10, y: 10, w: u * 2.5, h: u * 1.2 };
    const tiles = tilesFor(view, level, base);
    expect(tiles).toHaveLength(3 * 2);
    for (const t of tiles) {
      const r = tileRect(t, base);
      expect(r.x < view.x + view.w && view.x < r.x + r.w).toBe(true);
    }
    const centre = tileRect(tiles[0], base);
    expect(centre.x <= view.x + view.w / 2 && view.x + view.w / 2 <= centre.x + centre.w).toBe(true);
    expect(tilesFor(view, level, base, 1)).toHaveLength(5 * 4);
  });

  it('invalidates only tiles touched by changed bounds', () => {
    const disposed: string[] = [];
    const cache = new TileCache<string>(100, 1, (v) => disposed.push(v));
    const level = 0;
    const u = tileUnits(level, 1);
    for (let tx = 0; tx < 4; tx++) cache.set({ level, tx, ty: 0 }, `t${tx}`);
    expect(cache.invalidate([{ x: u * 1.2, y: 10, w: 5, h: 5 }])).toBe(1);
    expect(cache.peek({ level, tx: 1, ty: 0 })!.dirty).toBe(true);
    expect(cache.peek({ level, tx: 0, ty: 0 })!.dirty).toBe(false);
    // a stroke spanning two tiles touches both
    expect(cache.invalidate([{ x: u * 2.9, y: 0, w: u * 0.2, h: 5 }])).toBe(2);
    expect(cache.intersecting({ x: 0, y: 0, w: u * 4, h: 1 }).map((e) => e.value)).toEqual(['t0']);
  });

  it('evicts least recently used tiles beyond its capacity', () => {
    const disposed: string[] = [];
    const cache = new TileCache<string>(2, 1, (v) => disposed.push(v));
    cache.set({ level: 0, tx: 0, ty: 0 }, 'a');
    cache.set({ level: 0, tx: 1, ty: 0 }, 'b');
    cache.get({ level: 0, tx: 0, ty: 0 });
    cache.set({ level: 0, tx: 2, ty: 0 }, 'c');
    expect(disposed).toEqual(['b']);
    cache.setBase(2);
    expect(cache.size).toBe(0);
  });

  it('simplifies strokes when zoomed far out', () => {
    expect(strokeLod(100, 20, 1)).toBe('full');
    expect(strokeLod(100, 20, 0.2)).toBe('line');
    expect(strokeLod(10, 4, 0.1)).toBe('dot');
    const pts: number[] = [];
    for (let i = 0; i <= 100; i++) pts.push(i, 0, 0.5);
    const d = decimate(pts, 10);
    expect(d.length / 2).toBe(11);
    expect(d.slice(0, 2)).toEqual([0, 0]);
    expect(d.slice(-2)).toEqual([100, 0]);
  });

  it('queries cost scales with the visible area: 50,000 objects', () => {
    const idx = new SpatialIndex();
    for (let i = 0; i < 50_000; i++) idx.set(`s${i}`, { x: (i % 250) * 40, y: Math.floor(i / 250) * 40, w: 20, h: 20 });
    const t0 = performance.now();
    let n = 0;
    for (let k = 0; k < 100; k++) n += idx.query({ x: k * 10, y: k * 10, w: 1000, h: 700 }).size;
    expect(n / 100).toBeLessThan(26 * 19 + 1);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
