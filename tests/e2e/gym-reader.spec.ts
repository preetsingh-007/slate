import { expect, test } from '@playwright/test';
import { openWithGym, pane } from './gym-helpers';

test.describe('gym reader (G7, G1)', () => {
  test('browses the tree from the top bar: domains, subjects, topics with status, variants', async ({ page }) => {
    await openWithGym(page);
    await page.getByRole('button', { name: 'Gym', exact: true }).click();
    const p = pane(page);
    await expect(p.getByRole('heading', { name: 'Mathematics' })).toBeVisible();
    await expect(p.getByRole('heading', { name: 'Machine Learning' })).toBeVisible();
    // non-domains are not in the tree
    await expect(p.getByText('Journal', { exact: true })).toHaveCount(0);
    const eig = p.getByRole('button', { name: /Eigenvalues active/ });
    await expect(eig).toBeVisible();
    await expect(p.getByRole('button', { name: /Transformer: basic done/ })).toBeVisible();
    await eig.click();
    // a folder opens its README, then its contents
    await expect(p.getByRole('heading', { name: 'Eigenvalues', level: 1 })).toBeVisible();
    await expect(p.locator('.gym-fm-chips')).toContainText('active');
    await expect(p.locator('.gym-fm-chips')).toContainText('Started: 2026-10-15');
    await expect(p.getByRole('region', { name: 'Contents' })).toContainText('notes.md');
    await p.getByRole('button', { name: 'notes.md' }).click();
    await expect(page.getByRole('tab', { name: /eigenvalues\/notes/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('renders GFM with KaTeX, relative SVG images, tables and code', async ({ page }) => {
    await openWithGym(page);
    await page.evaluate(() => (window as any).__slateGym.app.getState().openTab({ kind: 'gym', path: 'math/linear-algebra/eigenvalues/notes.md' }));
    const md = pane(page).locator('.gym-md');
    await expect(md.locator('h1')).toHaveText('Eigenvalues: Notes');
    await expect(md.locator('.katex').first()).toBeVisible();
    await expect(md.locator('.katex-display')).toHaveCount(1);
    const img = md.locator('img[alt="Eigenvectors keep their direction"]');
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await expect(md.locator('table tr')).toHaveCount(3);
    await expect(md.locator('pre code')).toContainText('np.linalg.eig(A)');
    // repeated headings get GitHub's -1 suffix
    await expect(md.locator('h2#spectral-theorem')).toHaveCount(1);
    await expect(md.locator('h2#spectral-theorem-1')).toHaveCount(1);
  });

  test('follows relative links to files with anchors, folders and in-page anchors', async ({ page }) => {
    await openWithGym(page);
    await page.evaluate(() => (window as any).__slateGym.app.getState().openTab({ kind: 'gym', path: 'math/linear-algebra/eigenvalues/notes.md' }));
    const p = pane(page);
    await p.locator('.gym-md').getByRole('link', { name: 'Vector Spaces' }).click();
    await expect(page.getByRole('tab', { name: /vector-spaces\/notes/ })).toHaveAttribute('aria-selected', 'true');
    const bases = pane(page).locator('.gym-md h2#bases');
    await expect(bases).toBeInViewport();
    await expect(pane(page).locator('.gym-flash').first()).toBeVisible();

    // back in the eigenvalues notes: an in-page anchor scrolls to its heading
    await page.getByRole('tab', { name: /eigenvalues\/notes/ }).click();
    await pane(page).locator('.gym-md').getByRole('link', { name: 'back to definitions' }).click();
    await expect(pane(page).locator('h2#definitions')).toBeInViewport();

    // a link to a problem file opens it with its front matter as chips
    await pane(page).locator('.gym-md').getByRole('link', { name: 'problem 1' }).click();
    await expect(pane(page).locator('.gym-fm-chips')).toContainText('open');
    await expect(pane(page).locator('.gym-fm-chips')).toContainText('Difficulty: easy');
    await expect(pane(page).locator('.gym-md h1')).toHaveText('Eigenvalues of a diagonal matrix');
    // breadcrumbs lead to the folder of the topic
    await pane(page).getByRole('navigation', { name: 'Gym path' }).getByRole('button', { name: 'eigenvalues' }).click();
    await expect(pane(page).getByRole('heading', { name: 'Eigenvalues', level: 1 })).toBeVisible();
  });

  test('opens path#heading scrolled to the heading (formalized badges, W4)', async ({ page }) => {
    await openWithGym(page);
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.evaluate(() => (window as any).__slateGym.app.getState().openTab({ kind: 'gym', path: 'math/linear-algebra/eigenvalues/notes.md#spectral-theorem-1' }));
    await expect(pane(page).locator('h2#spectral-theorem-1')).toBeInViewport();
    await expect(pane(page).locator('h1')).not.toBeInViewport();
  });

  test('renders a marimo notebook as Markdown with its front matter folded and code kept', async ({ page }) => {
    await openWithGym(page);
    await page.evaluate(() => (window as any).__slateGym.app.getState().openTab({ kind: 'gym', path: 'ml/architectures/transformer/basic/code/transformer.md' }));
    const p = pane(page);
    const fm = p.locator('details.gym-fm');
    await expect(fm).toContainText('marimo notebook · Transformer');
    await expect(fm.locator('dl')).not.toBeVisible();
    await fm.locator('summary').click();
    await expect(fm.locator('dl')).toContainText('0.25.1');
    await expect(p.locator('.gym-md h1')).toHaveText('Transformer');
    await expect(p.locator('.gym-md pre code').nth(1)).toContainText('def attention(q, k, v):');
    await expect(p.locator('.gym-md .katex').first()).toBeVisible();
    // the front matter is not shown as text
    await expect(p.locator('.gym-md')).not.toContainText('marimo-version');
  });

  test('searches all of gym offline and opens the hit at its section', async ({ page, context }) => {
    await openWithGym(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Gym', exact: true }).click();
    const search = pane(page).getByRole('searchbox', { name: 'Search gym' });
    await search.fill('self-adjoint');
    const results = pane(page).getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('button')).toHaveCount(1);
    await expect(results).toContainText('Eigenvalues: Notes');
    await expect(results.locator('mark')).toHaveText(/self-adjoint/i);
    await search.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(pane(page).locator('h2#spectral-theorem')).toBeInViewport();
    await context.setOffline(false);
  });

  test('says so when gym has not been downloaded yet, and when a path is not in gym', async ({ page }) => {
    await openWithGym(page, {});
    await page.getByRole('button', { name: 'Gym', exact: true }).click();
    await expect(pane(page)).toContainText('not on this device yet');
    await page.evaluate(() => (window as any).__slateGym.seed({ 'README.md': '# gym' }, 'x'));
    await page.evaluate(() => (window as any).__slateGym.app.getState().openTab({ kind: 'gym', path: 'math/nope.md' }));
    await expect(pane(page)).toContainText('is not in gym');
  });
});
