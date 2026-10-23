/**
 * W2 · Reading a paper: import a PDF, highlight, write on the page, a margin note, lasso a
 * figure onto the canvas, and come back through the clip's source badge.
 */
import { handwrite, roughEllipse } from '../lib/handwriting.mjs';
import { sleep } from '../lib/util.mjs';
import { begin, finish, seedHistory, seedToday, start } from './common.mjs';

const K = 'W2 · Reading a paper';

/** Client rectangle of a PDF region given in points on page `n`. */
async function pageRect(page, n, x, y, w, h) {
  const b = await page.locator(`.pdfv-page[data-page="${n}"]`).boundingBox();
  const s = b.width / 612;
  return { x: b.x + x * s, y: b.y + y * s, w: w * s, h: h * s, s };
}

export default {
  id: 'paper',
  title: 'Reading a paper (W2)',
  trailer: [
    [4, 9],
    [27, 34],
  ],
  async run(env) {
    const s = await begin(env, 'paper');
    const { page, app, d, rec } = s;
    d.capPos = 'left';
    await seedHistory(app);
    await seedToday(app);
    const side = page.locator('.pane-slot:not([hidden])');
    const tools = page.getByRole('toolbar', { name: 'PDF tools' });

    await start(s, { num: 'Part 2', title: 'Reading a paper', sub: 'Books and papers open beside the canvas, with highlights, ink and notes.' });

    // ---------------------------------------------------------------- import
    await d.caption({ kicker: K, title: 'Library → Import a PDF or EPUB', body: 'Or drop the file anywhere. It opens in the side pane next to the canvas.' });
    await d.click(page.getByRole('button', { name: 'Library', exact: true }));
    await sleep(500);
    await d.click(side.getByRole('button', { name: /Import/ }));
    await rec.cut(async () => {
      await page.getByTestId('import-input').setInputFiles({ name: 'spectral-clustering.pdf', mimeType: 'application/pdf', buffer: Buffer.from(env.assets.paper) });
      await page.locator('.pdfv-page[data-page="1"] canvas.ready').waitFor({ timeout: 20_000 });
      await page.locator('.pdfv-page[data-page="1"] .textLayer span').first().waitFor();
      // the canvas is narrower now: show today's work at a smaller zoom
      await app.canvas((h) => h.engine.setCamera({ x: -10, y: h.engine.camera.y - 10, zoom: 0.66 }, false));
      await sleep(600);
    });
    await sleep(1600);

    // ---------------------------------------------------------------- highlight
    rec.mark('Highlight, ink and notes');
    await d.caption({ kicker: K, title: 'Highlight, write on the page, add margin notes', body: 'Choose **Highlight text** and drag over a passage; the paper file itself never changes.' });
    await d.click(tools.getByRole('button', { name: 'Highlight text' }));
    const span = async (needle, exact = false) => {
      const r = await page.evaluate(([needle, exact]) => {
        const root = document.querySelector('.pdfv-page[data-page="1"] .textLayer');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          const i = n.nodeValue.indexOf(needle);
          if (i < 0 || (exact && n.nodeValue.trim() !== needle)) continue;
          const rg = document.createRange();
          rg.setStart(n, i);
          rg.setEnd(n, i + needle.length);
          const b = rg.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        }
        return null;
      }, [needle, exact]);
      if (!r) throw new Error(`not in the PDF text layer: ${needle}`);
      return r;
    };
    const a = await span('We show that the second smallest eigenvalue');
    await d.drag([a.x + 1, a.y + a.h / 2], [a.x + a.w - 1, a.y + a.h / 2], { ms: 900 });
    await sleep(600);
    const menu = page.getByRole('dialog', { name: 'Selection actions' });
    if (await menu.isVisible().catch(() => false)) await d.click(menu.getByRole('button', { name: 'Highlight yellow' }));
    await sleep(500);

    // ---------------------------------------------------------------- pen on the page
    await d.click(tools.getByRole('button', { name: 'Pen', exact: true }));
    const col = await span('Students rarely meet a subject in the order in which it was');
    const lap = await span('Laplacian', true);
    const ecx = col.x + col.w / 2;
    const ecy = lap.y + lap.h * 2.3;
    await d.write(roughEllipse(ecx, ecy, 62, 17, { seed: 7 }), { speed: 1.0 });
    await d.write(handwrite('key!', ecx + 78, ecy + 6, 16, { seed: 3 }).strokes, { speed: 0.9 });
    await sleep(300);

    // ---------------------------------------------------------------- margin note
    await d.click(tools.getByRole('button', { name: 'Margin note' }));
    await d.click([col.x + col.w - 14, lap.y + lap.h / 2]);
    const note = page.getByRole('textbox', { name: 'Note text' });
    await note.waitFor();
    await note.focus();
    await d.type('Same as Axler 7.29: symmetric ⇒ real eigenvalues');
    await sleep(300);
    await d.click(page.getByRole('button', { name: 'Save', exact: true }));
    await sleep(800);

    // ---------------------------------------------------------------- lasso to the canvas
    rec.mark('Lasso a figure onto the canvas');
    await d.caption({ kicker: K, title: 'Lasso a figure → Send to canvas', body: 'It lands on the canvas as a clip, with its text and a link back to the page.' });
    await d.click(tools.getByRole('button', { name: 'Lasso' }));
    await d.hover([1150, 560]);
    await d.wheel(0, 260, { ms: 600 });
    await sleep(400);
    const fig = await pageRect(page, 1, 46, 470, 258, 146);
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const t = -Math.PI / 2 - (i / 28) * Math.PI * 2;
      pts.push([fig.x + fig.w / 2 + (fig.w / 2 + 8) * Math.cos(t) * 1.04, fig.y + fig.h / 2 + (fig.h / 2 + 8) * Math.sin(t) * 1.08]);
    }
    await d.drag(pts[0], pts.slice(1), { ms: 1300, hold: 60 });
    const preview = page.getByTestId('capture-preview');
    await preview.waitFor({ timeout: 15_000 });
    await sleep(1200);
    await d.click(preview.getByRole('button', { name: 'Send to canvas' }));
    await sleep(1600);

    // ---------------------------------------------------------------- back through the badge
    rec.mark('Source badge back to the page');
    await d.caption({ kicker: K, title: 'Tap the clip’s badge to go back', body: 'The paper opens at that page with the region flashed, even offline.' });
    await d.hover([1150, 500]);
    await d.wheel(0, 1600, { ms: 900 });
    await sleep(600);
    const badge = page.locator('.pane-canvas .cv-clip .cv-badge').last();
    await d.click(badge);
    await sleep(2600);

    return finish(env, s);
  },
};
