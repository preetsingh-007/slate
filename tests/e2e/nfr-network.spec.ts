/**
 * Network use and secrets NFRs: during a whole workflow (sign-in, writing, a book, lasso,
 * New from clipboard with a remote image, New from link, the gym reader, export, sync) the app
 * contacts only its own origin, GitHub (the mocked API) and the fetch helper; the helper gets the
 * page URL and its key only; the token goes only to GitHub, only for the gym repository, and is
 * never written to the repository. The static half of this check is src/test/network.test.ts.
 */
import { expect, test, type Request } from '@playwright/test';
import { makePaperPdf } from '../../src/test/fixtures';
import { drawMouse, objects, seed, wave, withCanvas } from './canvas-helpers';
import { HELPER_KEY, importFile, lassoRect, setHelper } from './libraryHelpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const API = process.env.SLATE_E2E_API!;
const GITHUB = `${API}/github`;
const TOKEN = 'good-token-0123456789abcdef';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

test('the app contacts only GitHub and the fetch helper; the token goes only to GitHub (network use, secrets)', async ({ page, context, request, baseURL }) => {
  test.setTimeout(120_000);
  const repo = `me/gym-net-${Date.now().toString(36)}`;
  const files = { 'README.md': '# gym\n', 'math/README.md': '# Math\n', 'math/linear-algebra/eigenvalues/notes.md': '# Eigenvalues\n\nAn eigenvector $v$ satisfies $Av = \\lambda v$.\n' };
  expect((await request.post(`${GITHUB}/__setup`, { data: { repo, tokens: [TOKEN], files } })).ok()).toBe(true);

  const seen: Seen[] = [];
  const record = async (r: Request) => seen.push({ url: r.url(), method: r.method(), headers: await r.allHeaders(), body: r.postData() ?? '' });
  context.on('request', (r) => void record(r));

  // sign in (R4)
  await page.goto('/?onboarding=1');
  const dialog = page.getByRole('dialog', { name: 'Welcome to Slate' });
  await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate);
  await page.evaluate((apiBase) => (window as unknown as { __slate: { settings: { setSecrets(p: object): Promise<void> } } }).__slate.settings.setSecrets({ apiBase }), GITHUB);
  await dialog.getByLabel('Repository (owner/name)').fill(repo);
  await dialog.getByLabel('Fine-grained personal access token').fill(TOKEN);
  await dialog.getByRole('button', { name: 'Verify and connect' }).click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-phase', 'synced');
  await setHelper(page);

  // W1: writing
  await page.locator('.cv-view[data-canvas="main"][data-ready="true"]').waitFor();
  await page.getByRole('radio', { name: 'Pen (P)' }).click();
  await drawMouse(page, wave(100, 160));
  await seed(page, [{ kind: 'text', x: 0, y: 600, w: 300, content: 'Eigen $\\lambda$ ![remote](https://tracker.example/pixel.png)' }]);

  // W2: a book, lassoed onto the canvas
  await importFile(page, 'paper.pdf', await makePaperPdf(), 'application/pdf');
  await expect(page.locator('.pdfv-page[data-page="1"] canvas.ready')).toBeVisible();
  await page.locator('.pane-slot:not([hidden])').getByRole('button', { name: 'Lasso', exact: true }).click();
  const box = (await page.locator('.pdfv-page[data-page="1"]').boundingBox())!;
  await lassoRect(page, { x: box.x + 60, y: box.y + 60, width: 220, height: 100 });
  await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
  await expect.poll(async () => (await objects(page)).filter((o) => o.kind === 'clip').length).toBe(1);

  // W3: New from clipboard (with an image from another site) and New from link
  await page.evaluate(async () =>
    navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob(['<h1>Answer</h1><p>See <img src="https://tracker.example/answer.png"> and <a href="https://example.org/x">this</a>.</p>'], { type: 'text/html' }),
        'text/plain': new Blob(['Answer\n\nSee this.'], { type: 'text/plain' }),
      }),
    ]),
  );
  await page.getByRole('button', { name: 'New from clipboard' }).click();
  await expect(page.getByTestId('clipping-pane')).toBeVisible();
  await page.getByRole('button', { name: 'New from link' }).click();
  const link = page.getByRole('dialog', { name: 'New from link' });
  await link.getByRole('textbox', { name: 'Web address' }).fill('https://blog.example/posts/spaced-repetition');
  await link.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.clip-article h2')).toHaveText('How to use it');
  await page.getByRole('radio', { name: 'Original' }).click();
  await expect(page.frameLocator('[data-testid="snapshot-frame"]').locator('h1')).toHaveText('Why spaced repetition works');

  // W5: the gym reader
  await page.evaluate(() => (window as unknown as { __slateApp: { getState(): { openTab(t: object): void } } }).__slateApp.getState().openTab({ kind: 'gym', path: 'math/linear-algebra/eigenvalues/notes.md' }));
  await expect(page.locator('.pane-slot:not([hidden]) .gym-md h1')).toHaveText('Eigenvalues');

  // export a selection, then sync everything
  await withCanvas(page, '(h) => h.engine.select(h.ctl.model.query(h.engine.view).map((o) => o.id))');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Export PNG' }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await page.evaluate(() => (window as unknown as { __slate: { sync: { sync(): Promise<unknown> } } }).__slate.sync.sync());
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-phase', 'synced');

  // images from other sites are shown as links, never loaded
  expect(await page.locator('img[src*="tracker.example"], [style*="tracker.example"]').count()).toBe(0);

  // --- what went over the network
  const app = new URL(baseURL!).origin;
  const api = new URL(API).origin;
  const kinds = new Map<string, number>();
  const strays: string[] = [];
  for (const r of seen) {
    const u = new URL(r.url);
    const kind = u.protocol === 'blob:' || u.protocol === 'data:' ? 'local' : u.origin === app ? 'app' : u.origin === api && u.pathname.startsWith('/github/') ? 'github' : u.origin === api && u.pathname.startsWith('/helper/') ? 'helper' : 'other';
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    if (kind === 'other') strays.push(`${r.method} ${r.url}`);
    const auth = r.headers.authorization ?? '';
    const carriesToken = auth.includes(TOKEN) || r.url.includes(TOKEN) || r.body.includes(TOKEN);
    if (kind === 'github') {
      // scoped to the gym repository (the token is fine-grained to it; the app asks for nothing else)
      if (r.method !== 'OPTIONS') expect(u.pathname, r.url).toMatch(new RegExp(`^/github/repos/${repo}(/|$)`));
    } else if (carriesToken) strays.push(`token sent to ${r.url}`);
    if (kind === 'helper' && r.method !== 'OPTIONS') {
      // the helper gets the page URL and its key: nothing else about the person
      expect([...u.searchParams.keys()], r.url).toEqual(['url']);
      expect(r.headers['x-slate-key']).toBe(HELPER_KEY);
      expect(r.headers.authorization).toBeUndefined();
      expect(r.headers.cookie).toBeUndefined();
      expect(r.headers.referer).toBeUndefined();
    }
  }
  console.log(`[nfr] network: ${JSON.stringify(Object.fromEntries(kinds))} requests`);
  expect(strays).toEqual([]);
  expect(kinds.get('github')).toBeGreaterThan(0);
  expect(kinds.get('helper')).toBeGreaterThan(0);

  // the token stays on the device: never in the repository, never in localStorage
  const repoFiles = (await (await request.get(`${GITHUB}/__files?repo=${encodeURIComponent(repo)}`)).json()) as Record<string, string>;
  expect(Object.keys(repoFiles).some((p) => p.startsWith('journal/'))).toBe(true);
  expect(Object.values(repoFiles).join('\n')).not.toContain(TOKEN);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(TOKEN);
});
