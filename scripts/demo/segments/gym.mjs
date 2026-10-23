/**
 * W4 · Marking for gym: select worked ink, Mark for gym with a kind, a topic from the picker
 * and a comment; the flag shows on the canvas. Once gym's agent has formalized the mark
 * (journal/formalized.md, committed here to the mocked repository), the flag becomes a badge
 * that opens the gym file at its heading.
 */
import { flat, handwrite } from '../lib/handwriting.mjs';
import { sleep } from '../lib/util.mjs';
import { begin, finish, seedHistory, seedToday, start, TODAY_LINE } from './common.mjs';

const K = 'W4 · Marking for gym';

export default {
  id: 'gym',
  title: 'Marking for gym (W4)',
  trailer: [[3, 12]],
  async run(env) {
    const s = await begin(env, 'gym');
    const { page, app, d, rec } = s;
    await seedHistory(app);
    await seedToday(app);
    // the worked check below today's notes
    const L = TODAY_LINE;
    const hw = (text, x, y, size) => flat(handwrite(text, x, y, size, { seed: Math.round(x + y * 3) }).strokes).map((pts) => ({ kind: 'stroke', pts, color: 'currentInk', size: 2.5 }));
    await app.seed([...hw('A = (2 1; 1 2):', 60, L + 300, 26), ...hw('tr A = 4 = 1 + 3', 90, L + 360, 26), ...hw('det A = 3 = 1 · 3', 90, L + 415, 26), ...hw('⇒ trace = sum of λ, det = product', 90, L + 470, 22)]);
    await app.canvas((h, y) => h.engine.setCamera({ x: h.engine.camera.x, y, zoom: 1 }, false), L + 120);
    await app.settle(500);
    const bar = page.getByRole('toolbar', { name: 'Selection' });

    await start(s, { num: 'Part 4', title: 'Marking for gym', sub: 'Flag work on the canvas; an agent files it in your gym repository.' });

    rec.mark('Mark for gym');
    await d.caption({ kicker: K, title: 'Select a region → Mark for gym', body: 'Choose a kind (note, problem, solution or question) and, optionally, a topic.' });
    await d.click(page.getByRole('toolbar', { name: 'Canvas tools' }).getByRole('radio', { name: /^Lasso/ }));
    const a = await app.toClient(40, L + 255);
    const b = await app.toClient(520, L + 490);
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const t = -Math.PI / 2 - (i / 28) * Math.PI * 2;
      pts.push([(a[0] + b[0]) / 2 + ((b[0] - a[0]) / 2 + 10) * Math.cos(t), (a[1] + b[1]) / 2 + ((b[1] - a[1]) / 2 + 10) * Math.sin(t)]);
    }
    await d.drag(pts[0], pts.slice(1), { ms: 1300, hold: 60 });
    await sleep(500);
    await d.click(bar.getByRole('button', { name: 'Mark for gym' }));
    const dlg = page.getByRole('dialog', { name: 'Mark for gym' });
    await dlg.waitFor();
    await sleep(400);
    await d.click(dlg.getByLabel('Note', { exact: true }));
    await d.click(dlg.getByRole('combobox'));
    await d.type('eigen', { delay: 80 });
    await sleep(500);
    await d.click(dlg.getByRole('option', { name: /Eigenvalues/ }).first());
    await d.click(dlg.getByLabel('Comment (optional)'));
    await d.type('trace = sum of eigenvalues, det = product');
    await sleep(300);
    await d.click(dlg.getByRole('button', { name: 'Mark', exact: true }));
    await sleep(600);
    await d.press('Escape');
    await sleep(1000);

    // ---------------------------------------------------------------- formalized
    rec.mark('Formalized: the badge opens gym');
    await d.caption({ kicker: K, title: 'In gym, an agent formalizes the mark', body: 'It goes to `journal/queue.md`; once `formalized.md` lists it, the flag becomes a badge to the gym file.' });
    await sleep(1800);
    const [mark] = await app.canvas((h) => h.ctl.model.marks());
    await rec.cut(async () => {
      const day = new Date().toLocaleDateString('sv-SE');
      const line = `- ${mark.id} → ../math/linear-algebra/eigenvalues/notes.md#trace-and-determinant · ${day}\n`;
      const cur = (await (await fetch(`${env.apiUrl}/github/__demo/file?path=journal/formalized.md`)).json()).text ?? '# Formalized\n';
      await fetch(`${env.apiUrl}/github/__demo/commit`, { method: 'POST', body: JSON.stringify({ files: { 'journal/formalized.md': `${cur.trimEnd()}\n\n${line}` }, message: 'journal: formalize mark' }) });
      await app.syncNow();
      await page.locator(`[data-mark="${mark.id}"] .cv-flag.formalized`).waitFor({ timeout: 30_000 });
    });
    await sleep(1500);
    await d.click(page.locator(`[data-mark="${mark.id}"] .cv-flag.formalized`));
    await sleep(3200);

    return finish(env, s);
  },
};
