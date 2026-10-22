import { expect, test } from '@playwright/test';

test('the app starts and shows the canvas @touch', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('toolbar', { name: 'App' })).toBeVisible();
});
