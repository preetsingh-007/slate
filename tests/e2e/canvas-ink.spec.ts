import { expect, test } from '@playwright/test';
import { drawMouse, drawPen, frames, line, objects, openCanvas, surface, touch, wave, withCanvas, camera } from './canvas-helpers';

test.describe('ink (C6, C12, C13, C17, C18, C19)', () => {
  test('draws with the mouse: simulated pressure, a day line, undo and redo', async ({ page }) => {
    await openCanvas(page);
    await expect(page.getByTestId('dayline-preview').locator('.cv-date')).toBeVisible(); // C20: today's line previews where work starts
    await drawMouse(page, wave(200, 300));
    let objs = await objects(page);
    expect(objs).toHaveLength(1);
    const s = objs[0];
    expect(s.kind).toBe('stroke');
    expect(s.tool).toBe('pen');
    const pressures = s.pts!.filter((_, i) => i % 3 === 2);
    expect(new Set(pressures).size).toBeGreaterThan(1); // C6: simulated for the mouse
    expect(s.created).toBeGreaterThan(0);
    expect(s.edited).toBe(s.created); // C18
    // C19: the first object of the day below all content creates the day's line 24 units above it
    const lines = await withCanvas<[string, number][]>(page, '(h) => [...h.ctl.model.dayLines()]');
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toBeCloseTo(s.y - s.size! / 2 - 24, 0);
    await expect(page.getByTestId('dayline-preview')).toHaveCount(0);
    await expect(page.getByTestId('dayline').locator('.cv-date')).toHaveText(/\w{3} \d{1,2} \w{3} \d{4}/);

    // a second stroke above the line creates no new line
    await drawMouse(page, wave(500, 280));
    expect(await withCanvas<number>(page, '(h) => h.ctl.model.dayLines().size')).toBe(1);

    await page.keyboard.press('Control+z');
    expect(await objects(page)).toHaveLength(1);
    await page.getByRole('button', { name: /^Undo/ }).click();
    expect(await objects(page)).toHaveLength(0);
    expect(await withCanvas<number>(page, '(h) => h.ctl.model.dayLines().size')).toBe(0);
    await page.keyboard.press('Control+Shift+z');
    objs = await objects(page);
    expect(objs).toHaveLength(1);
    await page.getByRole('button', { name: /^Redo/ }).click();
    expect(await objects(page)).toHaveLength(2);
  });

  test('pen colour, size, highlighter and a custom colour synced in settings', async ({ page }) => {
    await openCanvas(page);
    await page.getByRole('button', { name: 'Red', exact: true }).click();
    await page.getByRole('button', { name: 'Size large' }).click();
    await drawMouse(page, wave(100, 200));
    await page.getByRole('radio', { name: /^Highlighter/ }).click();
    await page.getByRole('button', { name: 'Pink', exact: true }).click();
    await drawMouse(page, line([100, 320], [400, 320]));
    await page.getByRole('radio', { name: /^Pen/ }).click();
    await page.getByLabel('Add a custom colour').fill('#123456');
    await drawMouse(page, wave(100, 420));
    const objs = await objects(page);
    expect(objs.map((o) => [o.tool, o.color])).toEqual([
      ['pen', '#c93a32'],
      ['highlighter', '#ff7eb6'],
      ['pen', '#123456'],
    ]);
    expect(objs[0].size).toBe(4.5);
    expect(await page.evaluate(() => (window as unknown as { __slate: { settings: { get(): { colors: string[] } } } }).__slate.settings.get().colors)).toContain('#123456');
    await expect(page.getByRole('button', { name: 'Custom #123456' })).toBeVisible();
  });

  test('eraser: whole strokes, and partial erasing splits a stroke (C12)', async ({ page }) => {
    await openCanvas(page);
    await drawMouse(page, line([100, 200], [500, 200], 30));
    await drawMouse(page, line([100, 300], [500, 300], 30));
    const lower = Math.max(...(await objects(page)).map((o) => o.y));
    await page.getByRole('radio', { name: /^Eraser/ }).click();
    // whole-stroke mode removes the first line
    await drawMouse(page, line([300, 170], [300, 230], 6));
    let objs = await objects(page);
    expect(objs).toHaveLength(1);
    expect(objs[0].y).toBe(lower);
    // partial mode cuts the second line in two
    await page.getByRole('radio', { name: 'Partial' }).click();
    await drawMouse(page, line([300, 270], [300, 330], 6));
    objs = await objects(page);
    expect(objs).toHaveLength(2);
    const [a, b] = objs.sort((p, q) => p.x - q.x);
    expect(a.x + a.w).toBeLessThan(b.x);
    // one undo step restores the original stroke
    await page.keyboard.press('Control+z');
    expect(await objects(page)).toHaveLength(1);
  });

  test('pressure from a pen; the stylus button erases as configured (C6, C11) @touch', async ({ page }) => {
    await openCanvas(page);
    await drawPen(page, wave(150, 250));
    const objs = await objects(page);
    expect(objs).toHaveLength(1);
    expect(objs[0].pts!.filter((_, i) => i % 3 === 2).some((p) => p > 0.55)).toBe(true);
    await drawPen(page, line([230, 200], [230, 300], 8), 'main', { eraserButton: true });
    expect(await objects(page)).toHaveLength(0);
  });

  test('palm rejection: once a Pencil is seen fingers pan and do not draw (C13) @touch', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'needs touch');
    await openCanvas(page);
    // before a pen is seen, a finger draws
    await touch(page, [wave(100, 200)]);
    expect(await objects(page)).toHaveLength(1);
    await drawPen(page, wave(100, 320));
    expect(await objects(page)).toHaveLength(2);
    const before = await camera(page);
    await touch(page, [line([400, 400], [400, 250], 8)]);
    expect(await objects(page)).toHaveLength(2);
    const after = await camera(page);
    expect(after.y).toBeGreaterThan(before.y); // the finger panned
    // the setting allows finger drawing again
    await page.getByRole('button', { name: 'Canvas settings' }).click();
    await page.getByLabel(/Draw with a finger/).check();
    await page.getByRole('button', { name: 'Canvas settings' }).click();
    await touch(page, [wave(100, 450)]);
    expect(await objects(page)).toHaveLength(3);
  });

  test('a stroke is in memory before storage writes it (no waiting on storage)', async ({ page }) => {
    await openCanvas(page);
    const b = await surface(page);
    await page.mouse.move(b.x + 100, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + 200, b.y + 220, { steps: 4 });
    await page.mouse.up();
    // synchronously after pointerup the object is in the model
    expect(await withCanvas<number>(page, '(h) => h.ctl.model.count')).toBe(1);
    await frames(page);
  });
});
