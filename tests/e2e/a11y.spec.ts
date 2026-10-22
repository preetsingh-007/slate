/**
 * Accessibility NFR: every control is labelled for screen readers, and no two controls in the
 * same toolbar, dialog, menu or panel share a name (two "Settings" buttons in the top bar were
 * once indistinguishable). Names and roles come from Chromium's accessibility tree.
 */
import { expect, test, type Page } from '@playwright/test';
import { makePaperPdf } from '../../src/test/fixtures';
import { openWithGym, pane } from './gym-helpers';
import { importFile, lassoRect, openApp, openLibrary } from './libraryHelpers';
import { seed, withCanvas } from './canvas-helpers';

const CONTROLS = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'combobox', 'slider', 'spinbutton', 'switch', 'option', 'separator']);
/** Containers within which names must differ. */
const GROUPS = new Set(['toolbar', 'dialog', 'alertdialog', 'menu', 'tabpanel', 'tablist', 'radiogroup', 'region', 'complementary', 'navigation', 'banner', 'application', 'form', 'search', 'listbox', 'RootWebArea']);

interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: { value: string };
  name?: { value: string };
  parentId?: string;
  childIds?: string[];
  properties?: { name: string; value: { value: unknown } }[];
}

/** Unnamed controls and duplicate names within one group, as readable lines. */
async function audit(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: AXNode[] };
  await cdp.detach();
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const problems: string[] = [];
  const seen = new Map<string, string>();
  // landmarks and toolbars are navigated by name: two with the same name are ambiguous
  const groups = new Set<string>();
  for (const n of nodes) {
    const role = n.role?.value ?? '';
    if (n.ignored || !['toolbar', 'region', 'complementary', 'navigation', 'application', 'dialog', 'tablist'].includes(role)) continue;
    const key = `${role} "${n.name?.value ?? ''}"`;
    if (groups.has(key)) problems.push(`two ${key}`);
    groups.add(key);
  }
  for (const n of nodes) {
    const role = n.role?.value ?? '';
    if (n.ignored || !CONTROLS.has(role)) continue;
    // a separator is a control only when focusable (the pane divider)
    if (role === 'separator' && !n.properties?.some((p) => p.name === 'focusable' && p.value.value)) continue;
    const name = (n.name?.value ?? '').trim();
    let g = n.parentId ? byId.get(n.parentId) : undefined;
    while (g && !GROUPS.has(g.role?.value ?? '')) g = g.parentId ? byId.get(g.parentId) : undefined;
    const group = g ? `${g.role?.value} "${g.name?.value ?? ''}"` : 'page';
    if (!name) {
      problems.push(`unnamed ${role} in ${group}`);
      continue;
    }
    const key = `${g?.nodeId}|${role}|${name}`;
    if (seen.has(key)) problems.push(`two ${role}s named "${name}" in ${group}`);
    seen.set(key, name);
  }
  return [...new Set(problems)];
}

async function expectClean(page: Page, where: string) {
  expect(await audit(page), where).toEqual([]);
}

test.describe('accessible names (NFR accessibility)', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('the shell, the canvas and its selection, a side-pane canvas, settings', async ({ page }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    await expectClean(page, 'start');
    const [id] = await seed(page, [{ kind: 'text', x: 0, y: 0, w: 200, content: 'Hello' }]);
    await withCanvas(page, `(h) => h.engine.select(['${id}'])`);
    await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeVisible();
    await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'More actions' }).click();
    await expectClean(page, 'selection and its menu');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as unknown as { __slate: { canvases: { create(t: string, s: string): Promise<unknown> } } }).__slate.canvases.create('Physics', 'physics'));
    await page.getByRole('button', { name: /Switch canvas/ }).click();
    await expectClean(page, 'canvas switcher');
    await page.getByRole('button', { name: 'Open Physics in the side pane' }).click();
    await page.locator('.pane-side .cv-view[data-canvas="physics"][data-ready="true"]').waitFor();
    const [sideId] = await seed(page, [{ kind: 'text', x: 0, y: 0, w: 200, content: 'There' }], 'physics');
    await withCanvas(page, `(h) => h.engine.select(['${sideId}'])`, 'physics');
    await expect(page.getByRole('toolbar', { name: 'Selection, Physics' })).toBeVisible();
    await expectClean(page, 'a canvas in the side pane, with a selection');
    // the carry tray
    await page.evaluate(() =>
      (window as unknown as { __slateApp: { getState(): { addToCarry(c: object): void } } }).__slateApp.getState().addToCarry({
        id: 'k1', text: 'Carried', created: 0,
        source: { type: 'book', id: 'b', title: 'Axler', locator: { type: 'pdf', page: 1, region: { x: 0, y: 0, w: 1, h: 1 }, quote: '' }, capturedAt: 0, contentHash: '' },
      }),
    );
    await expect(page.getByRole('complementary', { name: /Carry tray/ })).toBeVisible();
    await expectClean(page, 'carry tray');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expectClean(page, 'settings');
  });

  test('the library, a book and a clipping', async ({ page }) => {
    await openApp(page);
    await openLibrary(page);
    await expectClean(page, 'library');
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    await expectClean(page, 'PDF');
    await pane(page).getByRole('button', { name: 'Lasso', exact: true }).click();
    const box = (await page.locator('.pdfv-page[data-page="1"]').boundingBox())!;
    await lassoRect(page, { x: box.x + 40, y: box.y + 40, width: 200, height: 80 });
    await expect(page.getByTestId('capture-preview')).toBeVisible();
    await expectClean(page, 'capture preview');
    await page.keyboard.press('Escape');
    await page.evaluate(async () => navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['# A clipping\n\nWith text.'], { type: 'text/plain' }) })]));
    await page.getByRole('button', { name: 'New from clipboard' }).click();
    await expect(pane(page).getByTestId('clipping-pane')).toBeVisible();
    await pane(page).getByRole('button', { name: 'Annotations' }).click();
    await expectClean(page, 'clipping with its annotations panel');
    await page.getByRole('button', { name: 'New from link' }).click();
    await expectClean(page, 'New from link');
  });

  test('the gym reader, the revision list and the To-dos page', async ({ page }) => {
    await openWithGym(page);
    await page.getByRole('button', { name: 'Gym' }).click();
    await expectClean(page, 'gym home');
    await page.evaluate(() => (window as unknown as { __slateGym: { app: { getState(): { openTab(t: object): void } } } }).__slateGym.app.getState().openTab({ kind: 'gym', path: 'math/linear-algebra/eigenvalues/notes.md' }));
    await expect(pane(page).locator('.gym-md h1')).toBeVisible();
    await expectClean(page, 'gym file');
    await page.getByRole('button', { name: 'Revision list' }).click();
    await expectClean(page, 'revision');
    await page.getByRole('button', { name: 'To-dos' }).click();
    await expectClean(page, 'to-dos');
  });

  test('narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expectClean(page, 'narrow library');
    await page.getByRole('button', { name: 'Show canvas' }).click();
    await expectClean(page, 'narrow canvas');
  });
});
