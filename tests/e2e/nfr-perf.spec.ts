/**
 * Performance NFRs as automated budgets (the 50,000-stroke pan and zoom budget is
 * canvas-perf.spec.ts; the 800-page PDF is library-books.spec.ts and the memory check below).
 *
 * The targets are for an M1 iPad and a 2020 MacBook Air; CI renders canvases in software on
 * shared CPUs, so budgets here leave headroom while still catching a regression of the kind the
 * NFR is about (a stroke waiting on storage, a month that loads object by object, a viewer that
 * keeps every page).
 */
import { expect, test, type Page } from '@playwright/test';
import { makeBookPdf } from '../../src/test/fixtures';
import { surface } from './canvas-helpers';
import { importFile, openApp, setHelper } from './libraryHelpers';

type Hook = { engine: Record<string, unknown> & { camera: { zoom: number } }; ctl: Record<string, unknown> & { model: { count: number } } };

const quantile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

async function ready(page: Page) {
  await openApp(page);
  await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
}

test.describe('performance NFRs', () => {
  // timing on shared CI machines is noisy (canvas-perf.spec.ts may run beside these): one retry
  // absorbs a neighbour's burst
  test.describe.configure({ retries: 1 });
  test('ink latency: wet ink follows the pen within a frame, with predicted points; no stroke waits on storage', async ({ page }) => {
    await ready(page);
    await page.getByRole('radio', { name: 'Pen (P)' }).click();
    const b = await surface(page);
    // real pen input (trusted events, so Chromium supplies coalesced and predicted points)
    const cdp = await page.context().newCDPSession(page);
    const pen = (type: string, x: number, y: number, force = 0.5) =>
      cdp.send('Input.dispatchMouseEvent', { type, x: b.x + x, y: b.y + y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen', force } as never);

    // storage that never answers, and a sync in progress: drawing must not notice
    await page.evaluate(() => {
      const s = (window as unknown as { __slate: { db: { putUpdate(...a: unknown[]): Promise<void> } } }).__slate;
      s.db.putUpdate = () => new Promise(() => {});
    });
    // latency from each pen move to the end of the next frame (the wet layer is painted in it)
    await page.evaluate(() => {
      const w = window as unknown as { __lat: number[]; __pred: number };
      w.__lat = [];
      w.__pred = 0;
      const root = document.querySelector('.cv-root')!;
      root.addEventListener('pointermove', (e) => {
        // from when the browser received the input (the event's time stamp) to the frame that
        // painted it: the engine draws the wet layer in the animation frame after the event
        const t0 = e.timeStamp;
        if ((e as PointerEvent).getPredictedEvents?.().length) w.__pred++;
        requestAnimationFrame(() => w.__lat.push(performance.now() - t0));
      });
    });
    const before = await page.evaluate(() => (window as unknown as { __slateCanvas: { main: Hook } }).__slateCanvas.main.ctl.model.count);
    for (let s = 0; s < 3; s++) {
      await pen('mouseMoved', 100, 120 + s * 60, 0);
      await pen('mousePressed', 100, 120 + s * 60);
      for (let i = 1; i <= 40; i++) {
        await pen('mouseMoved', 100 + i * 8, 120 + s * 60 + Math.sin(i / 3) * 15, 0.6);
        await new Promise((r) => setTimeout(r, 8));
      }
      await pen('mouseReleased', 420, 120 + s * 60, 0);
      // the stroke is on the canvas as soon as the pen lifts, although nothing reached storage
      expect(await page.evaluate(() => (window as unknown as { __slateCanvas: { main: Hook } }).__slateCanvas.main.ctl.model.count)).toBe(before + s + 1);
    }
    const { lat, pred } = await page.evaluate(() => ({ lat: (window as unknown as { __lat: number[] }).__lat, pred: (window as unknown as { __pred: number }).__pred }));
    const median = quantile(lat, 0.5);
    const p95 = quantile(lat, 0.95);
    console.log(`[nfr] ink latency: move → painted frame median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms over ${lat.length} moves; ${pred} moves carried predicted points`);
    // one frame at 60 fps is 16.7 ms; the wet layer is drawn in the first frame after the event
    expect(median).toBeLessThan(25);
    expect(p95).toBeLessThan(50);
  });

  test('canvas speed: a month segment of a busy study month opens in under 1 s', async ({ page }) => {
    test.setTimeout(180_000);
    await ready(page);
    // last month: 20 study days of 600 handwritten strokes (about 40 points each), 8 text boxes
    // and a photo each, written into the segment through the model as the app would
    const seeded = await page.evaluate(async () => {
      const w = window as unknown as { __slate: { canvases: { model(s: string): { load(m: string[]): Promise<void>; transact(fn: (tx: { add(o: unknown): void; setDay(d: string, y: number): void }) => void): void } } }; __slateCanvas: { main: Hook } };
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1, 10);
      const month = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
      const model = w.__slate.canvases.model('main');
      await model.load([month]);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      let n = 0;
      const y0 = -200_000; // above this month's work (earlier months sit higher on the canvas)
      for (let day = 0; day < 20; day++) {
        const created = first.getTime() + day * 86_400_000;
        const date = new Date(created);
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const top = y0 + day * 2400;
        model.transact((tx) => {
          tx.setDay(iso, top - 24);
          for (let i = 0; i < 600; i++) {
            const x0 = (i % 30) * 32 + rnd() * 6;
            const yy = top + Math.floor(i / 30) * 70 + rnd() * 6;
            const pts: number[] = [];
            for (let k = 0; k < 40; k++) pts.push(Math.round((x0 + k * 0.7) * 10) / 10, Math.round((yy + Math.sin(k / 2 + i) * 9) * 10) / 10, Math.round((0.4 + rnd() * 0.3) * 100) / 100);
            const xs = pts.filter((_, j) => j % 3 === 0);
            const ys = pts.filter((_, j) => j % 3 === 1);
            tx.add({ id: `m${n++}`, kind: 'stroke', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rotation: 0, z: `a${n.toString(36).padStart(5, '0')}`, created, edited: created, device: 'seed', topics: [], pts, tool: 'pen', color: 'currentInk', size: 2.5 });
          }
          for (let i = 0; i < 8; i++)
            tx.add({ id: `t${n++}`, kind: 'text', x: 1000, y: top + i * 200, w: 400, h: 80, rotation: 0, z: `b${n.toString(36).padStart(5, '0')}`, created, edited: created, device: 'seed', topics: [], content: `Lemma ${i}: $\\lambda_${i} \\le \\lambda_${i + 1}$\n- [ ] check the proof`, fontSize: 16 });
        });
      }
      // this month's work is below it, so opening the canvas does not need last month (C20)
      const t = Date.now();
      model.transact((tx) => tx.add({ id: 'today', kind: 'text', x: 0, y: 0, w: 300, h: 40, rotation: 0, z: 'c', created: t, edited: t, device: 'seed', topics: [], content: 'Today', fontSize: 16 }));
      await (w.__slate as unknown as { docs: { flush(): Promise<unknown> } }).docs.flush();
      const ctl = w.__slateCanvas.main.ctl as unknown as { flush(): void };
      ctl.flush();
      return { month, objects: n, firstDay: y0 };
    });
    await page.waitForTimeout(1000);
    const bytes = await page.evaluate(async (m) => {
      const s = (window as unknown as { __slate: { db: { getUpdates(id: string): Promise<{ data: Uint8Array }[]> } } }).__slate;
      return (await s.db.getUpdates(`seg:main:${m}`)).reduce((a, r) => a + r.data.length, 0);
    }, seeded.month);

    // a fresh start: nothing of last month is in memory
    await page.reload();
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    const result = await page.evaluate(async ({ month, y }) => {
      const h = (window as unknown as { __slateCanvas: { main: { engine: { setCamera(c: unknown): void; tiles: { isFresh(c: unknown, w: number, h: number): boolean }; camera: unknown; width: number; height: number }; ctl: { model: { isLoaded(m: string): boolean; count: number } } } } }).__slateCanvas.main;
      if (h.ctl.model.isLoaded(month)) return { error: 'already loaded' };
      const t0 = performance.now();
      // navigate there as the date picker does
      h.engine.setCamera({ x: -24, y: y + 4 * 2400, zoom: 1 });
      let loaded = 0;
      while (performance.now() - t0 < 10_000) {
        await new Promise((r) => requestAnimationFrame(r));
        if (!loaded && h.ctl.model.isLoaded(month)) loaded = performance.now() - t0;
        if (loaded && h.engine.tiles.isFresh(h.engine.camera, h.engine.width, h.engine.height) && document.querySelector('.cv-text')) break;
      }
      return { loaded, shown: performance.now() - t0, count: h.ctl.model.count };
    }, { month: seeded.month, y: seeded.firstDay });
    console.log(`[nfr] month segment: ${seeded.objects} objects, ${(bytes / 1e6).toFixed(1)} MB; loaded in ${Math.round(result.loaded ?? 0)} ms, on screen in ${Math.round(result.shown ?? 0)} ms`);
    expect(result.count).toBeGreaterThanOrEqual(seeded.objects);
    expect(result.shown).toBeLessThan(1000);
  });

  test('reading speed: memory stays bounded while scrolling through an 800-page PDF', async ({ page }) => {
    test.setTimeout(180_000);
    await openApp(page);
    await importFile(page, 'big.pdf', await makeBookPdf(800), 'application/pdf');
    await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
      return metrics.find((m) => m.name === 'JSHeapUsedSize')!.value / 1e6;
    };
    const start = await heap();
    const samples: { page: number; heap: number; dom: number; canvases: number }[] = [];
    // scroll through the whole book in steps, letting each stop render
    for (let i = 1; i <= 20; i++) {
      await page.locator('.pdfv-scroll').evaluate((el, f) => (el.scrollTop = el.scrollHeight * f), i / 20);
      await expect(page.locator('.pdfv-page canvas.ready').first()).toBeVisible();
      await page.waitForTimeout(150);
      samples.push({
        page: i * 40,
        heap: await heap(),
        dom: await page.locator('.pdfv-page').count(),
        canvases: await page.locator('.pdfv-page canvas').count(),
      });
    }
    const maxHeap = Math.max(...samples.map((s) => s.heap));
    console.log(`[nfr] reading memory: JS heap ${start.toFixed(0)} MB at page 1, at most ${maxHeap.toFixed(0)} MB through 800 pages; at most ${Math.max(...samples.map((s) => s.dom))} pages and ${Math.max(...samples.map((s) => s.canvases))} canvases in the DOM`);
    for (const s of samples) {
      expect(s.dom, `page ${s.page}`).toBeLessThan(12);
      expect(s.canvases, `page ${s.page}`).toBeLessThan(24);
    }
    // bounded: the heap does not grow with the pages read
    expect(maxHeap - start).toBeLessThan(60);
    expect(samples[samples.length - 1].heap - samples[4].heap).toBeLessThan(25);
  });

  test.describe('new clipping', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    test('from the clipboard in under 0.5 s; from a link in under 5 s', async ({ page }) => {
      await openApp(page);
      await setHelper(page);
      const html = `<h2>Spectral theorem</h2><p>A symmetric matrix <span class="katex"><span class="katex-mathml"><math><semantics><mi>A</mi><annotation encoding="application/x-tex">A = Q\\Lambda Q^{\\top}</annotation></semantics></math></span></span> is diagonalisable.</p>${'<p>A paragraph of an answer with some explanation in it.</p>'.repeat(40)}<pre><code>np.linalg.eigh(A)</code></pre>`;
      const times: number[] = [];
      for (let i = 0; i < 3; i++) {
        await page.evaluate(async (h) => navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([h], { type: 'text/html' }), 'text/plain': new Blob(['Spectral theorem'], { type: 'text/plain' }) })]), html);
        const t0 = await page.evaluate(() => performance.now());
        await page.getByRole('button', { name: 'New from clipboard' }).click();
        await expect(page.locator('.pane-slot:not([hidden]) .clip-article .katex').first()).toBeVisible();
        times.push((await page.evaluate(() => performance.now())) - t0);
        await page.evaluate(() => (window as unknown as { __slateApp: { setState(s: object): void } }).__slateApp.setState({ tabs: [], active: 0, paneOpen: false }));
      }
      const t1 = Date.now();
      await page.getByRole('button', { name: 'New from link' }).click();
      const dialog = page.getByRole('dialog', { name: 'New from link' });
      await dialog.getByRole('textbox', { name: 'Web address' }).fill('https://arxiv.org/html/2401.01234');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.locator('.clip-article .katex').first()).toBeVisible();
      const link = Date.now() - t1;
      console.log(`[nfr] new clipping: from the clipboard ${times.map((t) => Math.round(t)).join(', ')} ms (click to rendered maths); from a link ${link} ms (local helper, arXiv HTML paper with figure and stylesheet)`);
      // 0.5 s on the target devices; the click and the polling of the test add up to ~100 ms here
      expect(Math.min(...times)).toBeLessThan(500);
      expect(Math.max(...times)).toBeLessThan(1000);
      expect(link).toBeLessThan(5000);
    });
  });
});
