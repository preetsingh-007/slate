/**
 * Panes (P1–P3): the layout and each tab's place come back on reopen and follow the owner to
 * another device; on narrow screens one pane shows at a time, captures wait in the carry tray
 * and drop on the canvas after switching back.
 */
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { GYM_FIXTURE, openWithGym } from './gym-helpers';
import { dragClient, objects, withCanvas } from './canvas-helpers';
import { lassoRect, libraryItems, openApp } from './libraryHelpers';

type App = { getState(): { tabs: { kind: string }[]; active: number; divider: number; swapped: boolean; layout: string; paneOpen: boolean; openTab(t: object): void; setDivider(f: number): void; swap(): void; activate(i: number): void } };
const app = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __slateApp: App }).__slateApp.getState();
  return { tabs: s.tabs, active: s.active, divider: s.divider, swapped: s.swapped, layout: s.layout, paneOpen: s.paneOpen };
});
const act = (page: Page, fn: string) => page.evaluate((f) => new Function('s', `return (${f})(s)`)((window as unknown as { __slateApp: App }).__slateApp.getState()), fn);
const side = (page: Page) => page.locator('.pane-slot:not([hidden])');

test.describe('P3: panes, tabs and places survive reopening', () => {
  test('the layout comes back on reload: tabs, the active tab, divider and sides', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'To-dos' }).click();
    await page.getByRole('button', { name: 'Revision list' }).click();
    await act(page, '(s) => { s.activate(1); s.setDivider(0.45); s.swap(); }');
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate);
    expect(await app(page)).toMatchObject({ tabs: [{ kind: 'revision' }, { kind: 'todos' }], active: 1, divider: 0.45, swapped: true, paneOpen: true });
    await expect(page.getByRole('tab', { name: /To-dos/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('separator', { name: 'Resize panes' })).toHaveAttribute('aria-valuenow', '45');
    await expect(page.locator('.workspace.swapped')).toBeVisible();
  });

  test('a gym file and a side-pane canvas reopen where they were', async ({ page }) => {
    const long = `# Long notes\n\n${Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} of the long notes.\n`).join('\n')}`;
    const files = { ...GYM_FIXTURE, 'math/linear-algebra/eigenvalues/long.md': long };
    await openWithGym(page, files);
    await act(page, "(s) => s.openTab({ kind: 'gym', path: 'math/linear-algebra/eigenvalues/long.md' })");
    const scroller = side(page).locator('.gym-scroll');
    await expect(side(page).getByText('Paragraph 80 of the long notes.')).toBeAttached();
    await scroller.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.6));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __slate: { settings: { get(): { readingPositions: Record<string, { locator: { fraction: number } }> } } } }).__slate.settings.get().readingPositions['gym:math/linear-algebra/eigenvalues/long.md']?.locator.fraction))
      .toBeCloseTo(0.6, 1);

    // a second canvas in the side pane, moved far from where it opens
    await page.evaluate(() => (window as unknown as { __slate: { canvases: { create(t: string, s: string): Promise<unknown> } } }).__slate.canvases.create('Physics', 'physics'));
    await act(page, "(s) => s.openTab({ kind: 'canvas', slug: 'physics' })");
    await page.locator('.pane-side .cv-view[data-canvas="physics"][data-ready="true"]').waitFor();
    await withCanvas(page, '(h) => h.engine.setCamera({ x: 7000, y: -3000, zoom: 1 })', 'physics');
    await page.mouse.move(10, 10); // let the view settle
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __slate: { settings: { get(): { readingPositions: Record<string, { locator: { region?: { x: number } } }> } } } }).__slate.settings.get().readingPositions['canvas:physics']?.locator.region?.x))
      .toBe(7000);

    // reopen: both tabs are back, each where it was
    await openWithGym(page, files);
    await page.locator('.pane-side .cv-view[data-canvas="physics"][data-ready="true"]').waitFor();
    const cam = await withCanvas<{ x: number; y: number }>(page, '(h) => h.engine.camera', 'physics');
    expect(cam.x).toBeCloseTo(7000, 0);
    expect(cam.y).toBeCloseTo(-3000, 0);
    await page.getByRole('tab', { name: /long/ }).click();
    await expect.poll(() => side(page).locator('.gym-scroll').evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight))).toBeCloseTo(0.6, 1);
  });

  test('another device’s layout follows the owner (synced through settings)', async ({ browser, request }) => {
    const repo = await newRepo(request);
    const a = await device(browser, repo);
    await a.getByRole('button', { name: 'To-dos' }).click();
    await a.getByRole('button', { name: 'Revision list' }).click();
    await act(a, '(s) => s.setDivider(0.4)');
    await expect.poll(() => a.evaluate(() => (window as unknown as { __slate: { settings: { get(): { panes?: { tabs: unknown[] } } } } }).__slate.settings.get().panes?.tabs.length)).toBe(2);
    await a.evaluate(() => (window as unknown as { __slate: { sync: { sync(): Promise<void> } } }).__slate.sync.sync());

    const b = await device(browser, repo);
    await expect.poll(() => app(b)).toMatchObject({ tabs: [{ kind: 'revision' }, { kind: 'todos' }], divider: 0.4, paneOpen: true });
    await expect(b.getByRole('tab', { name: /Revision/ })).toBeVisible();
    await a.context().close();
    await b.context().close();
  });
});

test.describe('P2: narrow screens (iPhone, iPad Slide Over) @touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });

  test('one pane at a time with a quick switch; captures wait in the carry tray until dropped on the canvas', async ({ page }) => {
    await openApp(page);
    await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
    // opening an item switches to it
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByTestId('library')).toBeVisible();
    await expect(page.locator('.pane-canvas')).toBeHidden();
    // the quick switch
    await page.getByRole('button', { name: 'Show canvas' }).click();
    await expect(page.locator('.pane-canvas')).toBeVisible();
    await expect(page.locator('.pane-side')).toBeHidden();
    await page.getByRole('button', { name: 'Show side pane' }).click();
    await expect(page.getByTestId('library')).toBeVisible();

    // a clipping opens over the canvas; its capture waits in the tray
    await page.getByRole('button', { name: 'Show canvas' }).click();
    await page.evaluate(async () => navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['# Quick capture\n\nEigenvectors span the eigenspace.'], { type: 'text/plain' }) })]));
    await page.getByRole('button', { name: 'New from clipboard' }).click();
    const para = side(page).locator('.clip-article p').first();
    await expect(para).toBeVisible();
    await expect(page.locator('.pane-canvas')).toBeHidden();
    const id = (await libraryItems(page)).clippings[0].id;
    await side(page).getByRole('button', { name: 'Lasso', exact: true }).click();
    const p = (await para.boundingBox())!;
    await lassoRect(page, { x: p.x - 4, y: p.y - 4, width: Math.min(p.width + 8, 370 - p.x), height: p.height + 8 });
    await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
    const tray = page.getByRole('complementary', { name: /Carry tray, 1 capture/ });
    await expect(tray).toBeVisible();
    expect((await objects(page)).length).toBe(0);

    // back on the canvas, drag it from the tray
    await page.getByRole('button', { name: 'Show canvas' }).click();
    const card = (await tray.locator('.cv-carry-card').first().boundingBox())!;
    const surface = (await page.locator('.pane-canvas .cv-root').boundingBox())!;
    await dragClient(page, [card.x + 20, card.y + 20], [surface.x + 120, surface.y + 200], 12);
    await expect(tray).toHaveCount(0);
    const [clip] = await objects(page);
    expect(clip).toMatchObject({ kind: 'clip' });

    // its badge switches to the source, at the quote
    await page.locator(`.cv-clip[data-id="${clip.id}"] .cv-badge`).click();
    await expect(page.locator('.pane-canvas')).toBeHidden();
    await expect(side(page).locator('.clip-scroll [data-testid="flash"]').first()).toBeVisible();
    expect((await app(page)).tabs[0]).toEqual({ kind: 'clipping', id });
  });
});

// ---------------------------------------------------------------- two devices

const GITHUB = `${process.env.SLATE_E2E_API}/github`;
let n = 0;

async function newRepo(request: APIRequestContext) {
  const repo = `me/gym-p3-${Date.now().toString(36)}-${n++}-${Math.random().toString(36).slice(2, 6)}`;
  expect((await request.post(`${GITHUB}/__setup`, { data: { repo, tokens: ['tok'], files: { 'README.md': '# gym\n' } } })).ok()).toBe(true);
  return repo;
}

async function device(browser: Browser, repo: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate);
  const r = await page.evaluate(
    async ([apiBase, repo]) => {
      const s = (window as unknown as { __slate: { settings: { setSecrets(p: object): Promise<void> }; sync: { connect(i: object): Promise<{ ok: boolean; error?: string }> } } }).__slate;
      await s.settings.setSecrets({ apiBase });
      return s.sync.connect({ token: 'tok', repo, branch: 'main' });
    },
    [GITHUB, repo] as const,
  );
  expect(r.ok, r.error).toBe(true);
  return page;
}
