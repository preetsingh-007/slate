/**
 * A fresh browser context on the demo build for one segment: the overlay installed, the app
 * loaded with empty storage, connected (optionally) to the mocked GitHub and the fake fetch
 * helper, and helpers to reach the canvas through the test hooks of the SLATE_E2E build.
 */
import { readFileSync } from 'node:fs';
import { DEMO_BRANCH, DEMO_REPO, DEMO_TOKEN, HELPER_KEY } from './server.mjs';
import { sleep } from './util.mjs';

export const OVERLAY = readFileSync(new URL('./overlay.js', import.meta.url), 'utf8');

export const VIEWPORT = { width: 1440, height: 810 };
/** The fetch helper's address as the owner would have it; requests to it are served locally. */
export const HELPER_URL = 'https://slate-fetch.demo.workers.dev/';

export async function newSession(env, { viewport = VIEWPORT, scale = 4 / 3, colorScheme = 'light', connect = true, path = '/', hasTouch = false, isMobile = false } = {}) {
  const ctx = await env.browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    hasTouch,
    isMobile,
    colorScheme,
    baseURL: env.appUrl,
    reducedMotion: 'no-preference',
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.appUrl });
  await ctx.addInitScript({ content: OVERLAY });
  await routeHelper(ctx, env);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) console.log(`  [console] ${m.text().slice(0, 300)}`);
  });
  await page.goto(path);
  await page.waitForFunction(() => !!window.__slate && !!window.__slateUi);
  const app = new App(page, env);
  if (connect) await app.connect();
  return { ctx, page, app };
}

/** Serves requests to the owner's fetch helper address from the local fake helper. */
export async function routeHelper(ctx, env) {
  await ctx.route(`${HELPER_URL}**`, async (route) => {
    const u = new URL(route.request().url());
    const response = await route.fetch({ url: `${env.apiUrl}/helper/${u.search}` });
    await route.fulfill({ response });
  });
}

export class App {
  constructor(page, env) {
    this.page = page;
    this.env = env;
  }

  /** Points sync at the mocked GitHub and the fetch helper at the fake one, and syncs once. */
  async connect() {
    const { page, env } = this;
    await page.evaluate(
      async ([apiBase, helperUrl, helperKey, token, repo, branch]) => {
        const s = window.__slate;
        await s.settings.setSecrets({ apiBase, helperUrl, helperKey });
        const r = await s.sync.connect({ token, repo, branch });
        if (!r.ok) throw new Error(`connect failed: ${r.error}`);
      },
      [`${env.apiUrl}/github`, HELPER_URL, HELPER_KEY, DEMO_TOKEN, DEMO_REPO, DEMO_BRANCH],
    );
    await this.waitSynced();
    // gym's files are mirrored after the first pull
    await page.waitForFunction(async () => !!(await window.__slate.gymFiles?.readText?.('math/linear-algebra/eigenvalues/notes.md').catch(() => null)), null, { timeout: 30_000 });
  }

  async waitSynced(timeout = 30_000) {
    await this.page.locator('[data-testid="sync-status"][data-phase="synced"]').waitFor({ timeout });
  }

  /** Runs a sync now (pull and push) and waits for it. */
  async syncNow() {
    await this.page.evaluate(() => window.__slate.sync.sync());
    await this.waitSynced();
  }

  async waitCanvas(slug = 'main') {
    await this.page.locator(`.cv-view[data-canvas="${slug}"][data-ready="true"]`).first().waitFor();
  }

  /** Evaluates fn(h) against a canvas's test hook ({ ctl, engine, api }). */
  canvas(fn, arg, slug = 'main') {
    return this.page.evaluate(
      ([slug, fn, arg]) => {
        const h = window.__slateCanvas[slug];
        return new Function('h', 'arg', `return (${fn})(h, arg)`)(h, arg);
      },
      [slug, fn.toString(), arg ?? null],
    );
  }

  /** Client position of a canvas point. */
  async toClient(x, y, slug = 'main') {
    const box = await this.page.locator(`.cv-view[data-canvas="${slug}"] .cv-root`).first().boundingBox();
    const [sx, sy] = await this.canvas((h, [x, y]) => {
      const c = h.engine.camera;
      const k = c.zoom * h.engine.base;
      return [(x - c.x) * k, (y - c.y) * k];
    }, [x, y], slug);
    return [box.x + sx, box.y + sy];
  }

  /** Canvas point under a client position. */
  async toCanvas(cx, cy, slug = 'main') {
    return this.canvas((h, [x, y]) => h.engine.clientToCanvas(x, y), [cx, cy], slug);
  }

  async objects(slug = 'main') {
    return this.canvas((h) => [...h.ctl.model.objects()].map((o) => JSON.parse(JSON.stringify(o))), null, slug);
  }

  /**
   * Adds objects (canvas units) through the controller, as the canvas tests' seed() does;
   * strokes get their frame from their points. Returns the ids.
   */
  async seed(specs, slug = 'main') {
    return this.page.evaluate(
      ([slug, specs]) => {
        const h = window.__slateCanvas[slug];
        let z = h.ctl.model.topZ();
        const out = specs.map((s, i) => {
          const now = s.created ?? Date.now();
          const o = { id: `d${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`, rotation: 0, created: now, edited: now, device: h.ctl.device, topics: [], ...s, z };
          z += 'i';
          if (s.kind === 'stroke') {
            const p = s.pts;
            const xs = p.filter((_, j) => j % 3 === 0);
            const ys = p.filter((_, j) => j % 3 === 1);
            Object.assign(o, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), tool: s.tool ?? 'pen', color: s.color ?? '#1f2328', size: s.size ?? 2.5 });
          }
          if (s.kind === 'text') Object.assign(o, { fontSize: 18, h: 30, ...s });
          return o;
        });
        h.ctl.addObjects(out);
        return out.map((o) => o.id);
      },
      [slug, specs],
    );
  }

  async frames(n = 2) {
    await this.page.evaluate((n) => new Promise((r) => {
      let i = 0;
      const f = () => (++i >= n ? r() : requestAnimationFrame(f));
      requestAnimationFrame(f);
    }), n);
  }

  async settle(ms = 300) {
    await this.frames(2);
    await sleep(ms);
  }
}
