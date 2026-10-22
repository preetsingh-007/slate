/**
 * C3 performance budget: 50,000 strokes pan and zoom smoothly. The target is 60 fps on an M1
 * iPad; CI machines render canvases in software, so the budget here is looser but still
 * catches regressions that would make the canvas redraw everything (or block) per frame.
 */
import { expect, test } from '@playwright/test';
import { openCanvas } from './canvas-helpers';

const N = 50_000;

test.describe('performance (C3)', () => {
  test.setTimeout(180_000);
  // frame timing on shared CI machines is noisy: one retry absorbs a neighbour's burst
  test.describe.configure({ retries: 1 });

  test('50,000 strokes: panning and zooming stay within the frame budget', async ({ page }) => {
    await openCanvas(page);
    const seeded = await page.evaluate((n) => {
      const h = (window as unknown as { __slateCanvas: { main: { ctl: { addObjects(o: unknown[]): void; device: string; model: { count: number } } } } }).__slateCanvas.main;
      const t0 = performance.now();
      const now = Date.now();
      const objs: unknown[] = [];
      let seed = 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const cols = 250;
      for (let i = 0; i < n; i++) {
        const x0 = (i % cols) * 40;
        const y0 = Math.floor(i / cols) * 40;
        const pts: number[] = [];
        for (let k = 0; k < 10; k++) pts.push(Math.round((x0 + k * 3) * 10) / 10, Math.round((y0 + Math.sin(k + i) * 8 + rnd() * 4) * 10) / 10, 0.5);
        const xs = pts.filter((_, j) => j % 3 === 0);
        const ys = pts.filter((_, j) => j % 3 === 1);
        objs.push({
          id: `p${i.toString(36)}`,
          kind: 'stroke',
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
          rotation: 0,
          z: `a${i.toString(36).padStart(4, '0')}1`,
          created: now,
          edited: now,
          device: h.ctl.device,
          topics: [],
          pts,
          tool: 'pen',
          color: 'currentInk',
          size: 2.5,
        });
      }
      h.ctl.addObjects(objs);
      return { count: h.ctl.model.count, ms: performance.now() - t0 };
    }, N);
    expect(seeded.count).toBe(N);
    console.log(`seeded ${N} strokes in ${Math.round(seeded.ms)} ms`);
    // let the one-off work of adding 50,000 objects at once finish (persistence, the minimap)
    await page.evaluate(() => (window as unknown as { __slate: { docs: { flush(): Promise<unknown> } } }).__slate.docs.flush());
    await page.waitForTimeout(2500);

    const run = (mode: 'pan' | 'zoom', zoom: number, frames: number) =>
      page.evaluate(
        async ({ mode, zoom, frames }) => {
          const h = (window as unknown as { __slateCanvas: { main: { engine: { setCamera(c: unknown): void; recordFrames(on: boolean): number[]; camera: { zoom: number } } } } }).__slateCanvas.main;
          const root = document.querySelector('.cv-root')!;
          const r = root.getBoundingClientRect();
          h.engine.setCamera({ x: 2000, y: 2000, zoom });
          const raf = () => new Promise<number>((res) => requestAnimationFrame(res));
          // let the first view render, then measure
          for (let i = 0; i < 30; i++) await raf();
          h.engine.recordFrames(true);
          let longest = 0;
          let last = performance.now();
          for (let i = 0; i < frames; i++) {
            const ev = mode === 'pan'
              ? new WheelEvent('wheel', { deltaX: 6, deltaY: 9, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })
              : new WheelEvent('wheel', { deltaY: i < frames / 2 ? -4 : 4, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
            root.dispatchEvent(ev);
            const t = await raf();
            longest = Math.max(longest, t - last);
            last = t;
          }
          const times = h.engine.recordFrames(false).filter((t) => t > 0).sort((a, b) => a - b);
          const q = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
          return { n: times.length, median: q(0.5), p95: q(0.95), longest };
        },
        { mode, zoom, frames },
      );

    const results = {
      pan100: await run('pan', 1, 180),
      zoom100: await run('zoom', 1, 120),
      pan25: await run('pan', 0.25, 120),
      panFar: await run('pan', 0.1, 120),
    };
    // every stroke visible at 10%: the view fills in within a few seconds without blocking
    const settle = await page.evaluate(async () => {
      const h = (window as unknown as { __slateCanvas: { main: { engine: { setCamera(c: unknown): void; fitAll(): Promise<void>; tiles: { isFresh(c: unknown, w: number, h: number): boolean }; camera: unknown; width: number; height: number; recordFrames(on: boolean): number[] } } } }).__slateCanvas.main;
      h.engine.setCamera({ x: -100, y: -100, zoom: 0.1 });
      const t0 = performance.now();
      h.engine.recordFrames(true);
      while (!h.engine.tiles.isFresh(h.engine.camera, h.engine.width, h.engine.height) && performance.now() - t0 < 20000) await new Promise((r) => requestAnimationFrame(r));
      const frames = h.engine.recordFrames(false);
      return { ms: performance.now() - t0, longest: Math.max(0, ...frames) };
    });
    await page.screenshot({ path: test.info().outputPath('far.png') });
    console.log(JSON.stringify({ ...results, settle }, null, 1));
    expect(settle.ms).toBeLessThan(10_000);
    expect(settle.longest).toBeLessThan(500);
    // Budgets for CI hardware (software rendering, shared CPUs): most frames at 60 fps while
    // panning at 100%, no stalls anywhere. On an M1 iPad the same code runs at 60 fps throughout.
    expect(results.pan100.median).toBeLessThan(20);
    expect(results.pan100.p95).toBeLessThan(70);
    expect(results.zoom100.median).toBeLessThan(34);
    expect(results.zoom100.p95).toBeLessThan(120);
    expect(results.pan25.median).toBeLessThan(34);
    expect(results.pan25.p95).toBeLessThan(120);
    expect(results.panFar.median).toBeLessThan(34);
    expect(results.panFar.p95).toBeLessThan(150);
    for (const r of Object.values(results)) expect(r.longest).toBeLessThan(500);
  });
});
