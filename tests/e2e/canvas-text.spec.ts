import { expect, test } from '@playwright/test';
import { dragClient, objects, openCanvas, seed, surface, toClient, withCanvas } from './canvas-helpers';

test.describe('text boxes and to-dos (C7)', () => {
  test('the text tool makes a Markdown box with maths and a tappable to-do', async ({ page }) => {
    await openCanvas(page);
    await page.getByRole('radio', { name: /^Text/ }).click();
    const b = await surface(page);
    await page.mouse.click(b.x + 200, b.y + 300);
    const ta = page.getByRole('textbox', { name: /Text box/ });
    await expect(ta).toBeFocused();
    await ta.pressSequentially('# Lecture 4');
    // C7: while the new box is edited, only the editor shows it (no rendered copy underneath)
    await expect(page.locator('.cv-text:not(.editing)')).toHaveCount(0);
    await ta.press('Enter');
    await ta.pressSequentially('- [ ] read $\\lambda$ section');
    await ta.press('Enter');
    await ta.pressSequentially('$$x^2 + y^2$$');
    await ta.press('Escape');
    const [t] = await objects(page);
    expect(t.kind).toBe('text');
    expect(t.content).toBe('# Lecture 4\n- [ ] read $\\lambda$ section\n$$x^2 + y^2$$');
    const box = page.locator(`.cv-text[data-id="${t.id}"]`);
    await expect(box.locator('h1')).toHaveText('Lecture 4');
    await expect(box.locator('.katex').first()).toBeVisible();
    await expect(box.locator('.katex-display')).toHaveCount(1);
    // C7: the checkbox is tappable and writes back into the Markdown
    await box.locator('input.md-task').click();
    expect((await objects(page))[0].content).toContain('- [x] read');
    await page.keyboard.press('Control+z');
    expect((await objects(page))[0].content).toContain('- [ ] read');
    // height follows the content
    await expect.poll(async () => (await objects(page))[0].h).toBeGreaterThan(60);
  });

  test('editing an existing box is undoable; an emptied box is removed', async ({ page }) => {
    await openCanvas(page);
    const [id] = await seed(page, [{ kind: 'text', x: 0, y: 100, w: 300, content: 'alpha' }]);
    await withCanvas(page, `(h) => h.engine.select(['${id}'])`);
    await page.locator('.cv-root').focus();
    await page.keyboard.press('Enter');
    const ta = page.getByRole('textbox', { name: /Text box/ });
    await expect(ta).toBeFocused();
    await ta.press('End');
    await ta.pressSequentially(' beta');
    await ta.press('Escape');
    expect((await objects(page))[0].content).toBe('alpha beta');
    await page.keyboard.press('Control+z');
    expect((await objects(page))[0].content).toBe('alpha');
    // empty it: the box goes away
    await withCanvas(page, `(h) => h.engine.select(['${id}'])`);
    await page.keyboard.press('Enter');
    await ta.press('Control+a');
    await ta.press('Backspace');
    await ta.press('Escape');
    expect(await objects(page)).toHaveLength(0);
  });

  test('typing on an empty spot with a keyboard starts a box there; double-click too', async ({ page }) => {
    await openCanvas(page);
    await page.getByRole('radio', { name: /^Lasso/ }).click();
    const b = await surface(page);
    await page.mouse.click(b.x + 300, b.y + 300);
    await page.keyboard.type('quick note');
    await page.keyboard.press('Escape');
    let objs = await objects(page);
    expect(objs.map((o) => o.content)).toEqual(['quick note']);
    const p = await toClient(page, objs[0].x, objs[0].y);
    expect(Math.abs(p[0] - (b.x + 300))).toBeLessThan(4);
    await page.mouse.dblclick(b.x + 300, b.y + 450);
    await page.keyboard.type('second');
    await page.keyboard.press('Escape');
    objs = await objects(page);
    expect(objs.map((o) => o.content).sort()).toEqual(['quick note', 'second']);
  });

  test('editing a text box after tapping an empty spot shows one blinking caret, not two', async ({ page }) => {
    await openCanvas(page);
    const [id] = await seed(page, [{ kind: 'text', x: 0, y: 100, w: 300, content: 'existing notes' }]);
    await page.getByRole('radio', { name: /^Lasso/ }).click();
    const b = await surface(page);
    // display, not visibility: the caret blinks by turning invisible half the time
    const caret = page.locator('.cv-caret');
    const shown = () => caret.evaluate((el) => getComputedStyle(el).display !== 'none');
    // a tap on an empty spot shows where typing will start
    await page.mouse.click(b.x + 400, b.y + 500);
    await expect.poll(shown).toBe(true);
    // opening a box with the text tool: only the box's caret
    await page.getByRole('radio', { name: /^Text/ }).click();
    const [x, y] = await toClient(page, 20, 110);
    await page.mouse.click(x, y);
    await expect(page.getByRole('textbox', { name: /Text box/ })).toBeFocused();
    expect(await shown()).toBe(false);
    // panning redraws every frame: the canvas caret stays away
    await withCanvas(page, '(h) => h.engine.setCamera({ ...h.engine.camera, y: h.engine.camera.y + 30 })');
    await page.waitForTimeout(100);
    expect(await shown()).toBe(false);
    // and does not come back at the old tap when editing ends
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    expect(await shown()).toBe(false);
    expect((await objects(page)).find((o) => o.id === id)?.content).toBe('existing notes');
  });

  test('the width is draggable', async ({ page }) => {
    await openCanvas(page);
    const [id] = await seed(page, [{ kind: 'text', x: 0, y: 100, w: 300, content: 'a fairly long line of text that wraps when the box is narrow' }]);
    await withCanvas(page, `(h) => h.engine.select(['${id}'])`);
    const h0 = (await objects(page))[0].h;
    const handle = await page.locator('[data-handle="width"]').boundingBox();
    await dragClient(page, [handle!.x + 9, handle!.y + 14], [handle!.x - 150, handle!.y + 14]);
    const t = (await objects(page))[0];
    expect(t.w).toBeLessThan(200);
    await expect.poll(async () => (await objects(page))[0].h).toBeGreaterThan(h0);
  });
});
