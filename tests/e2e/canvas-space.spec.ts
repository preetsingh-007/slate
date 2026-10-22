import { expect, test, type Page } from '@playwright/test';
import { dragClient, objects, openCanvas, seed, strokePts, toClient, touch, withCanvas } from './canvas-helpers';

type View = { x: number; y: number; w: number; h: number };

async function scene(page: Page) {
  const v = await withCanvas<View>(page, '(h) => h.engine.view');
  const bottom = v.y + v.h;
  const [a, cross, b, c, d] = await seed(page, [
    { kind: 'stroke', pts: strokePts(0, 0, 200, 40) }, // above the split
    { kind: 'image', x: 600, y: 150, w: 200, h: 200, asset: 'none', mime: 'image/png', natural: { w: 200, h: 200 } }, // crosses y = 250
    { kind: 'stroke', pts: strokePts(0, 300, 200, 320) }, // below
    { kind: 'stroke', pts: strokePts(0, bottom - 40, 200, bottom - 20) }, // below, near the bottom of the view
    { kind: 'stroke', pts: strokePts(0, bottom + 30, 200, bottom + 60) }, // outside the view, in c's way
  ]);
  return { a, cross, b, c, d, v };
}

const byId = async (page: Page) => Object.fromEntries((await objects(page)).map((o) => [o.id, o]));

test.describe('local space insertion (C4)', () => {
  test('the space tool inserts space below the split; outside objects are pushed only when in the way; one undo step', async ({ page }) => {
    await openCanvas(page);
    const s = await scene(page);
    const before = await byId(page);
    await page.getByRole('radio', { name: /^Insert space/ }).click();
    const from = await toClient(page, 300, 250);
    const k = await withCanvas<number>(page, '(h) => h.engine.pxPerUnit');
    await dragClient(page, from, [from[0], from[1] + 100 * k], 12);
    const after = await byId(page);
    const dy = (id: string) => after[id].y - before[id].y;
    expect(dy(s.a)).toBe(0);
    expect(dy(s.cross)).toBe(0);
    expect(dy(s.b)).toBeCloseTo(100, 0);
    expect(dy(s.c)).toBeCloseTo(100, 0);
    expect(dy(s.d)).toBeCloseTo(100, 0); // pushed: c would have run into it
    await page.keyboard.press('Control+z');
    const undone = await byId(page);
    for (const id of [s.b, s.c, s.d]) expect(undone[id].y).toBe(before[id].y);
  });

  test('removing space stops 8 units from another object and never overlaps', async ({ page }) => {
    await openCanvas(page);
    const s = await scene(page);
    await page.getByRole('radio', { name: /^Insert space/ }).click();
    const from = await toClient(page, 300, 250);
    const k = await withCanvas<number>(page, '(h) => h.engine.pxPerUnit');
    await dragClient(page, from, [from[0], from[1] - 300 * k], 12);
    const o = await byId(page);
    // b's drawn top (frame minus half the pen width) is 8 units below a's drawn bottom
    const aBottom = o[s.a].y + o[s.a].h + o[s.a].size! / 2;
    const bTop = o[s.b].y - o[s.b].size! / 2;
    expect(bTop - aBottom).toBeCloseTo(8, 0);
    expect(o[s.cross].y).toBe(150);
  });

  test('two fingers held still, then spread, insert space (C4) @touch', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'needs touch');
    await openCanvas(page);
    const s = await scene(page);
    const before = await byId(page);
    const p1 = await toClient(page, 400, 200);
    const p2 = await toClient(page, 400, 290);
    const box = await page.locator('.cv-root').boundingBox();
    const rel = (p: [number, number], dy: number): [number, number] => [p[0] - box!.x, p[1] - box!.y + dy];
    const steps = 10;
    const t1: [number, number][] = [];
    const t2: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      t1.push(rel(p1, (-40 * i) / steps));
      t2.push(rel(p2, (60 * i) / steps));
    }
    await touch(page, [t1, t2], 'main', { holdMs: 700, stepMs: 16 });
    const after = await byId(page);
    const k = await withCanvas<number>(page, '(h) => h.engine.pxPerUnit');
    expect(after[s.a].y - before[s.a].y).toBeCloseTo(-40 / k, 0);
    expect(after[s.b].y - before[s.b].y).toBeCloseTo(60 / k, 0);
    expect(after[s.cross].y).toBe(before[s.cross].y);
    // the camera did not zoom
    expect(await withCanvas<number>(page, '(h) => h.engine.camera.zoom')).toBe(1);
  });
});
