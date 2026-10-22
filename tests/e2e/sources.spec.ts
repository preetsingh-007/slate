/**
 * Milestone 4 gate (P1, S1–S6): for every source type, lasso a region in the side pane, send it
 * to the real main canvas, and come back through the clip's source badge to the exact location,
 * flashed; then the same return with the network off. Runs on the desktop and tablet profiles
 * (the badge is tapped with a real touch there).
 */
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { makeEpub, makePaperPdf } from '../../src/test/fixtures';
import { lassoRect as canvasLasso, objects, seed, withCanvas } from './canvas-helpers';
import { openWithGym } from './gym-helpers';
import { importFile, lassoRect, libraryItems, openApp, setHelper } from './libraryHelpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** The side pane's visible tab. */
const side = (page: Page) => page.locator('.pane-slot:not([hidden])');

interface Clip {
  id: string;
  kind: string;
  text: string;
  asset?: string;
  natural?: { w: number; h: number };
  source: { type: string; id: string; locator: Record<string, unknown> };
}

async function mainClips(page: Page): Promise<Clip[]> {
  return (await objects(page, 'main')).filter((o) => o.kind === 'clip') as unknown as Clip[];
}

/** Waits for the clip a Send to canvas just placed on the main canvas. */
async function newClip(page: Page, before: number): Promise<Clip> {
  await expect.poll(async () => (await mainClips(page)).length).toBe(before + 1);
  const clips = await mainClips(page);
  return clips[clips.length - 1];
}

/** Closes every side-pane tab, so following the link has to open the source again. */
async function closeSources(page: Page) {
  await page.evaluate(() => (window as unknown as { __slateApp: { setState(s: object): void } }).__slateApp.setState({ tabs: [], active: 0, paneOpen: false }));
  await expect(page.locator('.pane-side')).toHaveCount(0);
}

/** Taps the clip's source badge on the main canvas. */
async function followBadge(page: Page, clipId: string) {
  // the clip on screen (closing the pane may have widened the canvas)
  await withCanvas(page, `(h) => h.engine.showRect(h.ctl.boundsOf(['${clipId}']), false)`);
  const badge = page.locator(`.pane-canvas .cv-clip[data-id="${clipId}"] .cv-badge`);
  await expect(badge).toBeVisible();
  // a real tap on the tablet profile
  if (test.info().project.use.hasTouch) await badge.tap();
  else await badge.click();
}

/** Follows the badge online, then again offline; `flash` is the flashed location in the source. */
async function returnThroughBadge(page: Page, context: BrowserContext, clipId: string, flash: () => Locator, before?: () => Promise<void>) {
  for (const offline of [false, true]) {
    await context.setOffline(offline);
    await closeSources(page);
    await followBadge(page, clipId);
    await before?.();
    await expect(flash(), offline ? 'offline' : 'online').toBeVisible();
    await expect(flash(), offline ? 'offline' : 'online').toBeInViewport();
  }
  await context.setOffline(false);
}

