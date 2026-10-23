/**
 * Slate at iPhone width (P2): one pane at a time, the layers button to switch, captures in the
 * carry tray until they are dropped on the canvas. The app runs at 390 × 844 in a frame on a
 * host page that also carries the explanation.
 */
import { join } from 'node:path';
import { Director } from '../lib/input.mjs';
import { Recorder } from '../lib/recorder.mjs';
import { App, OVERLAY, routeHelper } from '../lib/session.mjs';
import { sleep } from '../lib/util.mjs';
import { finish, seedToday, showToday } from './common.mjs';

const host = (appUrl) => `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; }
body { background: radial-gradient(circle at 30% 40%, #ffffff, #eceae4 70%); font-family: Inter, system-ui, sans-serif; color: #1f2328; overflow: hidden; }
.phone { position: absolute; left: 250px; top: 22px; width: 359px; height: 750px; border-radius: 52px; background: #1f2328; box-shadow: 0 30px 60px rgba(31,35,40,.28), inset 0 0 0 2px #3a4048; }
.screen { position: absolute; left: 12px; top: 12px; width: 335px; height: 726px; border-radius: 41px; overflow: hidden; background: #fbfaf7; }
iframe { border: 0; width: 390px; height: 844px; transform: scale(0.859); transform-origin: 0 0; }
.info { position: absolute; left: 720px; top: 250px; width: 600px; }
.k { font-size: 14px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #2f6fde; }
.t { font-size: 40px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; margin-top: 10px; }
.b { font-size: 21px; color: #57606a; line-height: 1.5; margin-top: 16px; }
.b b { color: #1f2328; }
.info > * { transition: opacity .35s; }
</style></head><body>
<div class="phone"><div class="screen"><iframe src="${appUrl}/" allow="clipboard-read; clipboard-write"></iframe></div></div>
<div class="info"><div class="k">On iPhone</div><div class="t" id="t"></div><div class="b" id="b"></div></div>
<script>
window.setInfo = (t, b) => {
  const T = document.getElementById('t'), B = document.getElementById('b');
  T.style.opacity = B.style.opacity = 0;
  setTimeout(() => { T.innerHTML = t; B.innerHTML = b; T.style.opacity = B.style.opacity = 1; }, 300);
};
</script></body></html>`;

export default {
  id: 'phone',
  title: 'iPhone-width layout',
  trailer: [[1, 7]],
  async run(env) {
    env.api.html['/demo/phone.html'] = host(env.appUrl);
    const ctx = await env.browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3, baseURL: env.appUrl });
    await ctx.addInitScript({ content: OVERLAY });
    await routeHelper(ctx, env);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
    await page.goto(`${env.apiUrl}/demo/phone.html`);
    let frame;
    for (let i = 0; i < 100 && !frame; i++) {
      frame = page.frames().find((f) => f.url().startsWith(env.appUrl));
      if (!frame) await sleep(100);
    }
    await frame.waitForFunction(() => !!window.__slate && !!window.__slateUi);
    const app = new App(frame, env);
    await app.connect();
    await app.waitCanvas();
    await seedToday(app);
    await app.canvas((h) => h.engine.setCamera({ x: 20, y: h.engine.camera.y - 20, zoom: 2.4 }, false));
    await app.settle(500);
    const rec = new Recorder(page, join(env.work, 'frames', 'phone'));
    const d = new Director(page, rec);
    d.syncPointer = true; // input inside the frame does not reach the host page's pointer
    const s = { page, ctx, rec, d, id: 'phone' };
    const info = (t, b) => page.evaluate(([t, b]) => window.setInfo(t, b), [t, b]);
    const side = frame.locator('.pane-slot:not([hidden])');

    await info('One pane at a time', 'On a phone or in Slide Over, the canvas and the side pane take turns. The <b>layers</b> button switches between them.');
    await sleep(500);
    await rec.start();
    rec.mark('iPhone width');
    await sleep(2200);
    await d.click(frame.getByRole('button', { name: 'Gym', exact: true }));
    await sleep(1200);
    await d.click(side.getByRole('button', { name: /Eigenvalues active/ }));
    await sleep(900);
    await d.click(side.getByRole('button', { name: 'notes.md' }));
    await side.locator('.gym-md .katex').first().waitFor();
    await sleep(1200);

    await info('Captures wait in the carry tray', 'Lasso something in the side pane, switch to the canvas, and drag it from the tray to where it belongs.');
    await d.click(side.getByRole('button', { name: 'Rectangle lasso' }));
    const para = side.locator('.gym-md p', { hasText: 'is an eigenvalue of' }).first();
    const b = await para.boundingBox();
    await d.drag([b.x - 4, b.y - 4], [b.x + b.width + 4, b.y + b.height + 4], { ms: 900 });
    await sleep(900);
    const send = side.getByRole('region', { name: 'Captures' }).getByRole('button', { name: 'Send to canvas' }).or(frame.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }));
    await d.click(send.first());
    await sleep(900);
    await d.click(frame.getByRole('button', { name: 'Show canvas' }));
    await sleep(1200);
    const card = frame.locator('.cv-carry-card').first();
    const cb = await card.boundingBox();
    await d.drag([cb.x + 14, cb.y + 10], [cb.x + 60, cb.y - 240], { ms: 1200, hold: 80 });
    await sleep(2200);
    return finish(env, s);
  },
};
