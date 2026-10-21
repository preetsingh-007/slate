import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { dragClient, drawMouse, objects, openCanvas, seed, strokePts, surface, toClient, wave, withCanvas } from './canvas-helpers';

function png(w: number, h: number): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = 80;
    p.data[i + 1] = 140;
    p.data[i + 2] = 200;
    p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}

async function insertImage(page: Page, buf: Buffer, name = 'board.png') {
  await page.getByRole('button', { name: 'Insert image' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Photo library/ }).click()]);
  await chooser.setFiles({ name, mimeType: 'image/png', buffer: buf });
  await expect.poll(async () => (await objects(page)).filter((o) => o.kind === 'image').length).toBe(1);
}

test.describe('images (C8, S9, S10)', () => {
  test('a large photo is downscaled to 2,560 px and strokes drawn on it move with it', async ({ page }) => {
    await openCanvas(page);
    await insertImage(page, png(3200, 1600));
    const [img] = await objects(page);
    const natural = await withCanvas<{ w: number; h: number }>(page, `(h) => h.ctl.get('${img.id}').natural`);
    expect(natural).toEqual({ w: 2560, h: 1280 });
    expect(await page.evaluate((hash) => (window as unknown as { __slate: { assets: { has(h: string): Promise<boolean> } } }).__slate.assets.has(hash), (await withCanvas<string>(page, `(h) => h.ctl.get('${img.id}').asset`)))).toBe(true);
    await expect(page.locator(`.cv-image[data-id="${img.id}"] img`)).toBeVisible();
    // draw on the image with the pen
    await page.keyboard.press('Escape');
    await page.getByRole('radio', { name: /^Pen/ }).click();
    const a = await toClient(page, img.x + img.w * 0.3, img.y + img.h * 0.5);
    const b = await surface(page);
    await drawMouse(page, wave(a[0] - b.x, a[1] - b.y, 80));
    let ink = (await objects(page)).find((o) => o.kind === 'stroke')!;
    expect(ink.attached).toBe(img.id);
    // move the image: the ink follows
    await page.getByRole('radio', { name: /^Lasso/ }).click();
    await withCanvas(page, `(h) => h.engine.select(['${img.id}'])`);
    const from = await toClient(page, img.x + img.w * 0.2, img.y + img.h * 0.3);
    await dragClient(page, from, [from[0] + 100, from[1] + 50]);
    const moved = (await objects(page)).find((o) => o.id === img.id)!;
    const dx = moved.x - img.x;
    expect(dx).toBeGreaterThan(50);
    const ink2 = (await objects(page)).find((o) => o.kind === 'stroke')!;
    expect(ink2.pts![0] - ink.pts![0]).toBeCloseTo(dx, 0);
    // deleting the image deletes the ink drawn on it
    await withCanvas(page, `(h) => h.engine.select(['${img.id}'])`);
    await page.keyboard.press('Delete');
    expect(await objects(page)).toHaveLength(0);
    await page.keyboard.press('Control+z');
    ink = (await objects(page)).find((o) => o.kind === 'stroke')!;
    expect(ink.attached).toBe(img.id);
  });

  test('a small image keeps its bytes; crop keeps the visible part in place', async ({ page }) => {
    await openCanvas(page);
    await insertImage(page, png(400, 200));
    const [img] = await objects(page);
    expect(await withCanvas(page, `(h) => h.ctl.get('${img.id}').natural`)).toEqual({ w: 400, h: 200 });
    await withCanvas(page, `(h) => h.engine.select(['${img.id}'])`);
    await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Crop' }).click();
    const se = page.locator('.cv-crop-rect .cv-h-se');
    const box = await se.boundingBox();
    await dragClient(page, [box!.x + 9, box!.y + 9], [box!.x + 9 - (img.w * 0.5 * (await withCanvas<number>(page, '(h) => h.engine.pxPerUnit'))), box!.y + 9]);
    await page.getByRole('button', { name: 'Done' }).click();
    const c = (await objects(page))[0];
    expect(c.crop).toMatchObject({ x: 0, y: 0, h: 1 });
    expect((c.crop as { w: number }).w).toBeCloseTo(0.5, 1);
    expect(c.x).toBeCloseTo(img.x, 0);
    expect(c.w).toBeCloseTo(img.w / 2, -1);
  });

  test('paste and drop: images, text as Markdown, links (S9, S10)', async ({ page }) => {
    await openCanvas(page);
    const data = png(64, 64).toString('base64');
    await page.locator('.cv-root').click({ position: { x: 5, y: 5 }, button: 'middle' });
    // paste an image
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, data);
    await expect.poll(async () => (await objects(page)).filter((o) => o.kind === 'image').length).toBe(1);
    // paste plain text and Markdown
    await page.evaluate(() => {
      const paste = (t: string) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', t);
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      };
      paste('5 * 3 = 15');
      paste('## Heading\n\n- item');
    });
    await expect.poll(async () => (await objects(page)).filter((o) => o.kind === 'text').length).toBe(2);
    const texts = (await objects(page)).filter((o) => o.kind === 'text').map((o) => o.content);
    expect(texts).toEqual(expect.arrayContaining(['5 \\* 3 = 15', '## Heading\n\n- item']));
    // drop a URL: with a link handler registered it goes there
    await page.evaluate(() => {
      const w = window as unknown as { __slateRegistries: { registerLinkHandler(f: (u: string) => void): void }; __links: string[] };
      w.__links = [];
      w.__slateRegistries.registerLinkHandler((u) => w.__links.push(u));
      const root = document.querySelector('.cv-root')!;
      const dt = new DataTransfer();
      dt.setData('text/uri-list', 'https://example.com/article');
      const r = root.getBoundingClientRect();
      root.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 300, clientY: r.top + 300 }));
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __links: string[] }).__links)).toEqual(['https://example.com/article']);
    // drop an image file at a point
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const root = document.querySelector('.cv-root')!;
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
      const r = root.getBoundingClientRect();
      root.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 400, clientY: r.top + 200 }));
    }, data);
    await expect.poll(async () => (await objects(page)).filter((o) => o.kind === 'image').length).toBe(2);
  });
});

