/**
 * W1 · The canvas: ink with pressure, colours and sizes, highlighter, eraser (whole and
 * partial), a Markdown text box with maths and a to-do, a photo with ink on it, the day line,
 * lasso and selection actions, Beautify, space insertion, pan and zoom, minimap and dates,
 * undo and redo.
 */
import { handwrite, roughArrow, roughLine, roughRect, roughEllipse } from '../lib/handwriting.mjs';
import { sleep } from '../lib/util.mjs';
import { begin, finish, seedHistory, start } from './common.mjs';

const K = 'W1 · Lecture on the canvas';

export default {
  id: 'canvas',
  title: 'Canvas (W1): a lecture',
  trailer: [
    [2.5, 9.5],
    [27, 33],
    [52, 57],
  ],
  async run(env) {
    const s = await begin(env, 'canvas');
    const { page, app, d, rec } = s;
    await seedHistory(app);
    const tools = page.getByRole('toolbar', { name: 'Canvas tools' });
    const tool = (name) => tools.getByRole('radio', { name: new RegExp(`^${name}`) });
    const bar = page.getByRole('toolbar', { name: 'Selection' });
    const write = async (text, x, y, size, opts = {}) => {
      const hw = handwrite(text, x, y, size, { seed: Math.round(x * 3 + y), ...opts });
      await d.write(hw.strokes, { speed: opts.speed ?? 1.0 });
      return hw.width;
    };

    await start(s, { num: 'Part 1', title: 'The canvas', sub: 'An endless page for lectures, worked problems and diagrams.' });
    rec.mark('Ink with pressure');

    // ---------------------------------------------------------------- pen with pressure
    await d.caption({ kicker: K, title: 'Write with the Pencil', body: 'Real pen input with **pressure**. The first stroke of the day draws the dated day line.' });
    await d.hover([700, 380], 400);
    await write('Eigenvalues', 70, 405, 40);
    const w2 = await write('Av = λv', 96, 485, 32);
    await sleep(300);

    // ---------------------------------------------------------------- colours and sizes
    await d.caption({ kicker: K, title: 'Colours and sizes', body: 'Pick a colour and a size in the toolbar, or save them as a preset.' });
    await d.click(tools.getByRole('button', { name: 'Blue', exact: true }));
    await d.click(tools.getByRole('button', { name: 'Size large' }));
    await write('det(A − λI) = 0', 96, 565, 32);
    await d.click(tools.getByRole('button', { name: 'Ink', exact: true }));
    await d.click(tools.getByRole('button', { name: 'Size medium' }));

    // ---------------------------------------------------------------- highlighter
    await d.caption({ kicker: K, title: 'Highlighter', body: 'Translucent ink that stays behind your writing.' });
    await d.click(tool('Highlighter'));
    await d.click(tools.getByRole('button', { name: 'Yellow', exact: true }).or(tools.locator('.cv-swatch').first()).first());
    await d.write([roughLine(84, 552, 382, 549, { seed: 3 })[0].map(([x, y, p]) => [x, y, 0.6])], { speed: 0.8 });
    await sleep(400);

    // ---------------------------------------------------------------- eraser
    await d.click(tool('Pen'));
    await d.caption({ kicker: K, title: 'Eraser: whole strokes or partial', body: 'Whole mode removes any stroke it touches; partial mode cuts through ink.' });
    // a slip after the equation, then an underline
    const slipX = 96 + w2 + 22;
    await write('+ 1', slipX, 485, 32, { seed: 9 });
    await d.write(roughLine(66, 422, 360, 424, { seed: 5 }));
    await d.click(tool('Eraser'));
    await d.write([[[slipX - 6, 470], [slipX + 20, 455], [slipX + 46, 470], [slipX + 70, 452], [slipX + 92, 468]].map(([x, y]) => [x, y, 0.5])], { speed: 0.5 });
    await sleep(300);
    await d.click(page.getByRole('radio', { name: 'Partial' }));
    await d.write([[[262, 414], [258, 440]].map(([x, y]) => [x, y, 0.5])], { speed: 0.3 });
    await d.write([[[302, 414], [300, 440]].map(([x, y]) => [x, y, 0.5])], { speed: 0.3 });
    await sleep(400);
    await d.click(page.getByRole('radio', { name: 'Whole strokes' }));

    // ---------------------------------------------------------------- text box: Markdown, maths, to-do
    rec.mark('Text, maths and to-dos');
    await d.caption({ kicker: K, title: 'Text boxes speak Markdown and maths', body: 'Type `$…$` for maths and `- [ ]` for a to-do; tap the box to tick it.' });
    await d.click(tool('Text'));
    await d.click([720, 360]);
    const ta = page.getByRole('textbox', { name: /Text box/ });
    await ta.waitFor();
    await d.type('## Lecture 7 · Eigenvalues\n');
    await d.type('Roots of $p(\\lambda) = \\det(A - \\lambda I)$\n');
    await d.type('- [ ] Exercise 5A.4\n- [ ] Read Axler 5B', { delay: 30 });
    await sleep(300);
    await d.press('Escape');
    await sleep(500);
    const box = page.locator('.cv-text').filter({ hasText: 'Lecture 7' }).first();
    await d.click(box.locator('input.md-task').first());
    await sleep(900);

    // canvas positions of what was written (client positions move as the view does)
    const at = async (x, y) => app.toCanvas(x, y);
    const rowAv = [await at(84, 450), await at(96 + w2 + 14, 496)];
    const rowDet = [await at(84, 528), await at(392, 578)];
    const client = async ([a, b]) => {
      const p = await app.toClient(a.x, a.y);
      const q = await app.toClient(b.x, b.y);
      return { x: p[0], y: p[1], w: q[0] - p[0], h: q[1] - p[1] };
    };

    // ---------------------------------------------------------------- the day line
    rec.mark('Day lines and topics');
    await d.caption({ kicker: K, title: 'Every day starts with a dated line', body: 'Its label stays pinned at the edge as you pan. The tag button files the day under gym topics.' });
    await d.press('Escape');
    await d.click(tool('Hand'));
    await d.drag([900, 560], [620, 560], { ms: 900 });
    await sleep(300);
    await d.drag([620, 560], [900, 560], { ms: 900 });
    const tagBtn = page.getByRole('button', { name: /^Tag Thu 22 Oct 2026 with topics$/ });
    await d.click(tagBtn);
    const dlg = page.getByRole('dialog');
    await dlg.waitFor();
    await sleep(300);
    await d.click(dlg.getByRole('combobox'));
    await d.type('eigen', { delay: 70 });
    await sleep(400);
    await d.click(dlg.getByRole('option', { name: /Eigenvalues/ }).first());
    await sleep(400);
    await d.click(dlg.getByRole('button', { name: 'Save' }));
    await sleep(700);

    // ---------------------------------------------------------------- a photo with ink on it
    rec.mark('Photos with ink');
    await d.press('Escape');
    await d.hover([700, 600]);
    await d.wheel(0, 230, { ms: 700 });
    await d.caption({ kicker: K, title: 'Take a photo of the board and draw on it', body: '**Insert image → Take a photo.** Ink drawn over an image moves with it.' });
    await d.click(tool('Lasso'));
    await d.click(tools.getByRole('button', { name: 'Insert image' }));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), d.click(page.getByRole('menuitem', { name: /Take a photo/ }))]);
    await chooser.setFiles({ name: 'board.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(env.assets.board) });
    const img = page.locator('.cv-image').first();
    await img.locator('img').waitFor();
    await sleep(700);
    // make it smaller and put it beside the notes
    let ib = await img.boundingBox();
    const ratio = ib.height / ib.width;
    const se = await page.locator('[data-handle="se"]').boundingBox();
    await d.drag([se.x + se.width / 2, se.y + se.height / 2], [ib.x + 430, ib.y + 430 * ratio], { ms: 750 });
    ib = await img.boundingBox();
    await d.drag([ib.x + ib.width * 0.45, ib.y + ib.height * 0.5], [600 + ib.width * 0.45, 330 + ib.height * 0.5], { ms: 750 });
    ib = await img.boundingBox();
    await d.press('Escape');
    await d.click(tool('Pen'));
    await d.click(tools.getByRole('button', { name: 'Orange', exact: true }));
    await d.write(roughEllipse(ib.x + ib.width * 0.18, ib.y + ib.height * 0.72, ib.width * 0.13, ib.height * 0.08, { seed: 12 }), { speed: 1.1 });
    await d.write(handwrite('key!', ib.x + ib.width * 0.33, ib.y + ib.height * 0.92, 22, { seed: 4 }).strokes, { speed: 1.1 });
    await d.click(tools.getByRole('button', { name: 'Ink', exact: true }));
    await d.click(tool('Lasso'));
    await d.click([ib.x + ib.width * 0.6, ib.y + ib.height * 0.3]);
    await d.drag([ib.x + ib.width * 0.6, ib.y + ib.height * 0.3], [ib.x + ib.width * 0.6 + 70, ib.y + ib.height * 0.3 + 10], { ms: 700 });
    await sleep(500);
    await d.press('Escape');

    // ---------------------------------------------------------------- lasso and selection actions
    rec.mark('Lasso and selection');
    await d.caption({ kicker: K, title: 'Lasso anything, then move, scale, recolour or duplicate', body: 'Strokes, text, images and clips together. Drag to move; drag a corner to scale.' });
    let r = await client(rowAv);
    const loop = (r, pad = 14) => {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const rx = r.w / 2 + pad;
      const ry = r.h / 2 + pad;
      const pts = [];
      for (let i = 0; i <= 28; i++) {
        const a = -Math.PI / 2 - (i / 26) * Math.PI * 2;
        pts.push([cx + rx * Math.cos(a) * (1 + 0.04 * Math.sin(i)), cy + ry * Math.sin(a)]);
      }
      return pts;
    };
    const lp = loop(r);
    await d.drag(lp[0], lp.slice(1), { ms: 1100, hold: 60 });
    await sleep(500);
    await d.drag([r.x + r.w / 2, r.y + r.h / 2], [r.x + r.w / 2 + 170, r.y + r.h / 2 + 4], { ms: 800 });
    const se2 = await page.locator('[data-handle="se"]').boundingBox();
    await d.drag([se2.x + se2.width / 2, se2.y + se2.height / 2], [se2.x + se2.width / 2 + 46, se2.y + se2.height / 2 + 12], { ms: 700 });
    await d.click(bar.getByRole('button', { name: 'Colour' }));
    await d.click(bar.getByRole('menuitem', { name: 'Purple' }).or(page.getByRole('menu', { name: 'Colour' }).getByRole('menuitem', { name: 'Purple' })).first());
    await sleep(400);
    await d.click(bar.getByRole('button', { name: /^Duplicate/ }));
    await sleep(700);
    await d.click(bar.getByRole('button', { name: /^Delete/ }));
    await sleep(400);
    await d.press('Escape');

    // ---------------------------------------------------------------- Beautify
    rec.mark('Beautify');
    await d.caption({ kicker: K, title: 'Beautify turns rough sketches into clean shapes', body: 'Select a rough box or arrow and choose **Beautify**; **Restore** brings your ink back.' });
    await d.click(tool('Pen'));
    r = await client(rowDet);
    const ibox = await img.boundingBox();
    await d.write(roughRect(r.x - 14, r.y - 8, r.w + 28, r.h + 16, { seed: 31, rough: 3 }), { speed: 1.3 });
    await d.write(roughArrow(r.x + r.w + 30, r.y + r.h * 0.6, ibox.x - 18, ibox.y + ibox.height * 0.68, { seed: 33, head: 18, bow: 0.12 }), { speed: 1.2 });
    await d.click(tool('Lasso'));
    // a rectangle lasso around the sketch (second click on the lasso switches to rectangle)
    await d.click(page.getByRole('radio', { name: 'Rectangle' }));
    await d.drag([r.x - 40, r.y - 30], [ibox.x - 6, ibox.y + ibox.height * 0.8 + 20], { ms: 700 });
    // the image may join the selection: keep only strokes and shapes
    await app.canvas((h) => h.engine.select([...h.engine.getSelection()].filter((id) => h.ctl.get(id)?.kind === 'stroke' && h.ctl.get(id)?.tool === 'pen' && h.ctl.get(id)?.color === 'currentInk')));
    await sleep(400);
    await d.click(bar.getByRole('button', { name: /^Beautify/ }));
    await sleep(1300);
    await d.click(bar.getByRole('button', { name: 'Restore original ink' }));
    await sleep(1000);
    await d.click(bar.getByRole('button', { name: /^Beautify/ }));
    await sleep(900);
    await d.press('Escape');
    await d.click(page.getByRole('radio', { name: 'Free-form' }));

    // ---------------------------------------------------------------- space
    rec.mark('Insert space');
    await d.caption({ kicker: K, title: 'Make room where you need it', body: 'The **space** tool pushes everything below the line down (or pulls it up), only where it is in the way.' });
    await d.click(tool('Insert space'));
    r = await client(rowAv);
    const split = r.y + r.h + 22;
    await d.drag([360, split], [360, split + 90], { ms: 1000 });
    await sleep(700);

    // ---------------------------------------------------------------- navigation
    rec.mark('Pan, zoom, minimap and dates');
    await d.caption({ kicker: K, title: 'Pan and zoom; the minimap and dates take you back', body: 'Pinch or ⌘-scroll to zoom. **Go to a date** lists every day; **Home** jumps back to now.' });
    await d.click(tool('Pen'));
    await d.hover([700, 450]);
    await d.wheel(0, 500, { ctrl: true, ms: 900 });
    await sleep(300);
    await d.wheel(0, -700, { ms: 1000 });
    await sleep(400);
    const mm = page.getByRole('img', { name: /Overview of the canvas/ });
    const mb = await mm.boundingBox();
    await d.click([mb.x + mb.width * 0.5, mb.y + mb.height * 0.12]);
    await sleep(900);
    await d.click(tools.getByRole('button', { name: 'Go to a date' }));
    await sleep(400);
    await d.click(page.getByRole('list', { name: 'Days on this canvas' }).getByRole('button', { name: /Tue 20 Oct/ }));
    await sleep(1100);
    await d.press('Home', ['Home'], 900);
    await page.keyboard.press('Control+0');
    await sleep(600);

    // ---------------------------------------------------------------- undo / redo
    rec.mark('Undo and redo');
    await d.caption({ kicker: K, title: 'Undo and redo everything', body: '⌘Z and ⇧⌘Z, the toolbar arrows, or a two-finger tap.' });
    await page.locator('.cv-root').first().focus();
    await d.press('Control+z', ['⌘', 'Z'], 900);
    await d.press('Control+z', ['⌘', 'Z'], 900);
    await d.press('Control+Shift+z', ['⇧', '⌘', 'Z'], 900);
    await d.press('Control+Shift+z', ['⇧', '⌘', 'Z'], 900);
    await page.evaluate(() => document.activeElement?.blur());
    await sleep(500);

    return finish(env, s);
  },
};
