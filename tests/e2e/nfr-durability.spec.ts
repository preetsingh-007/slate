/**
 * Durability NFR: a change is on disk within 1 s; a crash or closed tab loses nothing drawn or
 * typed, including a stroke whose pen has not lifted and text still being typed when the tab
 * closes.
 *
 * A closing page may get no time to finish IndexedDB writes (CI's headless Chromium never does;
 * iPad Safari suspends or kills a PWA): before closing, these tests make every later IndexedDB
 * write hang, so what comes back can only come from the drafts the UI keeps in localStorage
 * while work is in progress (ui/common/drafts.ts), recovered on the next start.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { makePaperPdf } from '../../src/test/fixtures';
import { objects, seed, surface, withCanvas } from './canvas-helpers';
import { annotations, importFile, libraryItems, openApp } from './libraryHelpers';
import { pane } from './gym-helpers';

const month = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Bytes of a document's update log in IndexedDB (what survives a crash). */
const storedBytes = (page: Page, docId: string) =>
  page.evaluate(async (id) => {
    const s = (window as unknown as { __slate: { db: { getUpdates(id: string): Promise<{ data: Uint8Array }[]> } } }).__slate;
    return (await s.db.getUpdates(id)).reduce((n, r) => n + r.data.length, 0);
  }, docId);

/** Drafts of work in progress left in localStorage (cleared once recovered work is on disk). */
const draftKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('slate-draft:')));

/**
 * From now on nothing more reaches IndexedDB in this page: document writes and new connections
 * hang, as at a close that leaves the page no time. Work already committed is written first.
 */
async function loseWritesFromNow(page: Page) {
  await page.evaluate(async () => {
    const s = (window as unknown as { __slate: { docs: { flush(): Promise<unknown> }; db: { putUpdate(id: string, data: Uint8Array): Promise<void> } } }).__slate;
    await s.docs.flush();
    s.db.putUpdate = () => new Promise<void>(() => {});
    indexedDB.open = () => new EventTarget() as IDBOpenDBRequest;
  });
}

/**
 * Closes the tab the way a person does (pagehide runs, nothing else) after its last IndexedDB
 * writes are made to hang, and opens a fresh one.
 */
async function closeAndReopen(page: Page, context: BrowserContext): Promise<Page> {
  await loseWritesFromNow(page);
  await page.close();
  // a person reopens the app after a moment; reopening within milliseconds can read the
  // database before the closed page's last transaction has committed
  await new Promise((r) => setTimeout(r, 1000));
  const next = await context.newPage();
  await openApp(next);
  await next.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
  return next;
}

test.describe('durability (NFR)', () => {
  test('a stroke is on disk within 1 s of the pen lifting', async ({ page }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    const doc = `seg:main:${month()}`;
    const before = await storedBytes(page, doc);
    await page.getByRole('radio', { name: 'Pen (P)' }).click();
    const b = await surface(page);
    await page.mouse.move(b.x + 100, b.y + 200);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 100 + i * 12, b.y + 200 + (i % 2) * 8);
    await page.mouse.up();
    const t0 = Date.now();
    await expect.poll(() => storedBytes(page, doc), { intervals: [20] }).toBeGreaterThan(before);
    const ms = Date.now() - t0;
    console.log(`[nfr] durability: stroke on disk ${ms} ms after pen-up`);
    expect(ms).toBeLessThan(1000);
  });

  test('closing the tab mid-stroke and mid-sentence loses nothing on the canvas', async ({ page, context }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    const [box] = await seed(page, [{ kind: 'text', x: 0, y: 400, w: 300, content: 'Lecture' }]);
    // a text box being typed in
    await withCanvas(page, `(h) => h.engine.select(['${box}'])`);
    await page.locator('.cv-root').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: /Text box/ })).toBeFocused();
    await page.keyboard.type(' 5: eigenvalues');
    // and a stroke whose pen is still down
    await page.getByRole('radio', { name: 'Pen (P)' }).click();
    const b = await surface(page);
    await page.mouse.move(b.x + 100, b.y + 150);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 100 + i * 10, b.y + 150 + (i % 2) * 8);
    const next = await closeAndReopen(page, context);
    const objs = await objects(next);
    expect(objs.find((o) => o.id === box)?.content).toBe('Lecture 5: eigenvalues');
    const strokes = objs.filter((o) => o.kind === 'stroke');
    expect(strokes).toHaveLength(1);
    expect(strokes[0].pts!.length / 3).toBeGreaterThanOrEqual(8);
    await expect.poll(() => draftKeys(next)).toEqual([]);
  });

  test('closing the tab keeps PDF ink being drawn, a margin note and a to-do being typed', async ({ page, context }) => {
    await openApp(page);
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    const id = (await libraryItems(page)).books[0].id;
    const box = (await page.locator('.pdfv-page[data-page="1"]').boundingBox())!;
    // a margin note being typed
    await page.getByRole('button', { name: 'Margin note' }).click();
    await page.mouse.click(box.x + 400, box.y + 300);
    await page.getByRole('textbox', { name: 'Note text' }).fill('Check the gutter rule');
    let next = await closeAndReopen(page, context);
    expect((await annotations(next, id)).find((a) => a.kind === 'note')?.text).toBe('Check the gutter rule');

    // ink with the pen still down
    // the book's tab comes back with the app (P3)
    await expect(next.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    // the book's annotations are open (the note shows) before drawing
    await expect(next.getByTestId('pdf-note')).toHaveCount(1);
    await next.getByRole('button', { name: 'Pen', exact: true }).click();
    await expect(next.locator('.pdfv-page[data-page="1"] [data-testid="ink-input"]')).toBeVisible();
    const box2 = (await next.locator('.pdfv-page[data-page="1"]').boundingBox())!;
    await next.mouse.move(box2.x + 100, box2.y + 500);
    await next.mouse.down();
    for (let i = 1; i <= 10; i++) await next.mouse.move(box2.x + 100 + i * 15, box2.y + 500 + (i % 2) * 10);
    next = await closeAndReopen(next, context);
    expect((await annotations(next, id)).filter((a) => a.kind === 'ink')).toHaveLength(1);

    // a to-do typed but not entered
    await next.getByRole('button', { name: 'To-dos', exact: true }).click();
    await pane(next).getByRole('textbox', { name: 'Add a to-do' }).fill('Buy chalk');
    const third = await closeAndReopen(next, context);
    const text = await third.evaluate(async () => {
      const d = await (window as unknown as { __slate: { docs: { open(id: string): Promise<{ getText(n: string): { toString(): string } }> } } }).__slate.docs.open('todo');
      return d.getText('checklist').toString();
    });
    expect(text).toBe('- [ ] Buy chalk\n');
    await expect.poll(() => draftKeys(third)).toEqual([]);
  });
});
