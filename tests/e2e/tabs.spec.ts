import { expect, test, type Page } from '@playwright/test';

const OTHER_TAB = 'Slate is open in another tab or window';
const appBar = (p: Page) => p.getByRole('toolbar', { name: 'App' });
const blocked = (p: Page) => p.getByRole('heading', { name: OTHER_TAB });

test('R1: Slate runs in one tab at a time, and "Use here" takes it over', async ({ context }) => {
  const a = await context.newPage();
  await a.goto('/');
  await expect(appBar(a)).toBeVisible();

  const b = await context.newPage();
  await b.goto('/');
  await expect(blocked(b)).toBeVisible();
  await expect(appBar(b)).toHaveCount(0);

  await b.getByRole('button', { name: 'Use here' }).click();
  await expect(appBar(b)).toBeVisible();
  await expect(blocked(a)).toBeVisible();
  await expect(appBar(a)).toHaveCount(0);

  // work saved in one tab is there when the other takes over again
  await b.evaluate(async () => {
    const s = (window as unknown as { __slate: { canvases: { create(t: string, s: string): Promise<unknown> } } }).__slate;
    await s.canvases.create('Physics', 'physics');
  });
  await a.getByRole('button', { name: 'Use here' }).click();
  await expect(appBar(a)).toBeVisible();
  await expect(blocked(b)).toBeVisible();
  expect(await a.evaluate(() => (window as unknown as { __slate: { canvases: { meta(s: string): { title: string } | undefined } } }).__slate.canvases.meta('physics')?.title)).toBe('Physics');

  // reloading the tab that runs Slate keeps it running there
  await a.reload();
  await expect(appBar(a)).toBeVisible();
  await expect(blocked(b)).toBeVisible();
});
