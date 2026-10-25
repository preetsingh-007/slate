/** Shared parts of the segments: starting a recorded session, section titles, seeded history. */
import { join } from 'node:path';
import { Director } from '../lib/input.mjs';
import { Recorder } from '../lib/recorder.mjs';
import { newSession } from '../lib/session.mjs';
import { flat, handwrite, roughArrow, roughLine, roughRect } from '../lib/handwriting.mjs';
import { sleep } from '../lib/util.mjs';

/** Opens a session and a recorder for segment `id` (recording starts with start()). */
export async function begin(env, id, opts = {}) {
  const s = await newSession(env, opts);
  const rec = new Recorder(s.page, join(env.work, 'frames', id));
  const d = new Director(s.page, rec);
  return { ...s, rec, d, id };
}

/** Starts recording behind a section title, which then fades to reveal the app. */
export async function start(s, section, ms = 1700) {
  if (section) await s.page.evaluate((c) => window.__demo.section(c, 0), section);
  await sleep(400);
  await s.rec.start();
  if (section) {
    await sleep(ms);
    await s.page.evaluate(() => window.__demo.section(null));
    await sleep(550);
  }
}

/** Stops, encodes the clip and closes the session. */
export async function finish(env, s, extra = {}) {
  await s.d.caption(null);
  await sleep(500);
  const r = await s.rec.stop();
  const file = join(env.clips, `${s.id}.mp4`);
  await s.rec.encode(file);
  await s.ctx.close();
  return { file, marks: r.marks, duration: r.end, ...extra };
}

const day = (d) => new Date(2026, 9, d, 10, 30).getTime();

/**
 * Earlier lectures on the main canvas, above today's line: 15 Oct (invariant subspaces) and
 * 20 Oct (characteristic polynomial), with day lines, typed notes and handwriting.
 */
export async function seedHistory(app) {
  await app.waitCanvas();
  await app.page.evaluate(() => {
    const h = window.__slateCanvas.main;
    h.ctl.model.transact((tx) => {
      tx.setDay('2026-10-15', -2400);
      tx.setDay('2026-10-20', -1900);
    });
  });
  const hw = (text, x, y, size, opts = {}) => flat(handwrite(text, x, y, size, { seed: Math.round(x + y), ...opts }).strokes);
  const strokes = (list, created, color = '#1f2328', size = 2.2) => list.map((pts) => ({ kind: 'stroke', pts, created, color, size }));
  const d15 = day(15);
  const d20 = day(20);
  await app.seed([
    { kind: 'text', x: 20, y: -2350, w: 520, content: '## Lecture 5 · Invariant subspaces\nA subspace $U$ is **invariant** under $T$ if $Tu \\in U$ for every $u \\in U$.', created: d15 },
    ...strokes(hw('null T and range T', 30, -2160, 26), d15),
    ...strokes(hw('are invariant', 60, -2115, 26), d15),
    ...strokes([...roughRect(560, -2330, 300, 150, { seed: 41 }), ...roughArrow(600, -2200, 820, -2290, { seed: 42 })].map((s) => flat([s])[0]), d15, '#2f6fde'),
    ...strokes(hw('U', 830, -2190, 24), d15, '#2f6fde'),
    { kind: 'text', x: 20, y: -1850, w: 560, content: '## Lecture 6 · Characteristic polynomial\n$p_A(\\lambda) = \\det(A - \\lambda I)$, and its roots are the eigenvalues.\n- [x] Read Axler 5A\n- [ ] Problem 5A.4', created: d20 },
    ...strokes(hw('p(λ) = (2 − λ)^2 − 1', 40, -1580, 30), d20),
    ...strokes(hw('= (λ − 1)(λ − 3)', 72, -1520, 30), d20),
    ...strokes(hw('λ = 1, 3', 620, -1550, 30), d20, '#c93a32'),
  ]);
  // today's lecture starts below
  await app.page.keyboard.press('Escape');
  await app.page.locator('.cv-root').first().focus();
  await app.page.keyboard.press('Home');
  await app.settle(600);
  await app.page.evaluate(() => document.activeElement?.blur());
}

export const TODAY_LINE = -1380;

/**
 * Today's lecture as the canvas segment leaves it (seeded, not drawn): the day line, the
 * handwritten equations, the text box with its to-dos. The view shows it at the top.
 */
export async function seedToday(app) {
  const L = TODAY_LINE;
  const now = Date.now();
  await app.page.evaluate((L) => window.__slateCanvas.main.ctl.model.transact((tx) => tx.setDay(new Date().toLocaleDateString('sv-SE'), L)), L);
  const hw = (text, x, y, size, opts = {}) => flat(handwrite(text, x, y, size, { seed: Math.round(x * 3 + y), ...opts }).strokes);
  const strokes = (list, color = 'currentInk', size = 2.5, tool = 'pen') => list.map((pts) => ({ kind: 'stroke', pts, created: now, color, size, tool }));
  await app.seed([
    ...strokes(hw('Eigenvalues', 50, L + 85, 33)),
    ...strokes(flat(roughLine(46, L + 100, 280, L + 101, { seed: 5 }))),
    ...strokes(hw('Av = λv', 220, L + 150, 27), '#8e4ec6', 2.8),
    { kind: 'stroke', pts: flat(roughLine(66, L + 205, 316, L + 203, { seed: 3 }))[0], created: now, color: '#f5d742', size: 16, tool: 'highlighter' },
    ...strokes(hw('det(A − λI) = 0', 70, L + 220, 27), '#2f6fde', 4),
    { kind: 'text', x: 580, y: L + 20, w: 330, content: '## Lecture 7 · Eigenvalues\nRoots of $p(\\lambda) = \\det(A - \\lambda I)$\n- [x] Exercise 5A.4\n- [ ] Read Axler 5B', created: now },
  ]);
  await showToday(app);
}

/** Puts today's line near the top of the main canvas view. */
export async function showToday(app, offset = 30) {
  await app.canvas((h, [L, off]) => {
    const k = h.engine.pxPerUnit;
    h.engine.setCamera({ x: h.engine.camera.x, y: L - off / k, zoom: 1 }, false);
  }, [TODAY_LINE, offset]);
  await app.settle(400);
}
