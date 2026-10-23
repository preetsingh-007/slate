/**
 * Set-up, step by step: install on the iPad (an illustration), then the first run on the test
 * build against the mocked GitHub: the token instructions, repository, branch and an obviously
 * fake token, verification and the first sync; then the optional fetch helper.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Recorder } from '../lib/recorder.mjs';
import { DEMO_BRANCH, DEMO_REPO, DEMO_TOKEN, HELPER_KEY } from '../lib/server.mjs';
import { HELPER_URL, OVERLAY } from '../lib/session.mjs';
import { ffmpeg, sleep } from '../lib/util.mjs';
import { begin, finish } from './common.mjs';

const K = 'Set up';
const ICON = readFileSync(new URL('../../../public/icon.svg', import.meta.url), 'utf8');

const installCard = () => `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; }
body { background: radial-gradient(circle at 30% 40%, #fff, #eceae4 70%); font-family: Inter, system-ui, sans-serif; color: #1f2328; overflow: hidden; }
.ipad { position: absolute; left: 110px; top: 150px; width: 640px; height: 470px; border-radius: 36px; background: #1f2328; box-shadow: 0 30px 60px rgba(31,35,40,.25); }
.scr { position: absolute; inset: 16px; border-radius: 22px; background: linear-gradient(135deg, #b9c7e8, #e8d5c0); overflow: hidden; }
.bar { position: absolute; left: 0; right: 0; top: 0; height: 54px; background: rgba(255,255,255,.88); display: flex; align-items: center; gap: 12px; padding: 0 16px; }
.url { flex: 1; height: 32px; border-radius: 10px; background: #eef0f3; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #3b434c; }
.share { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; color: #2f6fde; animation: pulse 1s 1.2s 2; }
.sheet { position: absolute; right: 18px; top: 64px; width: 250px; border-radius: 14px; background: #fff; box-shadow: 0 12px 30px rgba(0,0,0,.18); opacity: 0; animation: show .4s 2.2s forwards; font-size: 15px; }
.sheet div { padding: 11px 16px; border-top: 1px solid #eceef1; display: flex; justify-content: space-between; }
.sheet div:first-child { border-top: 0; }
.sheet .hl { background: #e8f0fd; color: #1d4fb0; font-weight: 600; }
.grid { position: absolute; left: 40px; top: 120px; display: grid; grid-template-columns: repeat(6, 64px); gap: 26px 30px; opacity: 0; animation: show .5s 3.6s forwards; }
.app { width: 64px; height: 64px; border-radius: 15px; background: rgba(255,255,255,.55); }
.slate { background: none; animation: pop .5s 4.0s both; }
.slate svg { width: 64px; height: 64px; }
.lbl { font-size: 12px; text-align: center; margin-top: 4px; color: #1f2328; }
.steps { position: absolute; left: 820px; top: 210px; width: 520px; }
.k { font-size: 14px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #2f6fde; }
.t { font-size: 38px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; margin: 10px 0 22px; }
.s { display: flex; gap: 14px; font-size: 20px; line-height: 1.4; margin: 14px 0; opacity: 0; animation: show .5s forwards; }
.s b { font-weight: 600; } .n { flex: none; width: 30px; height: 30px; border-radius: 50%; background: #1f2328; color: #fff; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
@keyframes show { to { opacity: 1; } }
@keyframes pop { from { transform: scale(.2); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes pulse { 50% { background: #dbe6fb; } }
</style></head><body>
<div class="ipad"><div class="scr">
  <div class="bar"><div class="url">preetsingh-007.github.io/slate</div><div class="share"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></div></div>
  <div class="sheet"><div>Copy</div><div>Add Bookmark</div><div class="hl">Add to Home Screen <span>⊞</span></div><div>Find on Page</div></div>
  <div class="grid">${Array.from({ length: 9 }, () => '<div class="app"></div>').join('')}<div><div class="app slate">${ICON}</div><div class="lbl">Slate</div></div></div>
</div></div>
<div class="steps"><div class="k">Set up · on the iPad</div><div class="t">Install Slate</div>
<div class="s" style="animation-delay:.3s"><span class="n">1</span><span>Open <b>preetsingh-007.github.io/slate</b> in Safari.</span></div>
<div class="s" style="animation-delay:1.3s"><span class="n">2</span><span>Tap <b>Share</b>, then <b>Add to Home Screen</b>.</span></div>
<div class="s" style="animation-delay:3.5s"><span class="n">3</span><span>Open Slate from its icon: full screen, and offline after the first visit.</span></div>
</div></body></html>`;

export default {
  id: 'setup',
  title: 'Set up: install, token, repository, fetch helper',
  trailer: [],
  async run(env) {
    // ---------------------------------------------------------------- 1. install (illustration)
    env.api.html['/demo/install.html'] = installCard();
    const ctx0 = await env.browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
    await ctx0.addInitScript({ content: OVERLAY });
    const p0 = await ctx0.newPage();
    await p0.goto(`${env.apiUrl}/demo/blank`).catch(() => {});
    await p0.setContent('<body style="margin:0;background:#f4f3ef"></body>');
    const r0 = new Recorder(p0, join(env.work, 'frames', 'setup-install'));
    await p0.evaluate((c) => window.__demo?.section(c, 0), { num: 'Part 7', title: 'Set up on your iPad', sub: 'Install the app, connect your gym repository, and optionally the fetch helper.' }).catch(() => {});
    await r0.start();
    await sleep(1800);
    await p0.goto(`${env.apiUrl}/demo/install.html`);
    await sleep(7600);
    await r0.stop();
    const installClip = join(env.work, 'setup-install.mp4');
    await r0.encode(installClip, { fadeOut: 0.25 });
    await ctx0.close();

    // ---------------------------------------------------------------- 2. first run
    const s = await begin(env, 'setup', { connect: false, path: '/?onboarding=1' });
    const { page, app, d, rec } = s;
    d.capPos = 'right';
    const dialog = page.getByRole('dialog', { name: 'Welcome to Slate' });
    await dialog.waitFor();
    // test build only: this device's sync talks to the mocked GitHub
    await page.evaluate((apiBase) => window.__slate.settings.setSecrets({ apiBase }), `${env.apiUrl}/github`);
    await sleep(500);
    await rec.start();
    rec.mark('First run: the token');
    await d.caption({ kicker: K, title: 'First run: Slate shows how to make a GitHub token', body: 'A **fine-grained** token for **only your gym repository**: Contents **read and write**, Metadata **read-only**, nothing else.' });
    const steps = dialog.locator('.sync-steps li');
    for (const i of [0, 3, 4, 5]) {
      await d.hover(steps.nth(i), 500);
      await sleep(i === 4 ? 2600 : 1500);
    }
    rec.mark('Repository and branch');
    await d.caption({ kicker: K, title: 'Enter the repository, the branch and the token', body: `Repository \`${DEMO_REPO}\`, branch \`${DEMO_BRANCH}\` (gym’s default branch). The token here is a fake for this demo.` });
    await d.click(dialog.getByLabel('Repository (owner/name)'));
    await d.type(DEMO_REPO, { delay: 45 });
    await d.click(dialog.getByLabel('Branch'));
    await page.keyboard.press('Control+a');
    await d.type(DEMO_BRANCH, { delay: 35 });
    await d.click(dialog.getByLabel('Fine-grained personal access token'));
    await d.type(DEMO_TOKEN, { delay: 14 });
    await sleep(500);
    rec.mark('Verify and connect');
    await d.caption({ kicker: K, title: 'Verify and connect', body: 'Slate checks that the token can write to the repository, then syncs for the first time. The token stays on this device.' });
    await d.click(dialog.getByRole('button', { name: 'Verify and connect' }));
    await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
    await app.waitSynced();
    await sleep(1200);
    await d.hover(page.getByTestId('sync-status'), 600);
    await sleep(1600);

    // ---------------------------------------------------------------- 3. fetch helper
    rec.mark('Optional: the fetch helper');
    await d.caption({ kicker: K, title: 'Optional: the fetch helper for New from link', body: 'Deploy it once (free): `cd worker && npx wrangler deploy` — see worker/README.md. Then **Settings → Fetch helper**.' });
    await d.click(page.getByTestId('settings-button'));
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.waitFor();
    const url = settings.getByLabel('Helper URL');
    await url.scrollIntoViewIfNeeded();
    await sleep(600);
    await d.click(url);
    await page.keyboard.press('Control+a');
    await d.type(HELPER_URL.replace(/\/$/, ''), { delay: 30 });
    await d.click(settings.getByLabel('Helper key'));
    await page.keyboard.press('Control+a');
    await d.type(HELPER_KEY, { delay: 60 });
    await d.click(settings.getByRole('button', { name: 'Save helper' }));
    await sleep(2200);
    await d.press('Escape');
    await d.caption({ kicker: K, title: 'Ready', body: 'Everything stays on the device and syncs to gym. Slate writes only `journal/` and `library/`.' });
    await sleep(2600);
    const r = await finish(env, s);

    // the install illustration, then the first run
    const both = join(env.work, 'setup-both.mp4');
    const list = join(env.work, 'setup.ffconcat');
    (await import('node:fs')).writeFileSync(list, `ffconcat version 1.0\nfile '${installClip}'\nfile '${r.file}'\n`);
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', both]);
    (await import('node:fs')).renameSync(both, r.file);
    const offset = r0.end;
    return { ...r, marks: [{ name: 'Install on the iPad', t: 0.5 }, ...r.marks.map((m) => ({ ...m, t: m.t + offset }))] };
  },
};
