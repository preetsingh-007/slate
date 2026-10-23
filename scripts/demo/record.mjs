#!/usr/bin/env node
/**
 * Records the Slate demo video: builds the test build (SLATE_E2E=1), serves it with a mocked
 * GitHub and a fake fetch helper, drives the app segment by segment in Chromium with real pen,
 * mouse and keyboard input, records each segment with the DevTools screencast, and assembles
 * the full video, a short trailer, a poster and the chapter list with ffmpeg.
 *
 *   npm run demo:record                      everything
 *   npm run demo:record -- --only canvas,paper   re-record some segments, reuse the others
 *   npm run demo:record -- --assemble        only assemble from the recorded segments
 *   options: --out <dir> (default ../slate-demo), --no-build, --app-port, --api-port
 *
 * See scripts/demo/README.md.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { assemble, clipParts } from './lib/assemble.mjs';
import { endHtml, recordCard, titleHtml } from './lib/cards.mjs';
import { gymFiles, makeAssets, webPages } from './lib/content.mjs';
import { startServer } from './lib/server.mjs';
import { run, serve } from './lib/util.mjs';
import { SEGMENTS } from './segments/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const out = resolve(opt('out', join(root, '..', 'slate-demo')));
const work = resolve(opt('work', join(root, 'node_modules', '.cache', 'slate-demo')));
const appPort = Number(opt('app-port', 4310));
const apiPort = Number(opt('api-port', 4610));
const only = opt('only', '')
  .split(',')
  .filter(Boolean);
const dist = join(work, 'dist');
// finished segment videos go straight to the output folder, so an interrupted run keeps them
const clips = join(out, 'segments');
for (const d of [out, work, clips]) mkdirSync(d, { recursive: true });

const chromiumPath = process.env.SLATE_CHROMIUM ?? '/opt/pw-browsers/chromium';

async function main() {
  if (flag('assemble')) return finish();

  if (!flag('no-build') || !existsSync(join(dist, 'index.html'))) {
    console.log('Building the test build (SLATE_E2E=1)…');
    await run('node', ['scripts/copy-pdfjs-assets.mjs'], { cwd: root });
    await run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: root, env: { SLATE_E2E: '1' } });
  }
  const preview = await serve('npx', ['vite', 'preview', '--outDir', dist, '--port', String(appPort), '--strictPort'], { cwd: root, ready: /localhost:\d+/ });

  const browser = await chromium.launch({
    executablePath: existsSync(chromiumPath) ? chromiumPath : undefined,
    // frames at 1920×1080 for a 1440×810 layout (the screencast follows the window's scale)
    args: ['--force-device-scale-factor=1.3333333', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const assetsDir = join(work, 'assets');
  console.log('Making the demo content…');
  const assets = await makeAssets(browser, assetsDir);
  const pages = await webPages(browser, assetsDir);
  const api = await startServer({ port: apiPort, gymFiles: gymFiles(), pages });
  const env = { browser, root, work, clips, assets, appUrl: `http://localhost:${appPort}`, apiUrl: `http://localhost:${apiPort}`, api };

  try {
    const todo = SEGMENTS.filter((s) => !only.length || only.includes(s.id));
    if (!only.length || only.includes('title')) await recordCard(env, titleHtml(), join(clips, 'title.mp4'), 5.2);
    if (!only.length || only.includes('end')) await recordCard(env, endHtml(), join(clips, 'end.mp4'), 5);
    for (const s of todo) {
      console.log(`Recording ${s.id}…`);
      const t0 = Date.now();
      await fetch(`${env.apiUrl}/github/__demo/reset`, { method: 'POST' });
      const result = await s.run(env);
      writeFileSync(join(clips, `${s.id}.json`), JSON.stringify(result, null, 2));
      rmSync(join(work, 'frames'), { recursive: true, force: true });
      console.log(`  done in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  } finally {
    await browser.close();
    await api.close();
    preview.stop();
  }
  await finish();
}

async function finish() {
  const parts = clipParts(clips, SEGMENTS);
  const missing = parts.filter((p) => !existsSync(p.file));
  if (missing.length) {
    console.log(`Not assembled yet; still to record: ${missing.map((p) => p.id).join(', ')}`);
    return;
  }
  await assemble(parts, { out, work });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
