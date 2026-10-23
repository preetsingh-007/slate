/**
 * Title and end cards: small HTML pages in the app's colours with CSS animations, recorded
 * with the same screencast as the app so they match its resolution and frame rate.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Recorder } from './recorder.mjs';
import { sleep } from './util.mjs';

const ICON = readFileSync(new URL('../../../public/icon.svg', import.meta.url), 'utf8');

const BASE = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: #fbfaf7; color: #1f2328; font-family: Inter, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.grid { position: fixed; inset: -40px; background-image: linear-gradient(#ece9e2 1px, transparent 1px), linear-gradient(90deg, #ece9e2 1px, transparent 1px); background-size: 48px 48px; opacity: .55; animation: drift 9s linear forwards; }
@keyframes drift { to { transform: translate(-24px, -18px); } }
.wrap { position: relative; text-align: center; }
.icon { width: 112px; height: 112px; margin: 0 auto 26px; opacity: 0; animation: up .7s .1s ease forwards; filter: drop-shadow(0 10px 22px rgba(31,35,40,.25)); }
.icon svg { width: 100%; height: 100%; }
h1 { font-size: 92px; font-weight: 750; letter-spacing: -.035em; margin: 0; line-height: 1; opacity: 0; animation: up .7s .25s ease forwards; }
.tag { font-size: 34px; font-weight: 500; color: #3b434c; margin-top: 16px; letter-spacing: -.01em; opacity: 0; animation: up .7s .45s ease forwards; }
.line { font-size: 21px; color: #626a73; margin: 26px auto 0; max-width: 860px; line-height: 1.5; opacity: 0; animation: up .7s .7s ease forwards; }
.url { display: inline-block; margin-top: 34px; font-size: 30px; font-weight: 600; color: #fff; background: #1f2328; padding: 14px 30px; border-radius: 14px; opacity: 0; animation: up .7s .6s ease forwards; letter-spacing: -.005em; }
.steps { margin-top: 26px; font-size: 20px; color: #57606a; opacity: 0; animation: up .7s .9s ease forwards; }
.steps b { color: #1f2328; font-weight: 600; }
.ink { position: absolute; left: 50%; bottom: -46px; width: 420px; margin-left: -210px; height: 20px; }
.ink path { stroke: #e8b04a; stroke-width: 6; fill: none; stroke-linecap: round; stroke-dasharray: 520; stroke-dashoffset: 520; animation: draw 1.1s .55s ease forwards; }
@keyframes up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes draw { to { stroke-dashoffset: 0; } }
`;

export function titleHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}</style></head><body><div class="grid"></div><div class="wrap">
<div class="icon">${ICON}</div>
<h1>Slate</h1>
<div class="tag">an infinite canvas for study work</div>
<div class="line">Write with the Pencil, read papers and books beside it, lasso anything onto the canvas with a link back to its source, and keep it all in your gym repository on GitHub.</div>
</div></body></html>`;
}

export function endHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}</style></head><body><div class="grid"></div><div class="wrap">
<div class="icon">${ICON}</div>
<h1>Slate</h1>
<div class="url">preetsingh-007.github.io/slate</div>
<div class="steps">Open it in Safari → <b>Share</b> → <b>Add to Home Screen</b>. Works offline; syncs to gym.</div>
</div></body></html>`;
}

/** Records an animated card for `seconds`. */
export async function recordCard(env, html, out, seconds) {
  const ctx = await env.browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
  const page = await ctx.newPage();
  // start blank, then load the card so its animations run while recording
  await page.setContent('<body style="background:#fbfaf7;margin:0"></body>');
  const rec = new Recorder(page, join(env.work, 'frames', out.replace(/\W+/g, '_')));
  await rec.start();
  await page.setContent(html);
  await sleep(seconds * 1000);
  await rec.stop();
  await rec.encode(out);
  await ctx.close();
  return { file: out, marks: [] };
}
