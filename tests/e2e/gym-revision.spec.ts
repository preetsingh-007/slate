import { expect, test, type Locator } from '@playwright/test';
import { openWithGym, pane } from './gym-helpers';

const press = (l: Locator) => (test.info().project.name === 'tablet' ? l.tap() : l.click());

test.describe('revision list (G8)', () => {
  test('lists revisit problems oldest first, then open problems, then done topics by latest log entry @touch', async ({ page }) => {
    await openWithGym(page);
    await press(page.getByRole('button', { name: 'Revision list' }));
    const p = pane(page);
    const titles = (name: string) => p.getByRole('region', { name }).locator('.gym-entry-title');
    await expect(titles('Revisit')).toHaveText(['002 · Union of two subspaces', '002 · Trace and eigenvalues']);
    await expect(titles('Open')).toHaveText(['001 · Eigenvalues of a diagonal matrix']);
    await expect(titles('Topics')).toHaveText(['Sequences', 'Vector Spaces', 'Transformer: basic']);
    await expect(p.getByRole('region', { name: 'Topics' })).toContainText('last logged 2026-09-02');

    // tapping an entry opens it in the side pane
    await press(p.getByRole('button', { name: /Trace and eigenvalues/ }));
    await expect(pane(page).locator('.gym-md h1')).toHaveText('Trace and eigenvalues');
    await expect(pane(page).locator('.gym-fm-chips')).toContainText('revisit');
    await page.getByRole('tab', { name: 'Revision' }).click();
    await press(pane(page).getByRole('button', { name: /Vector Spaces.*math\/linear-algebra\/vector-spaces/ }));
    await expect(pane(page).getByRole('heading', { name: 'Vector Spaces', level: 1 })).toBeVisible();
  });

  test('follows the mirror: a new log entry reorders the topics', async ({ page }) => {
    await openWithGym(page);
    await page.getByRole('button', { name: 'Revision list' }).click();
    const topics = pane(page).getByRole('region', { name: 'Topics' }).locator('.gym-entry-title');
    await expect(topics).toHaveText(['Sequences', 'Vector Spaces', 'Transformer: basic']);
    await page.evaluate(async () => {
      const g = (window as any).__slateGym;
      const log = await (window as any).__slate.gymFiles.readText('log/2026/10.md');
      g.set('log/2026/10.md', `${log}\n## 2026-10-20\n\n- [s](../../math/analysis/sequences/): Revised.\n`, 'c2');
    });
    // sequences was last logged 2026-10-20 now, after transformer/basic (2026-10-12)
    await expect(topics).toHaveText(['Vector Spaces', 'Transformer: basic', 'Sequences']);
  });
});

test.describe('revision list on an iPhone-width screen (G8, P2)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is full screen and opens entries full screen @touch', async ({ page }) => {
    await openWithGym(page);
    await press(page.getByRole('button', { name: 'Revision list' }));
    await expect(page.locator('.pane-canvas')).toBeHidden();
    const entry = pane(page).getByRole('button', { name: /Union of two subspaces/ });
    await expect(entry).toBeInViewport();
    const b = (await entry.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThan(340);
    await press(entry);
    await expect(pane(page).locator('.gym-md h1')).toHaveText('Union of two subspaces');
    await expect(page.locator('.pane-canvas')).toBeHidden();
  });
});