test.describe('clips, source badges and the carry tray (C9, S3, S4, S8, L13)', () => {
  const capture = (id: string, text: string, withImage: boolean) => `({
    id: '${id}',
    text: ${JSON.stringify(text)},
    image: ${withImage ? `new Blob([Uint8Array.from(atob(window.__png), (c) => c.charCodeAt(0))], { type: 'image/png' })` : 'undefined'},
    imageSize: ${withImage ? '{ w: 400, h: 200 }' : 'undefined'},
    source: { type: 'book', id: 'b1', title: 'Axler', locator: { type: 'pdf', page: 12, region: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 }, quote: 'eigen' }, capturedAt: 0, contentHash: '' },
    created: Date.now(),
  })`;

  test('captures become clips below the latest content, in order; badge opens the source or says it was deleted', async ({ page }) => {
    await openCanvas(page);
    await page.evaluate((b64) => ((window as unknown as { __png: string }).__png = b64), png(40, 20).toString('base64'));
    await seed(page, [{ kind: 'stroke', pts: strokePts(0, 0, 300, 400) }]);
    const ids = await withCanvas<string[]>(page, `(h) => h.api.insertCaptures([${capture('c1', 'First **clip**', true)}, ${capture('c2', 'Second clip, text only', false)}])`);
    expect(ids).toHaveLength(2);
    const objs = await objects(page);
    const [a, b] = ids.map((id) => objs.find((o) => o.id === id)!);
    expect(a.y).toBeGreaterThan(400);
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(a.display).toBe('image');
    expect(b.display).toBe('text');
    // the book is not in the library: "source deleted" (L13)
    await expect(page.locator(`.cv-clip[data-id="${a.id}"] .cv-badge`)).toHaveText('source deleted');
    // add it, register an opener: the badge opens it (S6)
    await page.evaluate(async () => {
      const w = window as unknown as { __slate: { library: { putBook(b: unknown): Promise<void> } }; __slateRegistries: { registerSourceOpener(t: string, f: (l: unknown) => void): void }; __opened: unknown[] };
      w.__opened = [];
      w.__slateRegistries.registerSourceOpener('book', (l) => w.__opened.push(l));
      await w.__slate.library.putBook({ id: 'b1', slug: 'axler', format: 'pdf', title: 'Axler', authors: [], citation: '', fileHash: 'x', fileName: 'a.pdf', size: 1, added: 0 });
    });
    const badge = page.locator(`.cv-clip[data-id="${a.id}"] .cv-badge`);
    await expect(badge).toHaveText('Axler, p. 12');
    await badge.click();
    expect(await page.evaluate(() => (window as unknown as { __opened: { locator: { page: number } }[] }).__opened.map((l) => l.locator.page))).toEqual([12]);
    // display: image, text or both (S8)
    await withCanvas(page, `(h) => h.engine.select(['${a.id}'])`);
    await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitemradio', { name: 'Show image and text' }).click();
    await expect(page.locator(`.cv-clip[data-id="${a.id}"] .cv-clip-text strong`)).toHaveText('clip');
    await expect(page.locator(`.cv-clip[data-id="${a.id}"] img`)).toBeVisible();
  });

  test('the carry tray holds captures until they are dragged onto the canvas (S4)', async ({ page }) => {
    await openCanvas(page);
    await page.evaluate((b64) => ((window as unknown as { __png: string }).__png = b64), png(40, 20).toString('base64'));
    await page.evaluate(`window.__slateApp.getState().addToCarry(${capture('k1', 'Carried text', true)})`);
    const tray = page.getByRole('complementary', { name: /Carry tray/ });
    await expect(tray).toBeVisible();
    const card = tray.locator('.cv-carry-card').first();
    const cb = await card.boundingBox();
    const target = await toClient(page, 200, 300);
    await dragClient(page, [cb!.x + 20, cb!.y + 20], target, 12);
    await expect(tray).toHaveCount(0);
    const [clip] = await objects(page);
    expect(clip.kind).toBe('clip');
    expect(clip.x).toBeCloseTo(200, -1);
  });
});
