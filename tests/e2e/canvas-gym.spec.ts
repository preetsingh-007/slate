import { expect, test, type Page } from '@playwright/test';
import { objects, openCanvas, seed, strokePts, withCanvas } from './canvas-helpers';

type Mark = { id: string; kind: string; topic: string; problem: string; comment: string; objects: string[] };
const marks = (page: Page) => withCanvas<Mark[]>(page, '(h) => h.ctl.model.marks()');
const formalize = (page: Page, text: string) =>
  page.evaluate((t) => (window as unknown as { __slate: { formalized: { setFromText(t: string): Promise<void> } } }).__slate.formalized.setFromText(t), text);

test.describe('gym hand-off on the canvas (G2, G3, G6, W4)', () => {
  test('mark for gym: create, flag, edit, formalized badge opens the gym file, dismissed', async ({ page }) => {
    await openCanvas(page);
    const ids = await seed(page, [
      { kind: 'stroke', pts: strokePts(0, 100, 200, 140) },
      { kind: 'text', x: 0, y: 160, w: 220, content: 'Eigenvalues of $A$' },
    ]);
    await withCanvas(page, `(h) => h.engine.select(${JSON.stringify(ids)})`);
    await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Mark for gym' }).click();
    const dlg = page.getByRole('dialog', { name: 'Mark for gym' });
    await dlg.getByLabel('Solution').check();
    await dlg.getByLabel('Topic (optional)').fill('math/linear-algebra/eigenvalues');
    await dlg.getByLabel('Problem (optional)').fill('math/linear-algebra/eigenvalues/problems/01-trace.md');
    await dlg.getByLabel('Comment (optional)').fill('second attempt');
    await dlg.getByRole('button', { name: 'Mark' }).click();
    let list = await marks(page);
    expect(list).toHaveLength(1);
    const m = list[0];
    expect(m).toMatchObject({ kind: 'solution', topic: 'math/linear-algebra/eigenvalues', problem: 'math/linear-algebra/eigenvalues/problems/01-trace.md', comment: 'second attempt' });
    expect(m.id).toMatch(/^[a-z0-9]+$/);
    expect(m.objects.sort()).toEqual(ids.sort());
    const flag = page.locator(`[data-mark="${m.id}"] .cv-flag`);
    await expect(flag).toContainText('Solution');

    // editable until formalized
    await flag.click();
    await page.getByRole('dialog', { name: 'Edit mark' }).getByLabel('Question').check();
    await page.getByRole('dialog', { name: 'Edit mark' }).getByRole('button', { name: 'Save' }).click();
    list = await marks(page);
    expect(list[0].kind).toBe('question');
    expect(list[0].problem).toBe('');

    // formalized: a badge opens the gym file at the heading (G6)
    await formalize(page, `- ${m.id} → ../math/linear-algebra/eigenvalues/notes.md#trace · 2026-10-22\n`);
    const badge = page.locator(`[data-mark="${m.id}"] .cv-flag.formalized`);
    await expect(badge).toBeVisible();
    await badge.click();
    const tabs = await page.evaluate(() => (window as unknown as { __slateApp: { getState(): { tabs: unknown[] } } }).__slateApp.getState().tabs);
    expect(tabs[0]).toEqual({ kind: 'gym', path: 'math/linear-algebra/eigenvalues/notes.md#trace' });

    // a second mark, dismissed in gym
    await withCanvas(page, `(h) => h.engine.select(['${ids[0]}'])`);
    await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Mark for gym' }).click();
    await page.getByRole('dialog', { name: 'Mark for gym' }).getByRole('button', { name: 'Mark' }).click();
    const second = (await marks(page)).find((x) => x.id !== m.id)!;
    await formalize(page, `- ${m.id} → ../math/linear-algebra/eigenvalues/notes.md#trace · 2026-10-22\n- ${second.id} → dismissed · 2026-10-22\n`);
    await expect(page.locator(`[data-mark="${second.id}"] .cv-flag`)).toContainText('dismissed');
  });

  test('a pending mark can be removed', async ({ page }) => {
    await openCanvas(page);
    const ids = await seed(page, [{ kind: 'stroke', pts: strokePts(0, 100, 200, 140) }]);
    await withCanvas(page, `(h) => h.engine.select(${JSON.stringify(ids)})`);
    await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Mark for gym' }).click();
    await page.getByRole('dialog', { name: 'Mark for gym' }).getByRole('button', { name: 'Mark' }).click();
    const [m] = await marks(page);
    await page.locator(`[data-mark="${m.id}"] .cv-flag`).click();
    await page.getByRole('button', { name: 'Remove mark' }).click();
    expect(await marks(page)).toHaveLength(0);
    await page.keyboard.press('Control+z');
    expect(await marks(page)).toHaveLength(1);
  });

  test('topic tags on a selection, a day and the canvas, shown on the canvas (G2)', async ({ page }) => {
    await openCanvas(page);
    const ids = await seed(page, [{ kind: 'stroke', pts: strokePts(0, 100, 200, 140) }]);
    await withCanvas(page, `(h) => h.engine.select(${JSON.stringify(ids)})`);
    await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Tag with topics' }).click();
    const dlg = page.getByRole('dialog', { name: 'Tag with topics' });
    await dlg.getByLabel('Add a topic').fill('math/linear-algebra/eigenvalues');
    await dlg.getByLabel('Add a topic').press('Enter');
    await dlg.getByLabel('Add a topic').fill('cs/algorithms/graphs');
    await dlg.getByRole('button', { name: 'Save' }).click();
    expect((await objects(page))[0].topics).toEqual(['math/linear-algebra/eigenvalues', 'cs/algorithms/graphs']);
    await expect(page.locator('.cv-tagchip')).toContainText('eigenvalues');

    // the day
    await page.getByRole('button', { name: /^Tag .* with topics$/ }).first().click();
    await page.getByLabel('Add a topic').fill('math/linear-algebra');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    expect(await withCanvas(page, `(h) => h.ctl.model.dayTopics('${today}')`)).toEqual(['math/linear-algebra']);
    await expect(page.getByTestId('dayline').locator('.cv-topic-chip')).toHaveText('linear-algebra');

    // the canvas
    await page.getByRole('button', { name: /view options/ }).click();
    await page.getByRole('menuitem', { name: /Tag this canvas/ }).click();
    await page.getByLabel('Add a topic').fill('math');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    expect(await page.evaluate(() => (window as unknown as { __slate: { canvases: { meta(s: string): { topics: string[] } } } }).__slate.canvases.meta('main').topics)).toEqual(['math']);
  });

  test('uses the topic picker when the gym area registers one', async ({ page }) => {
    await openCanvas(page);
    await page.evaluate(() => {
      const w = window as unknown as { __slateRegistries: { registerTopicPicker(c: unknown): void } };
      w.__slateRegistries.registerTopicPicker((p: { label?: string }) => `PICKER ${p.label}`);
    });
    const ids = await seed(page, [{ kind: 'stroke', pts: strokePts(0, 100, 200, 140) }]);
    await withCanvas(page, `(h) => h.engine.select(${JSON.stringify(ids)})`);
    await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Mark for gym' }).click();
    await expect(page.getByRole('dialog', { name: 'Mark for gym' })).toContainText('PICKER Topic (optional)');
  });
});
