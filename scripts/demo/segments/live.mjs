/**
 * Opening: the live app loading at its GitHub Pages address (nothing is entered there).
 */
import { join } from 'node:path';
import { Director } from '../lib/input.mjs';
import { Recorder } from '../lib/recorder.mjs';
import { OVERLAY } from '../lib/session.mjs';
import { sleep } from '../lib/util.mjs';
import { finish } from './common.mjs';

export const LIVE_URL = 'https://preetsingh-007.github.io/slate/';

export default {
  id: 'live',
  title: 'The live app',
  trailer: [],
  async run(env) {
    const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
    const ctx = await env.browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3, proxy });
    await ctx.addInitScript({ content: OVERLAY });
    const page = await ctx.newPage();
    await page.setContent('<body style="margin:0;background:#fbfaf7"></body>');
    const rec = new Recorder(page, join(env.work, 'frames', 'live'));
    const d = new Director(page, rec);
    const s = { page, ctx, rec, d, id: 'live' };
    await rec.start();
    await sleep(300);
    await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('dialog').first().waitFor({ timeout: 30_000 }).catch(() => {});
    await d.caption({ kicker: 'Live on GitHub Pages', title: 'preetsingh-007.github.io/slate', body: 'Runs in the browser and installs on the iPad’s Home Screen. The first run asks for your gym repository — set-up is at the end.' });
    await sleep(4600);
    return finish(env, s);
  },
};
