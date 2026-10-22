/**
 * iPhone scope (PRD: reading, quick capture, to-dos and the revision list) at 390 × 844 with
 * touch: every control on screen, one pane at a time (P2), dialogs and panes inside the screen,
 * no sideways scrolling of the page.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { makePaperPdf } from '../../src/test/fixtures';
import { openWithGym, pane } from './gym-helpers';
import { libraryItems, setHelper } from './libraryHelpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] });

const W = 390;
const H = 844;

/** The element lies inside the screen. */
async function onScreen(l: Locator, what: string) {
  const b = await l.boundingBox();
  expect(b, what).not.toBeNull();
  expect(b!.x, `${what} left`).toBeGreaterThanOrEqual(-0.5);
  expect(b!.y, `${what} top`).toBeGreaterThanOrEqual(-0.5);
  expect(b!.x + b!.width, `${what} right`).toBeLessThanOrEqual(W + 0.5);
  expect(b!.y + b!.height, `${what} bottom`).toBeLessThanOrEqual(H + 0.5);
}

async function noSidewaysScroll(page: Page, where: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), where).toBeLessThanOrEqual(W);
  // the top bar shows all of its controls (it would otherwise scroll them out of sight)
  const bar = await page.locator('.topbar').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(bar.scroll, `${where}: top bar`).toBeLessThanOrEqual(bar.client);
  for (const b of await page.locator('.topbar button').all()) if (await b.isVisible()) await onScreen(b, `${where}: ${await b.getAttribute('aria-label')}`);
}

const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });

test('reading on an iPhone: the library, a book full screen, back to the canvas', async ({ page }) => {
  await openWithGym(page);
  await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
  await noSidewaysScroll(page, 'start');
  // the canvas toolbar takes two rows, not five
  expect((await page.locator('.cv-toolbar').boundingBox())!.height).toBeLessThan(100);
  for (const b of await page.locator('.cv-toolbar > button, .cv-toolbar .cv-group button').all()) await onScreen(b, `toolbar: ${await b.getAttribute('aria-label')}`);
  await shot(page, 'canvas');

  await page.getByRole('button', { name: 'Library', exact: true }).tap();
  await expect(page.getByTestId('library')).toBeVisible();
  await page.getByTestId('import-input').setInputFiles({ name: 'paper.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makePaperPdf()) });
  await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
  // one pane at a time: the book fills the screen
  await expect(page.locator('.pane-canvas')).toBeHidden();
  await onScreen(page.locator('.pdfv-page[data-page="1"]'), 'PDF page');
  await noSidewaysScroll(page, 'book');
  for (const b of await pane(page).locator('button:visible').all()) {
    const box = await b.boundingBox();
    if (box && box.y < 200) await onScreen(b, `book toolbar: ${await b.getAttribute('aria-label')}`);
  }
  await shot(page, 'book');
  await page.getByRole('button', { name: 'Show canvas' }).tap();
  await expect(page.locator('.pane-canvas .cv-view')).toBeVisible();
  await page.getByRole('button', { name: 'Show side pane' }).tap();
  await expect(page.locator('.pdfv-page[data-page="1"]')).toBeVisible();
  expect((await libraryItems(page)).books).toHaveLength(1);
});

test('quick capture on an iPhone: New from clipboard and from link, lasso into the carry tray', async ({ page }) => {
  await openWithGym(page);
  await setHelper(page);
  await page.evaluate(async () => navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['# Spectral theorem\n\nEvery symmetric $A$ is $Q\\Lambda Q^T$.'], { type: 'text/plain' }) })]));
  await page.getByRole('button', { name: 'New from clipboard' }).tap();
  await expect(pane(page).getByTestId('clipping-pane')).toBeVisible();
  await expect(pane(page).locator('.clip-article .katex').first()).toBeVisible();
  await noSidewaysScroll(page, 'clipping');
  await onScreen(pane(page).locator('.clip-article h1'), 'clipping heading');
  await shot(page, 'clipping');

  // lasso part of it: on a phone the capture waits in the carry tray (P2, S4)
  await pane(page).getByRole('button', { name: 'Lasso', exact: true }).tap();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const preview = page.getByTestId('capture-preview');
  await expect(preview).toBeVisible();
  await onScreen(preview, 'capture preview');
  await preview.getByRole('button', { name: 'Send to canvas' }).tap();
  const tray = page.getByRole('complementary', { name: /Carry tray/ });
  await expect(tray).toBeVisible();
  await onScreen(tray, 'carry tray');
  await onScreen(tray.locator('.cv-carry-card').first(), 'carried capture');
  await shot(page, 'tray');

  await page.getByRole('button', { name: 'New from link' }).tap();
  const dialog = page.getByRole('dialog', { name: 'New from link' });
  await onScreen(dialog, 'New from link dialog');
  await dialog.getByRole('textbox', { name: 'Web address' }).fill('https://blog.example/posts/spaced-repetition');
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(pane(page).locator('.clip-article h2')).toHaveText('How to use it');
  await noSidewaysScroll(page, 'article');
  await pane(page).getByRole('radio', { name: 'Original' }).tap();
  await onScreen(page.locator('[data-testid="snapshot-frame"]'), 'Original view');
  await shot(page, 'article');

  // settings (through the sync status on a phone)
  await page.getByTestId('sync-status').tap();
  await onScreen(page.getByRole('dialog', { name: 'Settings' }), 'settings dialog');
});

test('to-dos and the revision list on an iPhone, full screen', async ({ page }) => {
  await openWithGym(page);
  await page.getByRole('button', { name: 'To-dos', exact: true }).tap();
  const add = pane(page).getByRole('textbox', { name: 'Add a to-do' });
  await onScreen(add, 'Add a to-do');
  await add.tap();
  await add.fill('Revise 5B');
  await add.press('Enter');
  await expect(pane(page).getByRole('list', { name: 'Checklist' }).getByRole('textbox', { name: 'To-do' })).toHaveValue('Revise 5B');
  await onScreen(pane(page).getByRole('checkbox', { name: 'Done: Revise 5B' }), 'to-do checkbox');
  await noSidewaysScroll(page, 'to-dos');
  await shot(page, 'todos');

  await page.getByRole('button', { name: 'Revision list' }).tap();
  const entry = pane(page).locator('.gym-rev-entry').first();
  await expect(entry).toBeVisible();
  await onScreen(entry, 'revision entry');
  await noSidewaysScroll(page, 'revision list');
  await shot(page, 'revision');
  await entry.tap();
  await expect(pane(page).locator('.gym-md h1')).toBeVisible();
  await noSidewaysScroll(page, 'gym file');
  await onScreen(pane(page).locator('.gym-md h1'), 'gym heading');
  await shot(page, 'gym');
});
