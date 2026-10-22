import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Sync against the mocked GitHub API (tests/e2e/routes/20-github.mjs): onboarding (R4), a change
// reaching the repository (R1, R4, R6), the status indicator (R10) and the settings dialog.

const API = process.env.SLATE_E2E_API!;
const GITHUB = `${API}/github`;

let n = 0;
async function newRepo(request: APIRequestContext, opts: { tokenExpiry?: string } = {}) {
  const repo = `me/gym-${Date.now().toString(36)}-${n++}-${Math.random().toString(36).slice(2, 6)}`;
  const files = { 'README.md': '# gym\n', 'math/linear-algebra/eigenvalues/notes.md': '# Eigenvalues\n' };
  const r = await request.post(`${GITHUB}/__setup`, { data: { repo, tokens: ['good-token'], files, ...opts } });
  expect(r.ok()).toBe(true);
  return repo;
}

async function repoFiles(request: APIRequestContext, repo: string): Promise<Record<string, string>> {
  return (await (await request.get(`${GITHUB}/__files?repo=${encodeURIComponent(repo)}`)).json()) as Record<string, string>;
}

/** Points the app at the mocked API (a test-build-only device secret). */
async function useMockApi(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate);
  await page.evaluate((apiBase) => (window as unknown as { __slate: { settings: { setSecrets(p: object): Promise<void> } } }).__slate.settings.setSecrets({ apiBase }), GITHUB);
}

async function connectThroughOnboarding(page: Page, repo: string) {
  await page.goto('/?onboarding=1');
  const dialog = page.getByRole('dialog', { name: 'Welcome to Slate' });
  await expect(dialog).toBeVisible();
  await useMockApi(page);
  await expect(dialog.getByText('Only select repositories')).toBeVisible();
  await expect(dialog.getByText('Read and write')).toBeVisible();
  await dialog.getByLabel('Repository (owner/name)').fill(repo);
  await dialog.getByLabel('Fine-grained personal access token').fill('good-token');
  await dialog.getByRole('button', { name: 'Verify and connect' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-phase', 'synced');
}

test('onboarding verifies the token and connects (R4)', async ({ page, request }) => {
  const repo = await newRepo(request, { tokenExpiry: '2026-11-01 00:00:00 UTC' });
  await page.goto('/?onboarding=1');
  const dialog = page.getByRole('dialog', { name: 'Welcome to Slate' });
  await useMockApi(page);
  await dialog.getByLabel('Repository (owner/name)').fill(repo);
  await dialog.getByLabel('Fine-grained personal access token').fill('wrong-token');
  await dialog.getByRole('button', { name: 'Verify and connect' }).click();
  await expect(dialog.getByRole('alert')).toContainText('rejected the token');
  await dialog.getByLabel('Fine-grained personal access token').fill('good-token');
  await dialog.getByRole('button', { name: 'Verify and connect' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-phase', 'synced');
  // the first sync wrote the app's folders, and nothing else
  await expect.poll(async () => Object.keys(await repoFiles(request, repo)).filter((p) => p.startsWith('journal/') || p.startsWith('library/')).length).toBeGreaterThan(3);
  const files = await repoFiles(request, repo);
  expect(files['README.md']).toBe('# gym\n');
  expect(files['library/settings.json']).toBeDefined();
  expect(Object.values(files).join('\n')).not.toContain('good-token');
  // the token stays on the device; its expiry was read from GitHub's headers
  const secrets = await page.evaluate(() => (window as unknown as { __slate: { settings: { getSecrets(): { token?: string; tokenExpiry?: number } } } }).__slate.settings.getSecrets());
  expect(secrets.token).toBe('good-token');
  expect(secrets.tokenExpiry).toBe(Date.UTC(2026, 10, 1));
});

test('continuing offline skips sync (R4, R10)', async ({ page }) => {
  await page.goto('/?onboarding=1');
  await page.getByRole('button', { name: 'Continue offline without sync' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-phase', 'off');
  await page.reload();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-phase', 'off');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('a change on the canvas reaches the repository with derived files (R1, R4, R6)', async ({ page, request }) => {
  const repo = await newRepo(request);
  await connectThroughOnboarding(page, repo);
  await page.evaluate(async () => {
    type M = { load(m: string[]): Promise<void>; transact(fn: (tx: { add(o: object): void }) => void): void };
    const s = (window as unknown as { __slate: { canvases: { model(slug: string): M } } }).__slate;
    const now = Date.now();
    const d = new Date(now);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = s.canvases.model('main');
    await m.load([month]);
    m.transact((tx) =>
      tx.add({ id: 'e2etext', kind: 'text', x: 0, y: 0, w: 300, h: 60, rotation: 0, z: 'i', created: now, edited: now, device: 'e2e', topics: [], content: 'Hello from e2e\n\n- [ ] check the push', fontSize: 18 }),
    );
  });
  await page.getByTestId('sync-status').click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Sync now' }).click();
  await expect
    .poll(async () => {
      const files = await repoFiles(request, repo);
      return Object.entries(files).find(([p]) => /^journal\/main\/\d{4}-\d{2}\/days\/.*\.md$/.test(p))?.[1] ?? '';
    })
    .toContain('Hello from e2e');
  const files = await repoFiles(request, repo);
  expect(files['journal/todos.md']).toContain('- [ ] check the push');
  expect(Object.keys(files).some((p) => /^journal\/main\/\d{4}-\d{2}\/canvas\.yjs$/.test(p))).toBe(true);
  const log = (await (await request.get(`${GITHUB}/__log?repo=${encodeURIComponent(repo)}`)).json()) as string[];
  expect(log[0]).toMatch(/^journal: /);
});

test('the status indicator shows offline, errors with a reason, and recovers (R10, R4)', async ({ page, context, request }) => {
  const repo = await newRepo(request);
  await connectThroughOnboarding(page, repo);
  const status = page.getByTestId('sync-status');

  await context.setOffline(true);
  await expect(status).toHaveAttribute('data-phase', 'offline');
  await context.setOffline(false);
  await expect(status).toHaveAttribute('data-phase', 'synced');

  // the token is revoked: sync pauses and asks for a new one
  await request.post(`${GITHUB}/__config`, { data: { repo, tokens: ['new-token'] } });
  await status.click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Sync now' }).click();
  await expect(status).toHaveAttribute('data-phase', 'error');
  await expect(status).toHaveAttribute('title', /rejected the token/);
  await expect(settings.getByRole('alert')).toContainText('Sync is paused');
  await settings.getByLabel('Fine-grained personal access token').fill('new-token');
  await settings.getByRole('button', { name: /Verify and/ }).click();
  await expect(status).toHaveAttribute('data-phase', 'synced');
});

test('settings apply the theme and show storage persistence', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('settings-button').click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('heading', { name: 'GitHub sync' })).toBeVisible();
  await settings.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('slate-theme'))).toBe('dark');
  await expect(settings.getByTestId('storage-persistence')).toContainText('Persistent storage is');
  await settings.getByLabel('Git LFS mode: commit book files to the repository (allows files over 50 MB)').check();
  await expect(settings.getByRole('note')).toContainText('does not accept requests from web apps');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
});
