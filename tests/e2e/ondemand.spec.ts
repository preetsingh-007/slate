import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { makePaperPdf } from '../../src/test/fixtures';
import { importFile, libraryItems } from './libraryHelpers';

// R9: a new device downloads the library index and the canvas list first; a clipping's
// content, its annotations and the canvas segments its margin marks need download when it is
// opened, without blocking what is already local.

const API = process.env.SLATE_E2E_API!;
const GITHUB = `${API}/github`;

let n = 0;
async function newRepo(request: APIRequestContext) {
  const repo = `me/gym-r9-${Date.now().toString(36)}-${n++}-${Math.random().toString(36).slice(2, 6)}`;
  const r = await request.post(`${GITHUB}/__setup`, { data: { repo, tokens: ['tok'], files: { 'README.md': '# gym\n' } } });
  expect(r.ok()).toBe(true);
  return repo;
}

type W = {
  __slate: {
    settings: { setSecrets(p: object): Promise<void> };
    sync: { connect(i: object): Promise<{ ok: boolean; error?: string }>; sync(): Promise<void>; getStatus(): { phase: string } };
    library: { putClipping(m: object, c?: object): Promise<void>; clipping(id: string): unknown };
    docs: { open(id: string): Promise<{ getMap(n: string): { set(k: string, v: unknown): void } }>; has(id: string): Promise<boolean> };
    canvases: { update(slug: string, p: object): Promise<void>; create(t: string, s: string): Promise<unknown> };
  };
  __slateUi: { useApp: { getState(): { openTab(t: object): void } } };
};

async function device(browser: Browser, repo: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate);
  const r = await page.evaluate(
    async ([apiBase, repo]) => {
      const s = (window as unknown as W).__slate;
      await s.settings.setSecrets({ apiBase });
      return s.sync.connect({ token: 'tok', repo, branch: 'main' });
    },
    [GITHUB, repo] as const,
  );
  expect(r.ok, r.error).toBe(true);
  return page;
}

const clipping = (id: string, title: string) => ({
  id,
  slug: `2026-10-21-${id.toLowerCase()}`,
  origin: 'clipboard',
  title,
  format: 'markdown',
  added: Date.UTC(2026, 9, 21),
  contentHash: `hash-${id}`,
});

test('R9: a new device downloads a clipping, its annotations and the clips pointing to it when opened', async ({ browser, request }) => {
  const repo = await newRepo(request);
  const a = await device(browser, repo);
  await a.evaluate(
    async ([c1, c2]) => {
      const s = (window as unknown as W).__slate;
      await s.library.putClipping(c1, { markdown: '# Notes on spectra\n\nThe first paragraph.\n\nThe second paragraph holds the highlight.\n', assets: [] });
      await s.library.putClipping(c2, { markdown: 'Read later, when online.\n', assets: [] });
      const ann = await s.docs.open('ann:clipA');
      ann.getMap('annotations').set('h1', {
        id: 'h1',
        kind: 'highlight',
        color: '#f5d742',
        created: 1,
        text: 'second paragraph',
        locator: { type: 'clipping', quote: { exact: 'second paragraph', prefix: 'The ', suffix: ' holds' }, offset: 0 },
      });
    },
    [clipping('clipA', 'Notes on spectra'), clipping('clipB', 'Later')] as const,
  );
  // the clip is on a second canvas, which the new device does not open by itself
  await a.evaluate(async () => {
    const s = (window as unknown as W).__slate;
    await s.canvases.create('Physics', 'physics');
    const doc = await s.docs.open('seg:physics:2026-10');
    const objects = doc.getMap('objects') as unknown as { set(k: string, v: unknown): void; constructor: new () => { set(k: string, v: unknown): void } };
    const m = new objects.constructor();
    const created = Date.UTC(2026, 9, 21);
    const source = { type: 'clipping', id: 'clipA', title: 'Notes on spectra', locator: { type: 'clipping', quote: { exact: 'The first paragraph.', prefix: '', suffix: '' }, offset: 0 }, capturedAt: 1, contentHash: 'hash-clipA' };
    const fields: Record<string, unknown> = { id: 'clipOnCanvas', kind: 'clip', x: 0, y: 0, w: 200, h: 100, rotation: 0, z: 'a', created, edited: created, device: 'e2e', topics: [], text: 'The first paragraph.', display: 'text', source };
    for (const [k, v] of Object.entries(fields)) m.set(k, v);
    objects.set('clipOnCanvas', m);
    await s.canvases.update('physics', { segments: { '2026-10': { x: 0, y: 0, w: 200, h: 100 } } });
    await s.sync.sync();
  });
  await expect.poll(async () => Object.keys(await (await request.get(`${GITHUB}/__files?repo=${encodeURIComponent(repo)}`)).json())).toEqual(
    expect.arrayContaining(['library/clippings/2026-10-21-clipa/clipping.md', 'library/clippings/2026-10-21-clipa/annotations.yjs', 'journal/physics/2026-10/canvas.yjs']),
  );

  // the second device has the index, not the content
  const b = await device(browser, repo);
  expect(await b.evaluate(() => !!(window as unknown as W).__slate.library.clipping('clipA'))).toBe(true);
  expect(await b.evaluate(() => (window as unknown as W).__slate.docs.has('seg:physics:2026-10'))).toBe(false);

  await b.evaluate(() => (window as unknown as W).__slateUi.useApp.getState().openTab({ kind: 'clipping', id: 'clipA' }));
  const pane = b.getByTestId('clipping-pane');
  await expect(pane.getByRole('heading', { name: 'Notes on spectra' })).toBeVisible();
  // the annotations document merged in (L11 highlights), and the clip's segment (S7 mark)
  await expect(pane.locator('.hl-rect')).toHaveCount(1);
  await expect(pane.getByTestId('clip-mark')).toBeVisible();

  // offline: what is not on the device says so, and arrives once back online
  await b.context().setOffline(true);
  await b.evaluate(() => (window as unknown as W).__slateUi.useApp.getState().openTab({ kind: 'clipping', id: 'clipB' }));
  await expect(b.getByTestId('clipping-missing')).toContainText('not on this device yet');
  await b.context().setOffline(false);
  await expect(b.locator('.pane-slot:not([hidden])').getByTestId('clipping-pane')).toContainText('Read later, when online.');
  await a.context().close();
  await b.context().close();
});

test('R9 L6: in Git LFS mode a new device downloads the book file when the book is opened', async ({ browser, request }) => {
  const repo = await newRepo(request);
  const a = await device(browser, repo);
  await a.evaluate(() => (window as unknown as { __slate: { settings: { update(p: object): Promise<void> } } }).__slate.settings.update({ lfs: true }));
  await importFile(a, 'paper.pdf', await makePaperPdf(), 'application/pdf');
  const { books } = await libraryItems(a);
  await a.evaluate(() => (window as unknown as W).__slate.sync.sync());

  const b = await device(browser, repo);
  await expect.poll(async () => (await libraryItems(b)).books.map((x) => x.id)).toEqual([books[0].id]);
  await b.evaluate((id) => (window as unknown as W).__slateUi.useApp.getState().openTab({ kind: 'book', id }), books[0].id);
  await expect(b.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
  await a.context().close();
  await b.context().close();
});