test.describe('Milestone 4: lasso onto the canvas and back through the badge, also offline @touch', () => {
  test('S1–S6 PDF: a region of a page, re-rendered, with its text in reading order', async ({ page, context }) => {
    await openApp(page);
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    const book = (await libraryItems(page)).books[0];
    await side(page).getByRole('button', { name: 'Lasso', exact: true }).click();
    const box = (await page.locator('.pdfv-page[data-page="1"]').boundingBox())!;
    const s = box.width / 612;
    await lassoRect(page, { x: box.x + 310 * s, y: box.y + 155 * s, width: 280 * s, height: 120 * s });
    await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
    const clip = await newClip(page, 0);
    expect(clip.asset).toBeTruthy();
    expect(clip.text).toMatch(/We cluster text runs into columns/);
    expect(clip.source).toMatchObject({ type: 'book', id: book.id, locator: { type: 'pdf', page: 1 } });

    // read on to the end, so the return has to come back to page 1
    await page.locator('.pdfv-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(1000);
    await returnThroughBadge(page, context, clip.id, () => page.locator('.pdfv-page[data-page="1"] [data-testid="flash"]'));
    await expect(page.getByTestId('pdf-page')).toHaveText('1 / 3');
  });

  test('S1–S6 EPUB: a passage as Markdown, back by its quote', async ({ page, context }) => {
    await openApp(page);
    await importFile(page, 'book.epub', await makeEpub(), 'application/epub+zip');
    const table = page.locator('[data-chapter="0"] .epub-html table');
    await expect(table).toBeVisible();
    const book = (await libraryItems(page)).books[0];
    await side(page).getByRole('button', { name: 'Lasso', exact: true }).click();
    const t = (await table.boundingBox())!;
    await lassoRect(page, { x: t.x - 10, y: t.y - 4, width: t.width + 20, height: t.height + 8 });
    await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
    const clip = await newClip(page, 0);
    expect(clip.asset).toBeTruthy();
    expect(clip.text).toContain('| Operation | Cards |');
    expect(clip.source).toMatchObject({ type: 'book', id: book.id, locator: { type: 'epub', chapter: 'OEBPS/text/ch1.xhtml' } });
    await page.locator('.epub-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(1000);
    await returnThroughBadge(page, context, clip.id, () => page.locator('[data-chapter="0"] [data-testid="flash"]').first());
  });

  test('S1–S6 clipping, Reader view: rendered Markdown, back by quote', async ({ page, context }) => {
    await openApp(page);
    const body = ['# Spectral theorem', '', 'Every real symmetric matrix is orthogonally diagonalizable.', '', ...Array.from({ length: 60 }, (_, i) => `Filler paragraph ${i + 1} to scroll past.\n`)].join('\n');
    await page.evaluate(async (text) => navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }) })]), body);
    await page.getByRole('button', { name: 'New from clipboard' }).click();
    const para = page.locator('.clip-article p').first();
    await expect(para).toBeVisible();
    const c = (await libraryItems(page)).clippings[0];
    await side(page).getByRole('button', { name: 'Lasso', exact: true }).click();
    const p = (await para.boundingBox())!;
    await lassoRect(page, { x: p.x - 8, y: p.y - 4, width: p.width + 16, height: p.height + 8 });
    await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
    const clip = await newClip(page, 0);
    expect(clip.asset).toBeTruthy();
    expect(clip.text).toBe('Every real symmetric matrix is orthogonally diagonalizable.');
    expect(clip.source).toMatchObject({ type: 'clipping', id: c.id, locator: { type: 'clipping', view: 'reader' } });
    await page.locator('.clip-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(1000);
    await returnThroughBadge(page, context, clip.id, () => page.locator('.clip-scroll [data-testid="flash"]').first());
  });

  test('S1–S6 clipping, Original view: captured inside the sandboxed snapshot', async ({ page, context }) => {
    await openApp(page);
    await setHelper(page);
    await page.getByRole('button', { name: 'New from link' }).click();
    const dialog = page.getByRole('dialog', { name: 'New from link' });
    await dialog.getByRole('textbox', { name: 'Web address' }).fill('https://blog.example/posts/spaced-repetition');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await side(page).getByRole('radio', { name: 'Original' }).click();
    const frame = page.frameLocator('[data-testid="snapshot-frame"]');
    await expect(frame.locator('h2')).toHaveText('How to use it');
    const c = (await libraryItems(page)).clippings[0];
    const h2 = (await frame.locator('h2').boundingBox())!;
    const ul = (await frame.locator('article ul').boundingBox())!;
    await side(page).getByRole('button', { name: 'Lasso', exact: true }).click();
    await lassoRect(page, { x: h2.x - 6, y: h2.y - 4, width: Math.max(h2.width, ul.width) + 12, height: ul.y + ul.height - h2.y + 8 });
    await expect(page.getByTestId('capture-preview')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
    const clip = await newClip(page, 0);
    expect(clip.asset).toBeTruthy();
    expect(clip.text).toContain('## How to use it');
    expect(clip.source).toMatchObject({ type: 'clipping', id: c.id, locator: { type: 'clipping', view: 'original' } });
    await returnThroughBadge(page, context, clip.id, () => page.frameLocator('[data-testid="snapshot-frame"]').locator('[data-flash]').first());
  });

  test('S1–S6 gym file: Markdown source with LaTeX, back to the quote', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openWithGym(page);
    const path = 'math/linear-algebra/eigenvalues/notes.md';
    await page.evaluate((p) => (window as unknown as { __slateApp: { getState(): { openTab(t: object): void } } }).__slateApp.getState().openTab({ kind: 'gym', path: p }), path);
    const para = side(page).locator('.gym-md p', { hasText: 'is an eigenvalue of' });
    await expect(para.locator('.katex').first()).toBeVisible();
    await side(page).getByRole('button', { name: 'Rectangle lasso' }).click();
    const b = (await para.boundingBox())!;
    // the rectangle lasso spans from where the drag starts to where it ends
    await page.mouse.move(b.x - 6, b.y - 4);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.mouse.move(b.x + b.width + 6, b.y + b.height + 4, { steps: 4 });
    await page.mouse.up();
    await side(page).getByRole('region', { name: 'Captures' }).getByRole('button', { name: 'Send to canvas' }).click();
    const clip = await newClip(page, 0);
    expect(clip.asset).toBeTruthy();
    expect(clip.text).toContain('is an **eigenvalue** of $T$');
    expect(clip.source).toMatchObject({ type: 'gym', id: path, locator: { type: 'gym', path } });
    await returnThroughBadge(page, context, clip.id, () => side(page).locator('.gym-flash').first());
  });

  test('S1–S6 a second canvas in the side pane: the region rendered, its text, back to the region', async ({ page, context }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    await page.evaluate(() => (window as unknown as { __slate: { canvases: { create(t: string, s: string): Promise<unknown> } } }).__slate.canvases.create('Physics', 'physics'));
    await page.evaluate(() => (window as unknown as { __slateApp: { getState(): { openTab(t: object): void } } }).__slateApp.getState().openTab({ kind: 'canvas', slug: 'physics' }));
    await page.locator('.pane-side .cv-view[data-canvas="physics"][data-ready="true"]').waitFor();
    // something to clip, and something far away so the return has to scroll
    const view = await withCanvas<{ x: number; y: number }>(page, '(h) => h.engine.view', 'physics');
    const [textId] = await seed(page, [{ kind: 'text', x: view.x + 40, y: view.y + 60, w: 240, content: 'Newton: $F = ma$' }], 'physics');
    await seed(page, [{ kind: 'stroke', pts: [view.x + 40, view.y + 120, 0.5, view.x + 260, view.y + 130, 0.5] }], 'physics');
    await page.locator('.pane-side').getByRole('radio', { name: 'Lasso (L)' }).click();
    await canvasLasso(page, view.x + 20, view.y + 40, 280, 110, 'physics');
    await expect.poll(() => withCanvas<string[]>(page, '(h) => h.engine.getSelection()', 'physics')).toContain(textId);
    await page.locator('.pane-side').getByRole('toolbar', { name: 'Selection, Physics' }).getByRole('button', { name: 'Send to canvas' }).click();
    const clip = await newClip(page, 0);
    expect(clip.asset).toBeTruthy();
    expect(clip.natural!.w).toBeGreaterThan(400);
    expect(clip.text).toBe('Newton: $F = ma$');
    expect(clip.source).toMatchObject({ type: 'canvas', id: 'physics', locator: { type: 'canvas', canvas: 'physics' } });
    const region = clip.source.locator.region as { x: number; y: number; w: number; h: number };
    expect(region.x).toBeLessThanOrEqual(view.x + 40);
    expect(region.y + region.h).toBeGreaterThanOrEqual(view.y + 130);
    // nothing of the second canvas moved onto the main one but the clip
    expect((await objects(page, 'main')).map((o) => o.kind)).toEqual(['clip']);

    await withCanvas(page, '(h) => h.engine.setCamera({ x: 20000, y: 20000, zoom: 1 })', 'physics');
    await returnThroughBadge(page, context, clip.id, () => page.locator('.pane-side [data-testid="flash"]'));
    const v = await withCanvas<{ x: number; y: number; w: number; h: number }>(page, '(h) => h.engine.view', 'physics');
    expect(v.x <= region.x && v.x + v.w >= region.x + region.w && v.y <= region.y && v.y + v.h >= region.y + region.h).toBe(true);
  });
});

