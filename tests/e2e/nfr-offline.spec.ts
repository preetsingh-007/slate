/**
 * Offline NFR and PWA: after the first visit the service worker has precached the app, pdf.js
 * (worker, wasm, CMaps, standard fonts), KaTeX's fonts and the snapshot frame page, so the app
 * starts and reading, writing, lasso and source links all work with the network off.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';
import { makePaperPdf } from '../../src/test/fixtures';
import { drawMouse, objects, wave, withCanvas } from './canvas-helpers';
import { importFile, lassoRect, libraryItems, openLibrary, setHelper } from './libraryHelpers';
import { serveStatic } from './staticServer';

const side = (page: Page) => page.locator('.pane-slot:not([hidden])');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** Waits until the service worker has installed (precached everything) and controls the page. */
async function swReady(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker?.getRegistration();
          return reg?.active?.state === 'activated' && !!navigator.serviceWorker.controller;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test('offline: after the first visit the app starts and reads, writes, lassos and follows links with the network off', async ({ page, context }) => {
  test.setTimeout(90_000);
  // the production bundle on its own origin, so stopping the server takes the app offline
  const app = await serveStatic(join(process.cwd(), 'dist'));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(app.url);
  await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate);
  await swReady(page);
  await setHelper(page);
  await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
  await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
  // a saved web page (Original view in the sandboxed frame) and a Markdown clipping with maths
  await page.getByRole('button', { name: 'New from link' }).click();
  const dialog = page.getByRole('dialog', { name: 'New from link' });
  await dialog.getByRole('textbox', { name: 'Web address' }).fill('https://arxiv.org/html/2401.01234');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('clipping-pane')).toBeVisible();
  const { books, clippings } = await libraryItems(page);

  await app.stop();
  await context.setOffline(true);
  await page.reload();
  await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
  // everything pdf.js may need comes from the precache, used before or not
  const assets = await page.evaluate(async () => {
    const out: Record<string, number> = {};
    for (const p of ['pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap', 'pdfjs/standard_fonts/FoxitSerif.pfb', 'pdfjs/standard_fonts/LiberationSans-Regular.ttf', 'pdfjs/wasm/openjpeg.wasm', 'pdfjs/wasm/jbig2.wasm', 'pdfjs/iccs/CGATS001Compat-v2-micro.icc', 'snapshot.html', 'manifest.webmanifest']) {
      out[p] = await fetch(new URL(p, document.baseURI)).then((r) => r.status, () => 0);
    }
    return out;
  });
  for (const [p, status] of Object.entries(assets)) expect(status, p).toBe(200);

  // writing: a stroke and a text box
  const before = (await objects(page)).length;
  await page.getByRole('radio', { name: 'Pen (P)' }).click();
  await drawMouse(page, wave(120, 200));
  await expect.poll(async () => (await objects(page)).length).toBe(before + 1);

  // reading: the book renders (pdf.js worker from the cache), with its text layer
  await openLibrary(page);
  await page.getByRole('button', { name: `Open ${books[0].title}` }).click();
  await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
  await expect(page.locator('.pdfv-page[data-page="1"] .textLayer span').first()).toBeAttached();

  // lasso from the book onto the canvas, then back through the badge
  await side(page).getByRole('button', { name: 'Lasso', exact: true }).click();
  const box = (await page.locator('.pdfv-page[data-page="1"]').boundingBox())!;
  const s = box.width / 612;
  await lassoRect(page, { x: box.x + 310 * s, y: box.y + 155 * s, width: 280 * s, height: 120 * s });
  await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
  await expect.poll(async () => (await objects(page)).filter((o) => o.kind === 'clip').length).toBe(1);
  const clip = (await objects(page)).find((o) => o.kind === 'clip')!;
  await page.evaluate(() => (window as unknown as { __slateApp: { setState(s: object): void } }).__slateApp.setState({ tabs: [], active: 0, paneOpen: false }));
  await withCanvas(page, `(h) => h.engine.showRect(h.ctl.boundsOf(['${clip.id}']), false)`);
  await page.locator(`.pane-canvas .cv-clip[data-id="${clip.id}"] .cv-badge`).click();
  await expect(page.locator('.pdfv-page[data-page="1"] [data-testid="flash"]')).toBeVisible();

  // the saved web page: Reader view with KaTeX's fonts, Original view in the sandboxed frame
  await openLibrary(page);
  await page.getByRole('tab', { name: /Clippings/ }).click();
  await page.getByRole('button', { name: `Open ${clippings[0].title}` }).click();
  await expect(page.locator('.clip-article .katex').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px KaTeX_Main') && [...document.fonts].some((f) => f.family.includes('KaTeX') && f.status === 'loaded'))).toBe(true);
  await page.getByRole('radio', { name: 'Original' }).click();
  await expect(page.frameLocator('[data-testid="snapshot-frame"]').locator('h1')).toHaveText('Spectral Methods for Study Graphs');
});

