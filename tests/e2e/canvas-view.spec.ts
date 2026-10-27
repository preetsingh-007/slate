import { expect, test } from '@playwright/test';
import { camera, dragClient, frames, line, objects, openCanvas, seed, strokePts, surface, toClient, touch, withCanvas } from './canvas-helpers';

test.describe('space, navigation and time (C1, C2, C5, C20, C21)', () => {
  test('wheel pans; ctrl+wheel and trackpad pinch zoom under the cursor, 10% to 800%', async ({ page }) => {
    await openCanvas(page);
    const b = await surface(page);
    const c0 = await camera(page);
    await page.mouse.move(b.x + 400, b.y + 300);
    await page.mouse.wheel(0, 200);
    await frames(page);
    const c1 = await camera(page);
    expect(c1.y).toBeGreaterThan(c0.y);
    expect(c1.zoom).toBe(c0.zoom);
    // zoom anchored: the canvas point under the cursor stays put
    const before = await withCanvas<{ x: number; y: number }>(page, `(h) => h.engine.clientToCanvas(${b.x + 400}, ${b.y + 300})`);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await frames(page);
    const c2 = await camera(page);
    expect(c2.zoom).toBeGreaterThan(c1.zoom);
    const after = await withCanvas<{ x: number; y: number }>(page, `(h) => h.engine.clientToCanvas(${b.x + 400}, ${b.y + 300})`);
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -400);
      await page.keyboard.up('Control');
    }
    await frames(page);
    expect((await camera(page)).zoom).toBe(8);
    for (let i = 0; i < 30; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, 400);
      await page.keyboard.up('Control');
    }
    await frames(page);
    expect((await camera(page)).zoom).toBeCloseTo(0.1);
    // 1,000 units span the default writing width at 100% (C1)
    await page.keyboard.press('Control+0');
    await frames(page);
    expect((await camera(page)).zoom).toBe(1);
    const k = await withCanvas<number>(page, '(h) => h.engine.pxPerUnit');
    expect(1000 * k).toBeCloseTo(Math.min(1200, Math.max(320, 1280 - 48)), 0);
  });

  test('hand tool, fit all, fit selection, 100% and jump to now', async ({ page }) => {
    await openCanvas(page);
    await seed(page, [
      { kind: 'stroke', pts: strokePts(-3000, -2000, -2900, -1900) },
      { kind: 'stroke', pts: strokePts(3000, 2000, 3100, 2100) },
    ]);
    await page.getByRole('radio', { name: /^Hand/ }).click();
    const b = await surface(page);
    const c0 = await camera(page);
    await dragClient(page, [b.x + 500, b.y + 300], [b.x + 300, b.y + 200]);
    const c1 = await camera(page);
    expect(c1.x).toBeGreaterThan(c0.x);
    await page.getByRole('button', { name: /view options/ }).click();
    await page.getByRole('menuitem', { name: /Fit all/ }).click();
    await page.waitForTimeout(400);
    const v = await withCanvas<{ x: number; y: number; w: number; h: number }>(page, '(h) => h.engine.view');
    expect(v.x).toBeLessThan(-3000);
    expect(v.x + v.w).toBeGreaterThan(3100);
    expect(v.y + v.h).toBeGreaterThan(2100);
    // jump to now: just below the latest content
    await page.keyboard.press('Home');
    await page.waitForTimeout(400);
    const now = await withCanvas<{ x: number; y: number; w: number; h: number }>(page, '(h) => h.engine.view');
    expect(now.y).toBeLessThan(2100);
    expect(now.y + now.h).toBeGreaterThan(2100 + 64);
  });

  test('opening a canvas shows just below the latest content, with today’s line as a preview (C20)', async ({ page }) => {
    await openCanvas(page);
    // yesterday's work (still this month, unless today is the 1st)
    const d = new Date();
    const created = d.getDate() > 1 ? d.getTime() - 86_400_000 : d.getTime();
    await seed(page, [{ kind: 'stroke', pts: strokePts(0, 5000, 400, 5100), created }]);
    // reopen
    await page.waitForTimeout(1700); // the canvas index records segment bounds (debounced)
    await page.reload();
    await page.locator('.cv-view[data-ready="true"]').waitFor();
    const v = await withCanvas<{ x: number; y: number; w: number; h: number }>(page, '(h) => h.engine.view');
    expect(v.y).toBeLessThan(5100);
    expect(v.y + v.h).toBeGreaterThan(5100 + 64);
    if (d.getDate() > 1) await expect(page.getByTestId('dayline-preview').locator('.cv-date')).toBeVisible();
  });

  test('C20: on an iPhone-width screen today’s date label clears the latest content', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCanvas(page);
    const d = new Date();
    test.skip(d.getDate() === 1, 'yesterday is in another month');
    await seed(page, [{ kind: 'stroke', pts: strokePts(0, 0, 900, 300), created: d.getTime() - 86_400_000 }]);
    await page.keyboard.press('Home');
    const label = page.getByTestId('dayline-preview').locator('.cv-dayline-label');
    await expect(label).toBeVisible();
    await page.waitForTimeout(400);
    // the stroke's bottom edge, on screen
    const [, bottom] = await toClient(page, 0, 300);
    const box = await label.boundingBox();
    expect(box!.y).toBeGreaterThan(bottom);
  });

  test('the minimap shows the view and jumps where tapped; the date picker jumps to a day (C5, C21)', async ({ page }) => {
    await openCanvas(page);
    // a day line from last month, in its own segment
    await page.evaluate(async () => {
      const h = (window as unknown as { __slateCanvas: { main: { ctl: { model: { load(m: string[]): Promise<void>; transact(f: (tx: { setDay(d: string, y: number): void }) => void): void } } } } }).__slateCanvas.main;
      await h.ctl.model.load(['2026-09']);
      h.ctl.model.transact((tx) => tx.setDay('2026-09-10', -4000));
    });
    await seed(page, [{ kind: 'stroke', pts: strokePts(0, -3900, 300, -3800), created: new Date(2026, 8, 10).getTime() }]);
    await seed(page, [{ kind: 'stroke', pts: strokePts(0, 100, 300, 200) }]);
    const mm = page.getByRole('img', { name: /Overview of the canvas/ });
    await expect(mm).toBeVisible();
    // the minimap redraws up to 1.4 s after a change (debounce, then idle time); September's
    // marker shows once the overview reaches up to it
    await expect(page.getByRole('button', { name: /Jump to .* Sep 2026/ })).toBeVisible();
    const box = await mm.boundingBox();
    await page.mouse.click(box!.x + 10, box!.y + 4);
    await frames(page);
    const v = await withCanvas<{ y: number; h: number }>(page, '(h) => h.engine.view');
    expect(v.y + v.h / 2).toBeLessThan(-1000);
    // day marker on the minimap
    await page.getByRole('button', { name: /Jump to .* Sep 2026/ }).click();
    await page.waitForTimeout(400);
    const v1 = await withCanvas<{ y: number; h: number }>(page, '(h) => h.engine.view');
    expect(v1.y).toBeLessThan(-4000);
    expect(v1.y + v1.h).toBeGreaterThan(-4000);
    // the date picker: a date without a line goes to the closest earlier day
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Go to a date' }).click();
    await page.getByLabel('Date', { exact: true }).fill('2026-09-20');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await page.waitForTimeout(400);
    const v2 = await withCanvas<{ y: number; h: number }>(page, '(h) => h.engine.view');
    expect(v2.y).toBeLessThan(-4000);
    expect(v2.y + v2.h).toBeGreaterThan(-4000);
    // the minimap can be turned off
    await page.getByRole('button', { name: /view options/ }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Minimap' }).click();
    await expect(mm).toHaveCount(0);
  });

  test('two fingers pan and pinch-zoom (C2) @touch', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'needs touch');
    await openCanvas(page);
    const c0 = await camera(page);
    await touch(page, [line([300, 300], [200, 300], 10), line([500, 300], [700, 300], 10)]);
    const c1 = await camera(page);
    expect(c1.zoom).toBeGreaterThan(c0.zoom * 1.5);
    await touch(page, [line([300, 400], [300, 200], 10), line([400, 400], [400, 200], 10)]);
    const c2 = await camera(page);
    expect(c2.y).toBeGreaterThan(c1.y);
    expect(c2.zoom).toBeCloseTo(c1.zoom, 2);
    expect(await objects(page)).toHaveLength(0);
  });

  test('fingers selecting and moving with the lasso @touch', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'needs touch');
    await openCanvas(page);
    const [id] = await seed(page, [{ kind: 'text', x: 0, y: 100, w: 200, content: 'move me' }]);
    await page.getByRole('radio', { name: /^Lasso/ }).tap();
    const p = await toClient(page, 50, 110);
    const b = await surface(page);
    await touch(page, [[[p[0] - b.x, p[1] - b.y]]]);
    expect(await withCanvas<string[]>(page, '(h) => h.engine.getSelection()')).toEqual([id]);
    await touch(page, [line([p[0] - b.x, p[1] - b.y], [p[0] - b.x + 100, p[1] - b.y + 50], 10)]);
    const [o] = await objects(page);
    expect(o.x).toBeGreaterThan(40);
  });
});
