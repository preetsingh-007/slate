import { expect, test, type Page } from '@playwright/test';
import { dragClient, drawMouse, lassoRect, objects, openCanvas, seed, selection, strokePts, toClient, withCanvas, type Pt } from './canvas-helpers';

async function scene(page: Page) {
  return seed(page, [
    { kind: 'stroke', pts: strokePts(0, 100, 200, 100) },
    { kind: 'stroke', pts: strokePts(0, 160, 200, 200) },
    { kind: 'text', x: 0, y: 240, w: 200, content: 'Hello **world**' },
    { kind: 'stroke', pts: strokePts(600, 100, 800, 100) },
  ]);
}

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' });

test.describe('lasso and selection actions (C14, C15)', () => {
  test('free-form and rectangle lasso select any mix; a tap selects one object', async ({ page }) => {
    await openCanvas(page);
    const ids = await scene(page);
    await page.getByRole('radio', { name: /^Lasso/ }).click();
    await lassoRect(page, -20, 80, 260, 220);
    expect((await selection(page)).sort()).toEqual(ids.slice(0, 3).sort());
    await expect(bar(page)).toContainText('3 items');
    // tap on one stroke
    const p = await toClient(page, 700, 100);
    await page.mouse.click(p[0], p[1]);
    expect(await selection(page)).toEqual([ids[3]]);
    // tap on empty space clears
    const e = await toClient(page, 400, 40);
    await page.mouse.click(e[0], e[1]);
    expect(await selection(page)).toEqual([]);
    // rectangle lasso
    await page.getByRole('radio', { name: /^Lasso/ }).click(); // second click switches to rectangle mode
    await expect(page.getByRole('radio', { name: 'Rectangle' })).toHaveAttribute('aria-checked', 'true');
    const a = await toClient(page, 550, 60);
    const b = await toClient(page, 850, 140);
    await dragClient(page, a, b);
    expect(await selection(page)).toEqual([ids[3]]);
  });

  test('move, scale and rotate with the handles; one undo step each', async ({ page }) => {
    await openCanvas(page);
    const ids = await scene(page);
    await page.getByRole('radio', { name: /^Lasso/ }).click();
    await lassoRect(page, -20, 80, 260, 220);
    const before = await objects(page);
    // move by dragging inside the selection
    const from = await toClient(page, 100, 150);
    await dragClient(page, from, [from[0] + 120, from[1] + 60]);
    let after = await objects(page);
    const dx = after.find((o) => o.id === ids[2])!.x - before.find((o) => o.id === ids[2])!.x;
    expect(dx).toBeGreaterThan(50);
    expect(after.find((o) => o.id === ids[3])!.x).toBe(before.find((o) => o.id === ids[3])!.x);
    // scale from the bottom-right corner
    const se = await page.locator('[data-handle="se"]').boundingBox();
    await dragClient(page, [se!.x + 9, se!.y + 9], [se!.x + 9 + 60, se!.y + 9 + 30]);
    after = await objects(page);
    const t = after.find((o) => o.id === ids[2])!;
    expect(t.w).toBeGreaterThan(210);
    // rotate the text box alone
    await withCanvas(page, `(h) => { h.engine.select(['${ids[2]}']); h.engine.revealRegion(h.ctl.boundsOf(['${ids[2]}'])); }`);
    await page.waitForTimeout(400);
    const r = await page.locator('[data-handle="rotate"]').boundingBox();
    const cx = r!.x + 9;
    const cy = r!.y + 9;
    const centre = await toClient(page, t.x + t.w / 2, t.y + t.h / 2);
    await dragClient(page, [cx, cy], [centre[0] + (centre[1] - cy), centre[1]]);
    const rot = (await objects(page)).find((o) => o.id === ids[2])!.rotation;
    expect(Math.abs(rot - 90)).toBeLessThan(5);
    await page.keyboard.press('Control+z');
    expect((await objects(page)).find((o) => o.id === ids[2])!.rotation).toBe(0);
  });

  test('duplicate, delete, recolour, group and ungroup, bring forward and send back', async ({ page }) => {
    await openCanvas(page);
    const ids = await scene(page);
    await page.getByRole('radio', { name: /^Lasso/ }).click();
    await lassoRect(page, -20, 80, 260, 160);
    expect(await selection(page)).toHaveLength(2);
    await bar(page).getByRole('button', { name: /^Duplicate/ }).click();
    expect(await objects(page)).toHaveLength(6);
    await bar(page).getByRole('button', { name: /^Delete/ }).click();
    expect(await objects(page)).toHaveLength(4);
    await lassoRect(page, -20, 80, 260, 160);
    await bar(page).getByRole('button', { name: 'Colour' }).click();
    await bar(page).getByRole('menuitem', { name: 'Blue' }).click();
    expect((await objects(page)).filter((o) => ids.slice(0, 2).includes(o.id)).map((o) => o.color)).toEqual(['#2f6fde', '#2f6fde']);
    // group: a tap on one member selects the group
    await page.keyboard.press('Control+g');
    const p = await toClient(page, 100, 100);
    await page.keyboard.press('Escape');
    await page.mouse.click(p[0], p[1]);
    expect((await selection(page)).sort()).toEqual(ids.slice(0, 2).sort());
    await bar(page).getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^Ungroup/ }).click();
    await page.keyboard.press('Escape');
    await page.mouse.click(p[0], p[1]);
    expect(await selection(page)).toEqual([ids[0]]);
    await page.keyboard.press('Escape');
    // z order: send the first stroke back below the text box? they do not overlap; use two crossing strokes
    const [a, b] = await seed(page, [
      { kind: 'stroke', pts: strokePts(1000, 0, 1100, 100) },
      { kind: 'stroke', pts: strokePts(1000, 100, 1100, 0) },
    ]);
    await withCanvas(page, `(h) => h.engine.select(['${b}'])`);
    await bar(page).getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^Send back/ }).click();
    let objs = await objects(page);
    expect(objs.find((o) => o.id === b)!.z < objs.find((o) => o.id === a)!.z).toBe(true);
    await page.keyboard.press(']');
    objs = await objects(page);
    expect(objs.find((o) => o.id === b)!.z > objs.find((o) => o.id === a)!.z).toBe(true);
  });

  test('copy, cut and paste within and across canvases; registered actions run', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openCanvas(page);
    const ids = await scene(page);
    await page.evaluate(() => {
      const w = window as unknown as { __slateRegistries: { registerSelectionAction(a: unknown): void }; __ran?: number };
      w.__slateRegistries.registerSelectionAction({ id: 'test', label: 'Count objects', run: (ctx: { objects: unknown[] }) => (w.__ran = ctx.objects.length) });
    });
    await withCanvas(page, `(h) => h.engine.select(${JSON.stringify(ids.slice(0, 3))})`);
    await page.keyboard.press('Control+c');
    await expect(page.locator('.toast')).toContainText(/Copied/);
    const clip = await page.evaluate(() => navigator.clipboard.read().then((items) => items.flatMap((i) => [...i.types])));
    expect(clip).toEqual(expect.arrayContaining(['text/plain', 'image/png']));
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Hello **world**');
    const at = await toClient(page, 300, 500);
    await page.mouse.move(at[0], at[1]);
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await objects(page)).length).toBe(7);
    // cut
    await page.keyboard.press('Control+x');
    await expect.poll(async () => (await objects(page)).length).toBe(4);
    // registered action from another area
    await withCanvas(page, `(h) => h.engine.select(${JSON.stringify([ids[3]])})`);
    await bar(page).getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Count objects' }).click();
    expect(await page.evaluate(() => (window as unknown as { __ran: number }).__ran)).toBe(1);
    // across canvases: a new canvas, then paste
    await page.getByRole('button', { name: /Switch canvas/ }).click();
    await page.getByRole('menuitem', { name: /New canvas/ }).click();
    await page.getByLabel('Title of the new canvas').fill('Physics');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.locator('.cv-view[data-canvas="physics"][data-ready="true"]').waitFor();
    await page.getByRole('radio', { name: /^Lasso/ }).first().click();
    await page.locator('.cv-view[data-canvas="physics"] .cv-root').click({ position: { x: 300, y: 300 } });
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await objects(page, 'physics')).length).toBe(3);
  });

  test('export PNG and SVG', async ({ page }) => {
    await openCanvas(page);
    const ids = await scene(page);
    await withCanvas(page, `(h) => h.engine.select(${JSON.stringify(ids)})`);
    for (const kind of ['PNG', 'SVG']) {
      await bar(page).getByRole('button', { name: 'More actions' }).click();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: `Export ${kind}` }).click()]);
      expect(dl.suggestedFilename()).toMatch(new RegExp(`\\.${kind.toLowerCase()}$`));
      const path = await dl.path();
      const fs = await import('node:fs');
      const data = fs.readFileSync(path!);
      if (kind === 'PNG') expect(data.subarray(1, 4).toString()).toBe('PNG');
      else expect(data.toString()).toContain('<svg');
    }
  });

  test('Beautify snaps a rough rectangle to a shape; one tap restores the ink (C10, C16)', async ({ page }) => {
    await openCanvas(page);
    // a hand-drawn rectangle in one stroke
    const pts: Pt[] = [];
    const c = (x: number, y: number) => toClient(page, x, y);
    for (const [x, y] of [
      [100, 0],
      [400, 4],
      [402, 150],
      [97, 148],
      [101, 0],
      [120, 1],
    ])
      pts.push(await c(x, y));
    const dense: Pt[] = [];
    for (let i = 1; i < pts.length; i++) for (let k = 0; k < 12; k++) dense.push([pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * k) / 12 + Math.sin(i * 7 + k) * 1.2, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * k) / 12]);
    const box = await page.locator('.cv-root').boundingBox();
    await drawMouse(page, dense.map(([x, y]) => [x - box!.x, y - box!.y] as Pt));
    await page.getByRole('radio', { name: /^Lasso/ }).click();
    await lassoRect(page, 60, -10, 400, 220);
    await bar(page).getByRole('button', { name: /^Beautify/ }).click();
    let objs = await objects(page);
    const shape = objs.find((o) => o.kind === 'shape')!;
    expect(shape.shape).toBe('rectangle');
    expect(objs.find((o) => o.kind === 'stroke')!.beautifiedInto).toBe(shape.id);
    await bar(page).getByRole('button', { name: 'Restore original ink' }).click();
    objs = await objects(page);
    expect(objs.filter((o) => o.kind === 'shape')).toHaveLength(0);
    expect(objs[0].beautifiedInto).toBeUndefined();
    expect(await selection(page)).toEqual([objs[0].id]);
  });
});
