import { expect, test } from '@playwright/test';
import { drawMouse, objects, openCanvas, seed, strokePts, wave, withCanvas } from './canvas-helpers';

test.describe('canvas switcher, a second canvas in the side pane, the canvas API (P1, S3, S6)', () => {
  test('create and rename canvases, open one in the side pane and draw there', async ({ page }) => {
    await openCanvas(page);
    await page.getByRole('button', { name: /Switch canvas/ }).click();
    await page.getByRole('menuitem', { name: /New canvas/ }).click();
    await page.getByLabel('Title of the new canvas').fill('Quantum mechanics');
    await expect(page.getByText('journal/quantum-mechanics')).toBeVisible();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.locator('.cv-view[data-canvas="quantum-mechanics"][data-ready="true"]').waitFor();
    await page.getByRole('button', { name: /Switch canvas/ }).click();
    await page.getByRole('menuitem', { name: /Rename/ }).click();
    await page.getByLabel('New title').fill('QM');
    await page.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('button', { name: /Canvas: QM/ })).toBeVisible();
    // back to main, with QM in the side pane
    await page.getByRole('button', { name: /Switch canvas/ }).click();
    await page.getByRole('menuitemradio', { name: 'Main' }).click();
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    await page.getByRole('button', { name: /Switch canvas/ }).click();
    await page.getByRole('button', { name: 'Open QM in the side pane' }).click();
    const side = page.locator('.pane-side .cv-view[data-canvas="quantum-mechanics"][data-ready="true"]');
    await side.waitFor();
    await expect(page.getByRole('tab', { name: /QM/ })).toBeVisible();
    await drawMouse(page, wave(60, 200, 120), 'quantum-mechanics');
    expect(await objects(page, 'quantum-mechanics')).toHaveLength(1);
    expect(await objects(page, 'main')).toHaveLength(0);
    await drawMouse(page, wave(60, 200, 120), 'main');
    expect(await objects(page, 'main')).toHaveLength(1);
  });

  test('the canvas API reveals objects and regions with a flash', async ({ page }) => {
    await openCanvas(page);
    const [id] = await seed(page, [{ kind: 'stroke', pts: strokePts(5000, 5000, 5200, 5100) }]);
    await withCanvas(page, `(h) => h.api.revealObject('${id}')`);
    await expect(page.getByTestId('flash')).toBeVisible();
    await page.waitForTimeout(400);
    const v = await withCanvas<{ x: number; y: number; w: number; h: number }>(page, '(h) => h.engine.view');
    expect(v.x < 5000 && v.x + v.w > 5200 && v.y < 5000 && v.y + v.h > 5100).toBe(true);
    expect(await withCanvas(page, '(h) => h.engine.getSelection()')).toEqual([id]);
    await expect(page.getByTestId('flash')).toHaveCount(0, { timeout: 4000 });
    await withCanvas(page, '(h) => h.api.revealRegion({ x: -3000, y: -3000, w: 100, h: 100 })');
    await page.waitForTimeout(400);
    const v2 = await withCanvas<{ x: number; y: number; w: number; h: number }>(page, '(h) => h.engine.view');
    expect(v2.x < -3000 && v2.x + v2.w > -2900).toBe(true);
    const p = await withCanvas<{ x: number; y: number } | null>(page, '(h) => { const r = document.querySelector(".cv-root").getBoundingClientRect(); return h.api.clientToCanvas(r.left + 10, r.top + 10); }');
    expect(p!.x).toBeCloseTo(v2.x + 10 / (await withCanvas<number>(page, '(h) => h.engine.pxPerUnit')), 0);
    expect(await withCanvas(page, '(h) => h.api.clientToCanvas(-50, -50)')).toBeNull();
  });
});
