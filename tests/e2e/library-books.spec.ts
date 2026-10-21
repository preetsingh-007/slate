import { expect, test } from '@playwright/test';
import { EPUB, makeBookPdf, makeEpub, makePaperPdf, PAPER } from '../../src/test/fixtures';
import { annotations, carry, fakeCanvas, importFile, lassoRect, libraryItems, openApp, openLibrary, seedClip, selectText } from './libraryHelpers';

test.describe('books', () => {
  test('L1 L2: import a PDF, read title and pages, TOC, search, zoom, reading position', async ({ page }) => {
    await openApp(page);
    const t0 = Date.now();
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    // NFR: first page in under 2 s (generous on CI, includes import)
    expect(Date.now() - t0).toBeLessThan(6000);
    await expect(page.getByRole('tab', { name: PAPER.title })).toBeVisible();
    await expect(page.getByTestId('pdf-page')).toHaveText('1 / 3');
    const { books } = await libraryItems(page);
    expect(books[0]).toMatchObject({ title: PAPER.title, slug: 'reading-order-reconstruction-for-study-notebooks' });

    // table of contents
    await page.getByRole('button', { name: 'Table of contents' }).click();
    await page.getByRole('navigation', { name: 'Contents' }).getByRole('button', { name: /Conclusion/ }).click();
    await expect(page.getByTestId('pdf-page')).toHaveText('3 / 3');

    // search
    await page.getByRole('button', { name: 'Search in book' }).click();
    await page.getByRole('searchbox', { name: 'Search text' }).fill('page 2 of the paper');
    await page.getByRole('searchbox', { name: 'Search text' }).press('Enter');
    await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /p\. 2/ }).click();
    await expect(page.locator('.pdfv-page[data-page="2"] .textLayer span.search-hit').first()).toBeVisible();

    // zoom
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByRole('button', { name: 'Fit width' })).toHaveText('115%');
    await page.getByRole('button', { name: 'Fit width' }).click();

    // reading position is saved in synced settings
    await page.getByRole('button', { name: 'Search in book' }).click();
    await expect(page.locator('.viewer-drawer')).toHaveCount(0);
    await expect
      .poll(async () => {
        // the pages grow back to full width once the drawer is closed: scroll to the end again
        await page.locator('.pdfv-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
        await page.waitForTimeout(300);
        return page.evaluate((id) => (window as never as { __slate: { settings: { get(): { readingPositions: Record<string, { locator: { page: number } }> } } } }).__slate.settings.get().readingPositions[id]?.locator.page, books[0].id);
      })
      .toBe(3);
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate);
    await openLibrary(page);
    await page.getByRole('button', { name: `Open ${PAPER.title}` }).click();
    await expect(page.getByTestId('pdf-page')).toHaveText('3 / 3');
  });

  test('L1 S10: PDF and EPUB files dropped on the canvas or the library are imported', async ({ page }) => {
    await openApp(page);
    const pdf = Array.from(await makePaperPdf());
    const imported = await page.evaluate(async (bytes) => {
      const f = new File([new Uint8Array(bytes)], 'dropped.pdf', { type: 'application/pdf' });
      return (window as never as { __slateUi: { registries: { importFiles(f: File[]): Promise<boolean> } } }).__slateUi.registries.importFiles([f]);
    }, pdf);
    expect(imported).toBe(true);
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    await openLibrary(page);
    const epub = Array.from(await makeEpub());
    await page.evaluate(async (bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], 'book.epub', { type: 'application/epub+zip' }));
      const target = document.querySelector('[data-testid="library"]')!;
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, epub);
    await expect(page.getByTestId('epub-viewer')).toBeVisible();
    expect((await libraryItems(page)).books.map((b) => b.title).sort()).toEqual([PAPER.title, EPUB.title].sort());
  });

  test('L4: highlight, ink, margin note and export with annotations flattened', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    await expect(page.locator('.pdfv-page[data-page="1"] .textLayer span').first()).toBeAttached();
    const id = (await libraryItems(page)).books[0].id;

    // highlight from a selection, in one of 5 colours
    await selectText(page, '.pdfv-page[data-page="1"] .textLayer', 'Local-first software');
    const menu = page.getByRole('dialog', { name: 'Selection actions' });
    await expect(menu.getByRole('button', { name: /Highlight/ })).toHaveCount(5);
    await menu.getByRole('button', { name: 'Highlight green' }).click();
    await expect(page.locator('.pdfv-page[data-page="1"] .pdfv-hl').first()).toBeVisible();
    expect((await annotations(page, id))[0]).toMatchObject({ kind: 'highlight', color: '#5cc27e', text: 'Local-first software', locator: { type: 'pdf', page: 1 } });

    // freehand ink with the pen
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    const box = (await page.locator('.pdfv-page[data-page="1"]').boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 500);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 100 + i * 15, box.y + 500 + (i % 2) * 10);
    await page.mouse.up();
    await expect.poll(async () => (await annotations(page, id)).filter((a) => a.kind === 'ink').length).toBe(1);
    const ink = (await annotations(page, id)).find((a) => a.kind === 'ink')!;
    const pts = (ink.strokes as { pts: number[] }[])[0].pts;
    expect(pts.every((v) => v >= 0 && v <= 1.5)).toBe(true); // page-normalised

    // eraser removes it
    await page.getByRole('button', { name: 'Eraser' }).click();
    await page.mouse.move(box.x + 160, box.y + 505);
    await page.mouse.down();
    await page.mouse.move(box.x + 170, box.y + 505, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await annotations(page, id)).filter((a) => a.kind === 'ink').length).toBe(0);

    // margin note
    await page.getByRole('button', { name: 'Margin note' }).click();
    await page.mouse.click(box.x + 400, box.y + 300);
    await page.getByRole('textbox', { name: 'Note text' }).fill('Compare with the gutter detection in Axiom');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('pdf-note')).toHaveCount(1);

    // the file is never modified; the export is a flattened copy
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export a copy with annotations' }).click()]);
    expect(download.suggestedFilename()).toBe('reading-order-reconstruction-for-study-notebooks-annotated.pdf');
    const bytes = await (await download.createReadStream()).toArray();
    expect(Buffer.concat(bytes).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('L3 L5: EPUB chapters, TOC, font size, theme, search, anchored highlights and notes', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'book.epub', await makeEpub(), 'application/epub+zip');
    await expect(page.getByTestId('epub-viewer')).toBeVisible();
    await expect(page.locator('.epub-html h1').first()).toHaveText('Chapter 1. The Engine');
    const id = (await libraryItems(page)).books[0].id;

    await page.getByRole('button', { name: 'Table of contents' }).click();
    await page.getByRole('navigation', { name: 'Contents' }).getByRole('button', { name: '2.1 The Figure' }).click();
    await expect(page.locator('#epub1-sec2-1')).toBeInViewport();

    // highlight survives a font size change (anchored by quote)
    await selectText(page, '[data-chapter="0"] .epub-html', 'Analytical Engine weaves');
    await page.getByRole('dialog', { name: 'Selection actions' }).getByRole('button', { name: 'Highlight pink' }).click();
    await expect(page.locator('[data-chapter="0"] .hl-rect').first()).toBeVisible();
    /** distance between the highlight and the highlighted words, after any re-layout */
    const offBy = () =>
      page.evaluate(() => {
        const host = document.querySelector('[data-chapter="0"] .epub-html')!;
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = walker.nextNode())) {
          const i = (n.nodeValue ?? '').indexOf('Analytical');
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 10);
          const a = r.getBoundingClientRect();
          const b = document.querySelector('[data-chapter="0"] .hl-rect')!.getBoundingClientRect();
          return Math.abs(a.top - b.top) + Math.abs(a.left - b.left);
        }
        return Infinity;
      });
    expect(await offBy()).toBeLessThan(3);
    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.getByRole('button', { name: 'Larger text' }).click();
    await expect(page.locator('.epub-content')).toHaveCSS('font-size', '20px');
    await expect.poll(offBy).toBeLessThan(3);
    const hl = (await annotations(page, id))[0];
    expect(hl).toMatchObject({ kind: 'highlight', locator: { type: 'epub', chapter: 'OEBPS/text/ch1.xhtml', quote: { exact: 'Analytical Engine weaves' } } });

    // note on a selection
    await selectText(page, '[data-chapter="0"] .epub-html', 'algebraical patterns');
    await page.getByRole('dialog', { name: 'Selection actions' }).getByRole('button', { name: 'Add a note' }).click();
    await page.getByRole('textbox', { name: 'Note text' }).fill('Lovelace’s famous line');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('margin-note')).toHaveCount(1);

    // dark reading theme
    await page.getByRole('button', { name: /Reading theme/ }).click();
    await page.getByRole('button', { name: /Reading theme/ }).click();
    await expect(page.locator('.epub-scroll')).toHaveClass(/epub-theme-dark/);

    // search
    await page.getByRole('button', { name: 'Search in book' }).click();
    await page.getByRole('searchbox', { name: 'Search text' }).fill('bernoulli numbers');
    await page.getByRole('searchbox', { name: 'Search text' }).press('Enter');
    await page.getByRole('list', { name: 'Search results' }).getByRole('button').first().click();
    await expect(page.locator('[data-chapter="1"] .lib-flash').first()).toBeVisible();

    // reading position
    await expect
      .poll(() => page.evaluate((i) => (window as never as { __slate: { settings: { get(): { readingPositions: Record<string, { locator: { type: string; chapter: string } }> } } } }).__slate.settings.get().readingPositions[i]?.locator, id))
      .toMatchObject({ type: 'epub', chapter: 'OEBPS/text/ch2.xhtml' });
  });

  test('L6: a book whose file is missing offers to import it and matches it by hash', async ({ page }) => {
    await openApp(page);
    const bytes = await makePaperPdf();
    // metadata only, as synced from another device
    const hash = await page.evaluate(async (b) => {
      const buf = new Uint8Array(b);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hex = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
      await (window as never as { __slate: { library: { putBook(m: object): Promise<void> } } }).__slate.library.putBook({
        id: 'remote1', slug: 'paper', format: 'pdf', title: 'Paper from my iPad', authors: [], citation: 'Paper from my iPad', fileHash: hex, fileName: 'paper.pdf', size: buf.length, added: 1, topics: [],
      });
      return hex;
    }, Array.from(bytes));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await openLibrary(page);
    await expect(page.getByText('File not on this device')).toBeVisible();
    await page.getByRole('button', { name: 'Open Paper from my iPad' }).click();
    await expect(page.getByTestId('missing-file')).toContainText('Import the file to read');
    await page.getByTestId('missing-file-input').setInputFiles({ name: 'other.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makeBookPdf(3)) });
    await expect(page.getByText(/different file/)).toBeVisible();
    await page.getByTestId('missing-file-input').setInputFiles({ name: 'renamed.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
  });

  test('L12: shelves in grid and list, full-text search, sort and topic filter', async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    await importFile(page, 'book.pdf', await makeBookPdf(60, { title: 'Animals of Australia' }), 'application/pdf');
    await openLibrary(page);
    const items = page.getByTestId('library-item');
    await expect(items).toHaveCount(2);
    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.locator('.lib-items.list')).toBeVisible();
    await page.getByRole('combobox', { name: 'Sort' }).selectOption('title');
    await expect(items.first()).toContainText('Animals of Australia');
    // the text index is built in the background
    await expect
      .poll(async () => {
        await page.getByRole('searchbox', { name: 'Search books' }).fill('');
        await page.getByRole('searchbox', { name: 'Search books' }).fill('quokka');
        await page.waitForTimeout(400);
        return items.count();
      }, { timeout: 20_000 })
      .toBe(1);
    await expect(items.first()).toContainText('p. 60');
    await page.getByRole('searchbox', { name: 'Search books' }).fill('');
    // tag a topic (plain-text fallback) and filter by it
    await items.filter({ hasText: 'Animals' }).getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: /Edit details/ }).click();
    await page.getByRole('textbox', { name: 'Add topic (gym path)' }).fill('math/probability/sampling');
    await page.getByRole('textbox', { name: 'Add topic (gym path)' }).press('Enter');
    await page.getByRole('textbox', { name: 'Edition' }).fill('2');
    await expect(page.locator('output.citation')).toContainText('2nd edition');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('combobox', { name: 'Topic' }).selectOption('math/probability/sampling');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Animals of Australia');
  });

  test('L13: deleting a book warns with the clips that point to it; the clips stay', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    const { books } = await libraryItems(page);
    await seedClip(page, 'clipA', { type: 'book', id: books[0].id, title: PAPER.title, locator: { type: 'pdf', page: 1, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, quote: 'x' }, capturedAt: 1, contentHash: books[0].fileHash }, 'Students read many papers');
    await openLibrary(page);
    await page.getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    await expect(page.getByTestId('delete-warning')).toContainText('1 clip on your canvases points to it');
    await expect(page.getByTestId('delete-warning')).toContainText('Students read many papers');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await libraryItems(page)).books).toHaveLength(0);
    const left = await page.evaluate(() => (window as never as { __slate: { canvases: { findClipsOf(id: string): Promise<unknown[]> } } }).__slate.canvases.findClipsOf('x'));
    expect(left).toEqual([]);
    const still = await page.evaluate((id) => (window as never as { __slate: { canvases: { findClipsOf(id: string): Promise<unknown[]> } } }).__slate.canvases.findClipsOf(id).then((r) => r.length), books[0].id);
    expect(still).toBe(1);
  });
});

