/**
 * Panes and more: tabs, the divider, swapping sides, full screen, a second canvas in the side
 * pane, an EPUB, the sync status, the dark theme and working offline.
 */
import { flat, handwrite, roughArrow, roughRect } from '../lib/handwriting.mjs';
import { sleep } from '../lib/util.mjs';
import { begin, finish, seedHistory, seedToday, start } from './common.mjs';

const K = 'Panes, sync and offline';

export default {
  id: 'panes',
  title: 'Panes, EPUB, sync, dark theme, offline',
  trailer: [[2.5, 8]],
  async run(env) {
    const s = await begin(env, 'panes');
    const { page, app, d, rec, ctx } = s;
    d.capPos = 'left';
    await seedHistory(app);
    await seedToday(app);
    const side = page.locator('.pane-slot:not([hidden])');
    const ui = (fn, arg) => page.evaluate(([fn, arg]) => new Function('s', 'arg', `return (${fn})(s, arg)`)(window.__slateUi.useApp.getState(), arg), [fn.toString(), arg ?? null]);

    // a second canvas with a little physics on it
    await page.evaluate(() => window.__slate.canvases.create('Physics', 'physics'));
    // the paper and gym's notes in tabs
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByTestId('import-input').setInputFiles({ name: 'spectral-clustering.pdf', mimeType: 'application/pdf', buffer: Buffer.from(env.assets.paper) });
    await page.locator('.pdfv-page[data-page="1"] canvas.ready').waitFor({ timeout: 20_000 });
    await ui((s) => s.openTab({ kind: 'gym', path: 'math/linear-algebra/eigenvalues/notes.md' }));
    await side.locator('.gym-md .katex').first().waitFor();
    await ui((s) => {
      const i = s.tabs.findIndex((t) => t.kind === 'library');
      if (i >= 0) s.closeTab?.(i);
    });
    await app.canvas((h) => h.engine.setCamera({ x: -10, y: h.engine.camera.y - 10, zoom: 0.66 }, false));
    await sleep(800);

    await start(s, { num: 'Part 6', title: 'Panes, sync and offline', sub: 'The canvas and one side pane share the screen; everything is saved on the device first.' });

    // ---------------------------------------------------------------- tabs, divider, sides, full screen
    rec.mark('Tabs, divider, sides, full screen');
    await d.caption({ kicker: K, title: 'Tabs, a divider, swap sides, full screen', body: 'Books, clippings, gym files and canvases open as tabs in the side pane.' });
    const tabs = page.getByRole('tablist', { name: 'Open items' });
    await d.click(tabs.getByRole('tab').first());
    await sleep(700);
    await d.click(tabs.getByRole('tab').nth(1));
    await sleep(600);
    const sep = await page.getByRole('separator', { name: 'Resize panes' }).boundingBox();
    const sx = sep.x + sep.width / 2;
    const sy = sep.y + sep.height * 0.45;
    await d.drag([sx, sy], [sx - 200, sy], { ms: 900 });
    await sleep(400);
    await d.drag([sx - 200, sy], [sx - 60, sy], { ms: 700 });
    await d.click(page.getByRole('button', { name: 'Swap sides' }));
    await sleep(1000);
    await d.click(page.getByRole('button', { name: 'Swap sides' }));
    await sleep(700);
    await d.click(page.getByRole('button', { name: 'Full screen side pane' }));
    await sleep(1200);
    await d.click(page.getByRole('button', { name: 'Exit full screen side pane' }));
    await sleep(600);

    // ---------------------------------------------------------------- second canvas
    rec.mark('A second canvas');
    await d.caption({ kicker: K, title: 'A second canvas beside the main one', body: 'One canvas per course or project; lasso between them like any other source.' });
    await d.click(page.getByRole('button', { name: /Switch canvas/ }));
    await d.click(page.getByRole('button', { name: 'Open Physics in the side pane' }));
    await page.locator('.pane-side .cv-view[data-canvas="physics"][data-ready="true"]').waitFor();
    await sleep(500);
    const pc = await page.locator('.pane-side .cv-view[data-canvas="physics"] .cv-root').boundingBox();
    await d.write(handwrite('F = ma', pc.x + 60, pc.y + 120, 34, { seed: 21 }).strokes, { speed: 1.1 });
    await d.write(roughRect(pc.x + 70, pc.y + 190, 110, 70, { seed: 22 }), { speed: 1.3 });
    await d.write(roughArrow(pc.x + 180, pc.y + 225, pc.x + 300, pc.y + 225, { seed: 23, head: 14 }), { speed: 1.3 });
    await d.write(handwrite('F', pc.x + 310, pc.y + 236, 24, { seed: 24 }).strokes, { speed: 1.1 });
    await sleep(600);

    // ---------------------------------------------------------------- EPUB
    rec.mark('EPUB books');
    await d.caption({ kicker: K, title: 'EPUB books too', body: 'Chapters, a table of contents, maths, highlights and the same lasso.' });
    await d.click(page.getByRole('button', { name: 'Library', exact: true }));
    await sleep(400);
    await d.click(side.getByRole('button', { name: /Import/ }));
    await rec.cut(async () => {
      await page.getByTestId('import-input').setInputFiles({ name: 'short-course.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(env.assets.epub) });
      await page.getByTestId('epub-viewer').waitFor({ timeout: 20_000 });
      await sleep(800);
    });
    await sleep(1000);
    await d.click(side.getByRole('button', { name: 'Table of contents' }));
    await sleep(500);
    await d.click(side.getByRole('navigation', { name: 'Contents' }).getByRole('button', { name: /Eigenvalues and eigenvectors/ }));
    await sleep(2200);

    // ---------------------------------------------------------------- sync status
    rec.mark('Sync status');
    await d.caption({ kicker: K, title: 'Synced to your gym repository', body: 'Saved on the device first, pushed within about 30 s. The cloud button shows the state.' });
    await d.click(page.getByTestId('sync-status'));
    await sleep(2600);
    // ---------------------------------------------------------------- dark theme
    rec.mark('Dark theme');
    await d.caption({ kicker: K, title: 'Light or dark', body: 'Follows the system, or choose in **Settings → This device**.' });
    const dlg = page.getByRole('dialog', { name: 'Settings' });
    const theme = dlg.getByLabel('Theme');
    await theme.scrollIntoViewIfNeeded();
    await d.click(theme);
    await theme.selectOption('dark');
    await sleep(900);
    await d.press('Escape');
    await sleep(1800);

    // ---------------------------------------------------------------- offline
    rec.mark('Works offline');
    await d.caption({ kicker: K, title: 'Works offline', body: 'Keep writing and reading; changes wait on the device and sync when you are back.' });
    await ctx.setOffline(true);
    await page.locator('[data-testid="sync-status"][data-phase="offline"]').waitFor({ timeout: 15_000 }).catch(() => {});
    await sleep(600);
    await d.hover([520, 300]);
    const cv = await page.locator('.pane-canvas .cv-root').boundingBox();
    await d.write(handwrite('offline is fine', cv.x + 60, cv.y + cv.height * 0.72, 26, { seed: 31 }).strokes, { speed: 1.2 });
    await sleep(800);
    await ctx.setOffline(false);
    await app.waitSynced().catch(() => {});
    await sleep(1500);

    return finish(env, s);
  },
};
