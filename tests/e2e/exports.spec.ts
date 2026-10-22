/**
 * Exports open correctly: a selection exported as PNG and SVG (C15), copied and dragged out as
 * PNG plus Markdown (S11), and a PDF exported with its annotations flattened in (L4). The
 * files are decoded (pngjs), parsed and rendered (the browser's SVG parser) and loaded
 * (pdf-lib), not only recognised by their first bytes.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, type PDFPage } from 'pdf-lib';
import { PNG } from 'pngjs';
import { makePaperPdf } from '../../src/test/fixtures';
import { openCanvas, seed, strokePts, withCanvas } from './canvas-helpers';
import { annotations, importFile, libraryItems, openApp, selectText } from './libraryHelpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' });

/** Pixels that are not transparent and not white. */
function inked(png: PNG): number {
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 3] > 40 && png.data[i] + png.data[i + 1] + png.data[i + 2] < 600) n++;
  return n;
}

async function scene(page: Page) {
  const ids = await seed(page, [
    { kind: 'stroke', pts: strokePts(0, 100, 200, 100) },
    { kind: 'stroke', pts: strokePts(0, 160, 200, 200) },
    { kind: 'text', x: 0, y: 240, w: 220, content: 'Eigen **values** and $\\lambda$' },
  ]);
  await withCanvas(page, `(h) => h.engine.select(${JSON.stringify(ids)})`);
  await expect(bar(page)).toContainText('3 items');
  return ids;
}

async function exportAs(page: Page, kind: 'PNG' | 'SVG'): Promise<Buffer> {
  await bar(page).getByRole('button', { name: 'More actions' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: `Export ${kind}` }).click()]);
  return readFileSync((await (dl as Download).path())!);
}

test('C15: a selection exports as a PNG that decodes and an SVG that parses and renders', async ({ page }) => {
  await openCanvas(page);
  await scene(page);
  const png = PNG.sync.read(await exportAs(page, 'PNG'));
  // the selection is 220 × 160 units; the PNG is drawn at twice the 100% resolution or more
  expect(png.width).toBeGreaterThanOrEqual(400);
  expect(png.height).toBeGreaterThanOrEqual(280);
  expect(inked(png)).toBeGreaterThan(500);

  const svg = (await exportAs(page, 'SVG')).toString('utf8');
  const parsed = await page.evaluate(async (text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const err = doc.querySelector('parsererror')?.textContent ?? null;
    const root = doc.documentElement;
    // and it renders: draw it as an image and count painted pixels
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 40) painted++;
    URL.revokeObjectURL(url);
    return { err, tag: root.tagName, viewBox: root.getAttribute('viewBox'), paths: doc.querySelectorAll('path').length, text: root.textContent, width: img.naturalWidth, painted };
  }, svg);
  expect(parsed.err).toBeNull();
  expect(parsed.tag).toBe('svg');
  expect(parsed.viewBox).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
  expect(parsed.paths).toBeGreaterThanOrEqual(2);
  expect(parsed.text).toContain('Eigen');
  expect(parsed.width).toBeGreaterThan(100);
  expect(parsed.painted).toBeGreaterThan(200);
});

test('S11: a selection copies and drags out as PNG plus Markdown', async ({ page }) => {
  await openCanvas(page);
  await scene(page);
  await bar(page).getByRole('button', { name: 'Copy (⌘C)' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Copied as image and text' })).toBeVisible();
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const out: Record<string, string> = {};
    for (const t of item.types) {
      const b = await item.getType(t);
      out[t] = t === 'image/png' ? btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer()))) : await b.text();
    }
    return out;
  });
  expect(Object.keys(clip).sort()).toEqual(['image/png', 'text/html', 'text/plain']);
  expect(clip['text/plain']).toContain('Eigen **values** and $\\lambda$');
  expect(clip['text/html']).toContain('data-slate=');
  const png = PNG.sync.read(Buffer.from(clip['image/png'], 'base64'));
  expect(png.width).toBeGreaterThan(100);
  expect(inked(png)).toBeGreaterThan(500);

  // dragging the grip out carries the same Markdown and the PNG (as a file for the target app)
  await page.waitForTimeout(300); // the drag image is rendered ahead of the drag
  const drag = await page.evaluate(() => {
    const grip = document.querySelector('.cv-grip')!;
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    return { text: dt.getData('text/plain'), html: dt.getData('text/html'), download: dt.getData('DownloadURL') };
  });
  expect(drag.text).toContain('Eigen **values**');
  expect(drag.html).toContain('data-slate=');
  expect(drag.download).toMatch(/^image\/png:main-selection\.png:data:image\/png;base64,/);
  const dragged = PNG.sync.read(Buffer.from(drag.download.split('base64,')[1], 'base64'));
  expect(inked(dragged)).toBeGreaterThan(500);
});