test.describe('lasso and source links for books', () => {
  test('S1 S2 S3 S5 S6: lasso a PDF region, send it to the canvas, and come back through the source opener', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    const id = (await libraryItems(page)).books[0].id;
    await page.getByRole('button', { name: 'Lasso' }).click();
    const box = (await page.locator('.pdfv-page[data-page="1"]').boundingBox())!;
    // the right column ("2 Method") of the two-column page
    const s = box.width / 612;
    await lassoRect(page, { x: box.x + 310 * s, y: box.y + 155 * s, width: 280 * s, height: 120 * s });
    const preview = page.getByTestId('capture-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('img')).toBeVisible();
    await expect(preview).toContainText('We cluster text runs into columns');
    await preview.getByRole('button', { name: 'Send to canvas' }).click();
    // the canvas is a placeholder in this branch: captures wait in the carry tray (S4)
    const c = await carry(page);
    expect(c).toHaveLength(1);
    expect(c[0].hasImage).toBe(true);
    expect(c[0].text).toMatch(/^## 2 Method\n\nWe cluster text runs into columns/);
    expect(c[0].source).toMatchObject({ type: 'book', id, locator: { type: 'pdf', page: 1, quote: expect.stringContaining('We cluster text runs') } });
    const region = (c[0].source as { locator: { region: { x: number; y: number; w: number; h: number } } }).locator.region;
    expect(region.x).toBeGreaterThan(0.45);
    expect(region.w).toBeLessThan(0.55);

    // S6: the badge opens the source at the page and flashes the region
    await page.locator('.pdfv-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.evaluate((src) => (window as never as { __slateUi: { registries: { openSource(l: unknown): Promise<boolean> } } }).__slateUi.registries.openSource(src), c[0].source);
    await expect(page.locator('.pdfv-page[data-page="1"] [data-testid="flash"]')).toBeVisible();
    await expect(page.getByTestId('pdf-page')).toHaveText('1 / 3');
    await expect(page.locator('.pdfv-page[data-page="1"] [data-testid="flash"]')).toHaveCount(0, { timeout: 4000 });
  });

  test('S3: dragging the preview onto the canvas drops the capture there', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    await fakeCanvas(page);
    await page.getByRole('button', { name: 'Lasso' }).click();
    const box = (await page.locator('.pdfv-page[data-page="1"]').boundingBox())!;
    await lassoRect(page, { x: box.x + 40, y: box.y + 40, width: 300, height: 80 });
    const head = page.getByTestId('capture-preview').locator('.cap-head');
    const hb = (await head.boundingBox())!;
    const canvas = (await page.locator('.pane-canvas').boundingBox())!;
    await page.mouse.move(hb.x + 30, hb.y + 10);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 200, canvas.y + 200, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByTestId('capture-preview')).toHaveCount(0);
    const inserted = await page.evaluate(() => (window as never as { __inserted: { captures: { text: string }[]; at: { x: number; y: number } }[] }).__inserted);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].captures[0].text).toContain('Reading Order Reconstruction');
    expect(inserted[0].at.x).toBeGreaterThan(100);
  });

  test('S1 S2 S5 S6: lasso an EPUB passage as Markdown and return to it by quote', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'book.epub', await makeEpub(), 'application/epub+zip');
    await expect(page.locator('[data-chapter="0"] .epub-html table')).toBeVisible();
    const id = (await libraryItems(page)).books[0].id;
    await page.getByRole('button', { name: 'Lasso' }).click();
    const table = (await page.locator('[data-chapter="0"] .epub-html table').boundingBox())!;
    await lassoRect(page, { x: table.x - 10, y: table.y - 4, width: table.width + 20, height: table.height + 8 });
    await expect(page.getByTestId('capture-preview')).toBeVisible();
    await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
    const c = await carry(page);
    expect(c[0].text).toContain('| Operation | Cards |');
    expect(c[0].source).toMatchObject({ type: 'book', id, locator: { type: 'epub', chapter: 'OEBPS/text/ch1.xhtml', quote: { exact: expect.stringContaining('Operation') } } });
    await page.locator('.epub-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.evaluate((src) => (window as never as { __slateUi: { registries: { openSource(l: unknown): Promise<boolean> } } }).__slateUi.registries.openSource(src), c[0].source);
    await expect(page.locator('[data-chapter="0"] [data-testid="flash"]').first()).toBeInViewport();
  });

  test('S6: when the quoted text is not found exactly, the closest match is shown with a notice', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'book.epub', await makeEpub(), 'application/epub+zip');
    await expect(page.getByTestId('epub-viewer')).toBeVisible();
    const id = (await libraryItems(page)).books[0].id;
    await page.evaluate(
      (bookId) =>
        (window as never as { __slateUi: { registries: { openSource(l: unknown): Promise<boolean> } } }).__slateUi.registries.openSource({
          type: 'book', id: bookId, title: 'x', capturedAt: 1, contentHash: '',
          locator: { type: 'epub', chapter: 'OEBPS/text/ch2.xhtml', quote: { exact: 'A unique sentense about the bernouli numbers', prefix: '', suffix: '' }, position: 0.5 },
        }),
      id,
    );
    await expect(page.getByText('showing the closest match')).toBeVisible();
    await expect(page.locator('[data-chapter="1"] [data-testid="flash"]').first()).toBeVisible();
  });

  test('S6 L6: a source link to a book missing on this device offers to import it', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() =>
      (window as never as { __slate: { library: { putBook(m: object): Promise<void> } } }).__slate.library.putBook({ id: 'gone', slug: 'gone', format: 'pdf', title: 'Elsewhere', authors: [], citation: '', fileHash: 'f'.repeat(64), fileName: 'e.pdf', size: 1, added: 1 }),
    );
    await page.evaluate(() =>
      (window as never as { __slateUi: { registries: { openSource(l: unknown): Promise<boolean> } } }).__slateUi.registries.openSource({ type: 'book', id: 'gone', title: 'Elsewhere', capturedAt: 1, contentHash: '', locator: { type: 'pdf', page: 1, region: { x: 0, y: 0, w: 1, h: 1 }, quote: '' } }),
    );
    await expect(page.getByTestId('missing-file')).toContainText('Import the file to read');
  });

  test('S7: clipped regions are marked in the margin; a mark lists its clips and reveals them', async ({ page }) => {
    await openApp(page);
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    const b = (await libraryItems(page)).books[0];
    await fakeCanvas(page);
    await seedClip(page, 'clipM', { type: 'book', id: b.id, title: PAPER.title, locator: { type: 'pdf', page: 1, region: { x: 0.1, y: 0.3, w: 0.4, h: 0.1 }, quote: 'Students' }, capturedAt: 1, contentHash: b.fileHash }, 'Students read many papers');
    const mark = page.locator('.pdfv-page[data-page="1"]').getByTestId('clip-mark');
    await expect(mark).toBeVisible({ timeout: 5000 });
    await mark.click();
    await page.getByRole('menuitem', { name: /Students read many papers/ }).click();
    await expect.poll(() => page.evaluate(() => (window as never as { __revealed: string[] }).__revealed)).toEqual(['clipM']);
  });
});

