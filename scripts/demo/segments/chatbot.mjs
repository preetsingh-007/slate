/**
 * W3 · A chatbot answer and a web article: New from clipboard renders the copied answer as
 * Markdown with maths; a lassoed part is dragged onto the canvas. New from link saves an
 * article (through the fake fetch helper) with Reader and Original views.
 */
import { chatbotAnswer, ARTICLE_URL } from '../lib/content.mjs';
import { sleep } from '../lib/util.mjs';
import { begin, finish, seedHistory, seedToday, start } from './common.mjs';

const K = 'W3 · Chatbot answers and web pages';

export default {
  id: 'chatbot',
  title: 'Chatbot answers and web pages (W3)',
  trailer: [
    [3, 8],
    [10.5, 15],
  ],
  async run(env) {
    const s = await begin(env, 'chatbot');
    const { page, app, d, rec } = s;
    d.capPos = 'left';
    await seedHistory(app);
    await seedToday(app);
    const side = page.locator('.pane-slot:not([hidden])');
    const { html, text } = chatbotAnswer();
    await page.evaluate(async ({ html, text }) => {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
    }, { html, text });

    await start(s, { num: 'Part 3', title: 'Chatbot answers and web pages', sub: 'Keep the useful part of an answer or an article, with its maths and a link back.' });

    // ---------------------------------------------------------------- New from clipboard
    rec.mark('New from clipboard');
    await d.caption({ kicker: K, title: 'Copy the answer in the chatbot’s app → New from clipboard', body: 'It becomes a clipping, rendered as Markdown with maths (⌃⇧V or ⌘⇧V).' });
    await d.click(page.getByRole('button', { name: 'New from clipboard' }));
    await page.locator('.clip-article .katex').first().waitFor();
    await app.canvas((h) => h.engine.setCamera({ x: -10, y: h.engine.camera.y - 10, zoom: 0.66 }, false));
    await sleep(2600);

    // lasso the derivation and drag it onto the canvas
    rec.mark('Lasso part of it onto the canvas');
    await d.caption({ kicker: K, title: 'Lasso the part you need and drag it onto the canvas', body: 'Text and maths come along as Markdown; the clip links back to the answer.' });
    await d.click(side.getByRole('button', { name: 'Lasso', exact: true }));
    const eq = side.locator('.clip-article .katex-display').first();
    const para = side.locator('.clip-article p').nth(2);
    const a = await eq.boundingBox();
    const b = await para.boundingBox();
    const box = { x: Math.min(a.x, b.x) - 8, y: a.y - 8, w: Math.max(a.width, b.width) + 16, h: b.y + b.height - a.y + 14 };
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const t = -Math.PI / 2 - (i / 28) * Math.PI * 2;
      pts.push([box.x + box.w / 2 + (box.w / 2 + 6) * Math.cos(t) * 1.03, box.y + box.h / 2 + (box.h / 2 + 6) * Math.sin(t) * 1.1]);
    }
    await d.drag(pts[0], pts.slice(1), { ms: 1300, hold: 60 });
    const preview = page.getByTestId('capture-preview');
    await preview.waitFor({ timeout: 15_000 });
    await sleep(1000);
    const head = preview.locator('.cap-head');
    const hb = await head.boundingBox();
    const cv = await page.locator('.pane-canvas .cv-root').boundingBox();
    await d.drag([hb.x + 60, hb.y + hb.height / 2], [[hb.x - 200, hb.y + 40], [cv.x + 120, cv.y + cv.height * 0.62]], { ms: 1500, hold: 150 });
    await sleep(1600);

    // ---------------------------------------------------------------- New from link
    rec.mark('New from link: Reader and Original');
    await d.caption({ kicker: K, title: 'New from link saves a web article', body: 'Your own small fetch helper downloads the page; Slate keeps a **Reader** view and the **Original**.' });
    await d.click(page.getByRole('button', { name: 'New from link' }));
    const dialog = page.getByRole('dialog', { name: 'New from link' });
    await d.click(dialog.getByRole('textbox', { name: 'Web address' }));
    await d.type(ARTICLE_URL, { delay: 22 });
    await sleep(300);
    await d.click(dialog.getByRole('button', { name: 'Save', exact: true }));
    await rec.cut(async () => {
      await side.locator('.clip-article h2, .clip-article p').first().waitFor({ timeout: 20_000 });
      await sleep(500);
    });
    await sleep(1800);
    await d.hover([1150, 520]);
    await d.wheel(0, 380, { ms: 900 });
    await sleep(900);
    await d.caption({ kicker: K, title: 'Original: the saved page as it looked', body: 'A sealed copy that opens offline; its scripts stay off unless you allow them.' });
    await d.click(side.getByRole('radio', { name: 'Original' }));
    await page.frameLocator('[data-testid="snapshot-frame"]').locator('h1').waitFor({ timeout: 20_000 });
    await sleep(2800);

    return finish(env, s);
  },
};