/** Decoded content of a page (all its content streams). */
function pageContent(doc: PDFDocument, page: PDFPage): { streams: number; text: string } {
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  let text = '';
  for (const r of refs) {
    const s = doc.context.lookup(r as PDFRef);
    if (!(s instanceof PDFRawStream)) continue;
    const flate = String(s.dict.get(PDFName.of('Filter')) ?? '').includes('FlateDecode');
    text += Buffer.from(flate ? inflateSync(s.contents) : s.contents).toString('latin1') + '\n';
  }
  return { streams: refs.length, text };
}

test('L4: a PDF exports with its highlight, ink and note drawn in; the copy opens and the book file is unchanged', async ({ page }) => {
  await openApp(page);
  const original = await makePaperPdf();
  await importFile(page, 'paper.pdf', original, 'application/pdf');
  await expect(page.locator('.pdfv-page[data-page="1"] .textLayer span').first()).toBeAttached();
  const id = (await libraryItems(page)).books[0].id;
  await selectText(page, '.pdfv-page[data-page="1"] .textLayer', 'Local-first software');
  await page.getByRole('dialog', { name: 'Selection actions' }).getByRole('button', { name: 'Highlight green' }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const box = (await page.locator('.pdfv-page[data-page="1"]').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 500);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 100 + i * 15, box.y + 500 + (i % 2) * 10);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Margin note' }).click();
  await page.mouse.click(box.x + 400, box.y + 300);
  await page.getByRole('textbox', { name: 'Note text' }).fill('Compare gutters');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await annotations(page, id)).map((a) => a.kind).sort()).toEqual(['highlight', 'ink', 'note']);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export a copy with annotations' }).click()]);
  const exported = await PDFDocument.load(readFileSync((await dl.path())!));
  const source = await PDFDocument.load(original);
  expect(exported.getPageCount()).toBe(source.getPageCount());
  expect(exported.getTitle()).toBe(source.getTitle());
  const before = pageContent(source, source.getPage(0));
  const after = pageContent(exported, exported.getPage(0));
  // the original page content is kept, and drawing was added on top of it
  expect(after.streams).toBeGreaterThan(before.streams);
  expect(after.text).toContain(before.text.trim().slice(0, 200));
  const count = (t: string, op: RegExp) => (t.match(op) ?? []).length;
  expect(count(after.text, /\s[fB]\n/g)).toBeGreaterThanOrEqual(count(before.text, /\s[fB]\n/g) + 4); // filled: highlight, ink, note marker and box
  expect(count(after.text, /\s[cvl]\n/g)).toBeGreaterThan(count(before.text, /\s[cvl]\n/g) + 10); // the ink outline
  const note = Buffer.from('Compare gutters', 'latin1').toString('hex').toUpperCase();
  expect(after.text).toContain(note); // the note's text
  expect(before.text).not.toContain(note);
  // other pages are untouched
  expect(pageContent(exported, exported.getPage(1)).streams).toBe(pageContent(source, source.getPage(1)).streams);

  // the book file in local storage is still the imported one (L4: never modified)
  const stored = await page.evaluate(async (bookId) => {
    const s = (window as unknown as { __slate: { library: { book(id: string): { fileHash: string } }; assets: { get(h: string): Promise<Blob | undefined> } } }).__slate;
    const b = await s.assets.get(s.library.book(bookId).fileHash);
    return b ? [...new Uint8Array(await b.arrayBuffer())].length : 0;
  }, id);
  expect(stored).toBe(original.length);
});