test('L2 @touch: a PDF opens and scrolls on a tablet', async ({ page }) => {
  await openApp(page);
  await importFile(page, 'book.pdf', await makeBookPdf(40), 'application/pdf');
  await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
  await page.locator('.pdfv-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
  await expect(page.getByTestId('pdf-page')).toHaveText(/^2\d \/ 40$/);
  // virtualised: only pages near the viewport are in the DOM
  expect(await page.locator('.pdfv-page').count()).toBeLessThan(12);
});

test('L2 NFR: an 800-page PDF shows its first page in under 2 s and stays light while scrolling', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await importFile(page, 'big.pdf', await makeBookPdf(800), 'application/pdf');
  await expect(page.getByTestId('pdf-page')).toHaveText('1 / 800');
  // reopen from the library: the book is parsed again from local storage
  await page.getByRole('button', { name: /^Close Foundations/ }).click();
  await openLibrary(page);
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Open Foundations of Study Systems' }).click();
  await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
  const t1 = await page.evaluate(() => performance.now());
  expect(t1 - t0).toBeLessThan(2000);
  // jump through the book: only pages near the viewport exist
  await page.getByRole('button', { name: 'Table of contents' }).click();
  for (const ch of ['Chapter 8', 'Chapter 16', 'Chapter 2']) {
    await page.getByRole('navigation', { name: 'Contents' }).getByRole('button', { name: new RegExp(`^${ch}\\b`) }).click();
    await expect(page.locator('.pdfv-page canvas.ready').first()).toBeVisible();
    expect(await page.locator('.pdfv-page').count()).toBeLessThan(12);
  }
  await expect(page.getByTestId('pdf-page')).toHaveText(/^5\d \/ 800$/);
});

test('L2 P1: switching side-pane tabs keeps the reading place', async ({ page }) => {
  await openApp(page);
  await importFile(page, 'book.pdf', await makeBookPdf(40), 'application/pdf');
  await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
  await page.locator('.pdfv-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
  await expect(page.getByTestId('pdf-page')).toHaveText(/^2\d \/ 40$/);
  const before = await page.getByTestId('pdf-page').textContent();
  await openLibrary(page);
  await page.getByRole('tab', { name: /Foundations of Study Systems/ }).click();
  await expect(page.getByTestId('pdf-page')).toHaveText(before!);
  await expect(page.locator('.pdfv-page canvas.ready').first()).toBeVisible();
});
