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

// ---------------------------------------------------------------- keyboard (NFR: every action
// except drawing works from the keyboard). These tests use no mouse; files come in through
// the file input, as the system file picker would give them.

/** The focused element's accessible name (aria-label, else its text). */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return '';
    const by = el.getAttribute('aria-labelledby');
    return (el.getAttribute('aria-label') ?? (by ? document.getElementById(by)?.textContent : null) ?? el.textContent ?? '').trim();
  });

/** Presses Tab (or Shift+Tab) until the focused element's name matches. */
async function tabTo(page: Page, name: string | RegExp, { back = false, max = 120 } = {}) {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    const n = await focusedName(page);
    if (typeof name === 'string' ? n === name : name.test(n)) return;
    seen.push(n);
  }
  throw new Error(`Tab never reached ${name}; passed: ${seen.slice(-30).join(' | ')}`);
}

const mainObjects = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __slateCanvas: { main: { ctl: { model: { objects(): Iterable<{ id: string; kind: string; content?: string; topics: string[] }>; marks(): { kind: string }[] } }; engine: { getSelection(): string[] } } } }).__slateCanvas.main;
    return { objects: [...h.ctl.model.objects()], marks: h.ctl.model.marks(), selection: h.engine.getSelection() };
  });

test.describe('keyboard only (NFR accessibility)', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('W1: tools, a text box with a to-do, the selection’s actions and menus, the To-dos page', async ({ page }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    await tabTo(page, 'Canvas Main');
    // tool shortcuts
    for (const [key, tool] of [['p', 'Pen (P)'], ['m', 'Highlighter (M)'], ['l', 'Lasso (L)'], ['t', 'Text (T)']] as const) {
      await page.keyboard.press(key);
      await expect(page.getByRole('radio', { name: tool })).toHaveAttribute('aria-checked', 'true');
    }
    // a text box, typed; Escape returns to the canvas with the box selected
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: /Text box/ })).toBeFocused();
    await page.keyboard.type('Lecture 5');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- [ ] read Axler 5B');
    await page.keyboard.press('Escape');
    await expect(page.locator('.cv-root').first()).toBeFocused();
    await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeVisible();
    expect((await mainObjects(page)).objects.find((o) => o.kind === 'text')?.content).toBe('Lecture 5\n- [ ] read Axler 5B');

    // Tab goes from the canvas to the selection's actions; Mark for gym through its dialog
    await page.keyboard.press('Tab');
    expect(await focusedName(page)).toBe('Copy (⌘C)');
    await tabTo(page, 'Mark for gym');
    await page.keyboard.press('Enter');
    const mark = page.getByRole('dialog', { name: 'Mark for gym' });
    await expect(mark).toBeVisible();
    await expect(mark.getByRole('radio', { name: 'Note' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(mark.getByRole('radio', { name: 'Problem' })).toBeChecked();
    await tabTo(page, 'Mark');
    await page.keyboard.press('Enter');
    await expect(mark).toBeHidden();
    await expect.poll(async () => (await mainObjects(page)).marks.map((m) => m.kind)).toEqual(['problem']);
    expect(await focusedName(page)).toBe('Mark for gym');

    // the More actions menu: focus moves in, arrows move, Escape closes and returns
    await tabTo(page, 'More actions');
    await page.keyboard.press('Enter');
    const more = page.getByRole('menu', { name: 'More actions' });
    await expect(more.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(more.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(more.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(more).toBeHidden();
    expect(await focusedName(page)).toBe('More actions');
    expect((await mainObjects(page)).selection).toHaveLength(1);

    // Duplicate, then select both with Shift+Alt+arrows (the keyboard's lasso), then delete
    await tabTo(page, 'Duplicate (⌘D)', { back: true });
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await mainObjects(page)).objects.filter((o) => o.kind === 'text').length).toBe(2);
    await tabTo(page, 'Canvas Main', { back: true });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Shift+Alt+ArrowRight');
    expect((await mainObjects(page)).selection).toHaveLength(2);
    await page.keyboard.press('Tab');
    await tabTo(page, 'Delete (⌫)');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await mainObjects(page)).objects.filter((o) => o.kind === 'text').length).toBe(0);
    // the bar went away with the selection: focus is back on the canvas, not lost
    await expect(page.locator('.cv-root').first()).toBeFocused();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await mainObjects(page)).objects.filter((o) => o.kind === 'text').length).toBe(2);

    // the Insert image menu
    await tabTo(page, 'Insert image', { back: true });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Insert image' }).getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    expect(await focusedName(page)).toBe('Insert image');

    // the To-dos page
    await tabTo(page, 'To-dos', { back: true });
    await page.keyboard.press('Enter');
    await tabTo(page, 'Add a to-do');
    await page.keyboard.type('Buy chalk');
    await page.keyboard.press('Enter');
    await expect(pane(page).getByRole('list', { name: 'Checklist' }).getByRole('textbox', { name: 'To-do' })).toHaveValue('Buy chalk');
  });

  test('W2 and W3: open a book, capture a region with the keyboard rectangle, follow the badge; New from clipboard', async ({ page }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    await tabTo(page, 'Library');
    await page.keyboard.press('Enter');
    await page.getByTestId('import-input').setInputFiles({ name: 'paper.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makePaperPdf()) });
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    // the lasso, from the keyboard: arrows show and move a rectangle, Enter captures it
    await tabTo(page, 'Lasso');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('application', { name: /^Lasso/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const preview = page.getByTestId('capture-preview');
    await expect(preview.getByRole('button', { name: 'Send to canvas' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await mainObjects(page)).objects.filter((o) => o.kind === 'clip').length).toBe(1);
    // back through the clip's source badge
    await page.evaluate(() => (window as unknown as { __slateApp: { setState(s: object): void } }).__slateApp.setState({ tabs: [], active: 0, paneOpen: false }));
    // the new clip is selected: show it (fit selection), clear the selection, Tab to its badge
    await tabTo(page, 'Canvas Main');
    await page.keyboard.press('Shift+Digit2');
    await page.keyboard.press('Escape');
    await tabTo(page, /^Open source: /);
    await page.keyboard.press('Enter');
    await expect(page.locator('.pdfv-page[data-page="1"] [data-testid="flash"]')).toBeVisible();

    // New from clipboard (W3)
    await page.evaluate(async () => navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['# An answer\n\nWith $x^2$.'], { type: 'text/plain' }) })]));
    await tabTo(page, 'New from clipboard', { back: true });
    await page.keyboard.press('Enter');
    await expect(pane(page).getByTestId('clipping-pane')).toBeVisible();
    await expect(pane(page).locator('.clip-article .katex').first()).toBeVisible();
  });

  test('W5: the gym reader and the revision list', async ({ page }) => {
    await openWithGym(page);
    await tabTo(page, 'Revision list');
    await page.keyboard.press('Enter');
    await expect(pane(page).locator('.gym-rev-entry').first()).toBeVisible();
    await tabTo(page, /\S/);
    // the first entry opens with Enter
    await pane(page).locator('.gym-rev-entry').first().focus();
    await page.keyboard.press('Enter');
    await expect(pane(page).locator('.gym-md h1')).toBeVisible();
  });

  test('dialogs keep focus inside and return it; Escape closes', async ({ page }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    await tabTo(page, 'Library');
    await page.keyboard.press('Enter');
    await page.getByTestId('import-input').setInputFiles({ name: 'paper.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makePaperPdf()) });
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    await tabTo(page, 'Library', { back: true });
    await page.keyboard.press('Enter');
    await tabTo(page, /^More actions for /);
    const opener = await focusedName(page);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: /Edit details/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /Delete/ });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await focusedName(page)).toBe(opener);

    // New from link: same rules
    await tabTo(page, 'New from link', { back: true });
    await page.keyboard.press('Enter');
    const link = page.getByRole('dialog', { name: 'New from link' });
    await expect(link.getByRole('textbox', { name: 'Web address' })).toBeFocused();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await link.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(link).toBeHidden();
    expect(await focusedName(page)).toBe('New from link');
  });

  test('focus is always visible', async ({ page }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    const invisible: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        let el = document.activeElement as HTMLElement;
        // a visually hidden input shows its focus on its label
        if (el.classList.contains('visually-hidden')) el = el.closest('label') ?? el;
        const cs = getComputedStyle(el);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1) || cs.boxShadow !== 'none';
        return { name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName, ring };
      });
      if (!r.ring) invisible.push(r.name);
    }
    expect(invisible).toEqual([]);
  });
});

test.describe('reduced motion (NFR accessibility)', () => {
  test.use({ reducedMotion: 'reduce' });

  test('flashes stay still for their 2 s, nothing animates, the view jumps instead of gliding', async ({ page }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    const [id] = await seed(page, [{ kind: 'text', x: 0, y: 3000, w: 200, content: 'Far below' }]);
    await withCanvas(page, `(h) => h.api.revealObject('${id}')`);
    // no glide: the camera is there on the next frames
    await page.waitForTimeout(100);
    expect(await withCanvas<boolean>(page, `(h) => { const v = h.engine.view; return v.y < 3000 && v.y + v.h > 3000; }`)).toBe(true);
    const flash = page.locator('.cv-flash').first();
    await expect(flash).toBeVisible();
    await page.waitForTimeout(1200);
    expect(await flash.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    // nothing on the page runs a visible animation or transition
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration ?? 0) > 1)
        .map((a) => (a.effect as KeyframeEffect | null)?.target?.className ?? '?'),
    );
    expect(running).toEqual([]);
  });
});