test('S3: a region of a side-pane canvas dragged onto the main canvas lands where it is dropped', async ({ page }) => {
  await openApp(page);
  await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
  await page.evaluate(() => (window as unknown as { __slate: { canvases: { create(t: string, s: string): Promise<unknown> } } }).__slate.canvases.create('Physics', 'physics'));
  await page.evaluate(() => (window as unknown as { __slateApp: { getState(): { openTab(t: object): void } } }).__slateApp.getState().openTab({ kind: 'canvas', slug: 'physics' }));
  await page.locator('.pane-side .cv-view[data-canvas="physics"][data-ready="true"]').waitFor();
  const view = await withCanvas<{ x: number; y: number }>(page, '(h) => h.engine.view', 'physics');
  const [id] = await seed(page, [{ kind: 'text', x: view.x + 40, y: view.y + 60, w: 240, content: 'Dragged across' }], 'physics');
  await withCanvas(page, `(h) => h.engine.select(['${id}'])`, 'physics');
  const send = page.locator('.pane-side').getByRole('toolbar', { name: 'Selection, Physics' }).getByRole('button', { name: 'Send to canvas' });
  const from = (await send.boundingBox())!;
  const main = (await page.locator('.pane-canvas .cv-root').boundingBox())!;
  const to: [number, number] = [main.x + 200, main.y + 300];
  const at = await withCanvas<{ x: number; y: number }>(page, `(h) => h.api.clientToCanvas(${to[0]}, ${to[1]})`);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to[0] - from.x) * i) / 12, from.y + ((to[1] - from.y) * i) / 12);
  await page.mouse.up();
  const clip = await newClip(page, 0);
  expect(clip.text).toBe('Dragged across');
  const placed = (await objects(page, 'main')).find((o) => o.id === clip.id)!;
  expect(placed.x).toBeCloseTo(at.x, -1);
  expect(placed.y).toBeCloseTo(at.y, -1);
});
