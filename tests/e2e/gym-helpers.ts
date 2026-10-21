import { expect, type Page } from '@playwright/test';
import { GYM_COMMIT, GYM_FIXTURE } from '../../src/core/gym/testing/fixture';

export { GYM_COMMIT, GYM_FIXTURE };

/** Opens the app and seeds gym's mirror with the fixture repository (test builds only). */
export async function openWithGym(page: Page, files: Record<string, string> = GYM_FIXTURE) {
  await page.goto('/');
  await expect(page.getByRole('toolbar', { name: 'App' })).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown; __slateGym?: unknown }).__slate && !!(window as unknown as { __slateGym?: unknown }).__slateGym);
  await page.evaluate(
    ([f, c]) => (window as unknown as { __slateGym: { seed(f: unknown, c: string): void } }).__slateGym.seed(f, c),
    [files, GYM_COMMIT] as const,
  );
}

/** The side pane's visible tab panel. */
export const pane = (page: Page) => page.locator('.pane-slot:not([hidden])');