test.describe('GitHub Pages: the app under /slate/ (PWA install, service worker scope, pdf.js, snapshot frame)', () => {
  let dir = '';
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    // the deploy workflow's build (npm run build -- --base=/<repo>/), with the test hooks
    dir = await mkdtemp(join(tmpdir(), 'slate-pages-'));
    execFileSync('npx', ['vite', 'build', '--base=/slate/', '--outDir', dir, '--emptyOutDir'], { env: { ...process.env, SLATE_E2E: '1' }, stdio: 'pipe' });
  });
  test.afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test('installs as Slate (standalone, icons), works under the base path and offline', async ({ page, context }) => {
    test.setTimeout(90_000);
    const app = await serveStatic(dir, '/slate/');
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.goto(app.url);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    await swReady(page);

    // the web app manifest: name, standalone display, scope and start URL under the base path
    const manifestUrl = await page.locator('link[rel="manifest"]').evaluate((l: HTMLLinkElement) => l.href);
    const manifest = await (await page.request.get(manifestUrl)).json();
    expect(manifest).toMatchObject({ name: 'Slate', short_name: 'Slate', display: 'standalone', start_url: '/slate/', scope: '/slate/' });
    const sizes: string[] = [];
    for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
      const res = await page.request.get(new URL(icon.src, manifestUrl).href);
      expect(res.status(), icon.src).toBe(200);
      if (icon.type === 'image/png') {
        const png = PNG.sync.read(await res.body());
        expect(`${png.width}x${png.height}`).toBe(icon.sizes);
      }
      sizes.push(icon.sizes);
    }
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose?.includes('maskable'))).toBe(true);
    // iPad's Add to Home Screen uses the apple-touch-icon and the meta tags
    const touchIcon = await page.locator('link[rel="apple-touch-icon"]').evaluate((l: HTMLLinkElement) => l.href);
    expect((await page.request.get(touchIcon)).status()).toBe(200);
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');

    // the service worker's scope is the base path, not the site root
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)).toBe(app.url);

    // pdf.js (worker, wasm, CMaps) and the snapshot frame load from under the base path
    await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    const frame = await page.evaluate(async () => {
      const html = await fetch('snapshot.html').then((r) => r.text());
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      document.body.append(f);
      const ready = new Promise<string>((resolve) => window.addEventListener('message', (e) => e.source === f.contentWindow && resolve(String(e.data?.type))));
      f.srcdoc = html;
      const type = await Promise.race([ready, new Promise<string>((r) => setTimeout(() => r('timeout'), 5000))]);
      f.remove();
      return type;
    });
    expect(frame).toBe('ready');
    // nothing was requested outside the base path, and nothing was missing
    expect(app.requests.filter((r) => !r.startsWith('200 /slate/'))).toEqual([]);

    // offline under the base path: the service worker serves the app
    await app.stop();
    await context.setOffline(true);
    await page.reload();
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    await openLibrary(page);
    await page.getByRole('button', { name: /^Open Reading Order/ }).click();
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
  });
});
