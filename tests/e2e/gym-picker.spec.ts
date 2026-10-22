import { expect, test } from '@playwright/test';
import { openWithGym } from './gym-helpers';

test.describe('topic picker (G1, G2, G3)', () => {
  test('searches topics and variants offline and picks with the keyboard', async ({ page, context }) => {
    await openWithGym(page);
    await context.setOffline(true);
    await page.evaluate(() => (window as any).__slateGym.mountPicker('topic'));
    const input = page.getByRole('combobox', { name: 'Topic' });
    const value = page.locator('#picker-value');
    await input.fill('eigen');
    const list = page.getByRole('listbox', { name: 'Topics' });
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(list.getByRole('option').first()).toContainText('Eigenvalues');
    await expect(input).toHaveAttribute('aria-activedescendant', /.+/);
    await input.press('Enter');
    await expect(value).toHaveText('math/linear-algebra/eigenvalues');
    await expect(list).toBeHidden();
    await expect(page.locator('.gym-picker-warn')).toHaveCount(0);

    // variants are pickable, by title or path words
    await input.fill('transformer quant');
    await expect(list.getByRole('option')).toHaveCount(1);
    await input.press('Enter');
    await expect(value).toHaveText('ml/architectures/transformer/quantization');

    // arrows move through all topics
    await input.fill('');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await expect(list.getByRole('option').nth(2)).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(value).toHaveText('math/analysis/sequences');
    await context.setOffline(false);
  });

  test('accepts a path not in gym yet, with a warning', async ({ page }) => {
    await openWithGym(page);
    await page.evaluate(() => (window as any).__slateGym.mountPicker('topic'));
    const input = page.getByRole('combobox', { name: 'Topic' });
    await input.fill('math/linear-algebra/jordan-form');
    await expect(page.getByRole('listbox')).toContainText('No match');
    await input.press('Enter');
    await expect(page.locator('#picker-value')).toHaveText('math/linear-algebra/jordan-form');
    await expect(page.locator('.gym-picker-warn')).toContainText('Not in gym yet');
    await input.fill('Linear stuff');
    await input.press('Escape');
    await input.press('Enter');
    await expect(page.locator('.gym-picker-warn')).toContainText('Not a topic path');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('#picker-value')).toHaveText('');
    // leaving the field keeps a typed path, but drops a half-typed search
    await input.fill('ml/architectures/transformer/basic');
    await input.press('Tab');
    await expect(page.locator('#picker-value')).toHaveText('ml/architectures/transformer/basic');
    await input.fill('eig');
    await input.press('Tab');
    await expect(page.locator('#picker-value')).toHaveText('ml/architectures/transformer/basic');
    await expect(input).toHaveValue('ml/architectures/transformer/basic');
  });

  test('picks problem files, restricted to a topic', async ({ page }) => {
    await openWithGym(page);
    await page.evaluate(() => (window as any).__slateGym.mountPicker('problem', 'math/linear-algebra/eigenvalues'));
    const input = page.getByRole('combobox', { name: 'Problem' });
    await input.focus();
    const options = page.getByRole('listbox', { name: 'Problems' }).getByRole('option');
    await expect(options).toHaveCount(3);
    await expect(options.nth(1)).toContainText('002 · Trace and eigenvalues');
    await options.nth(1).click();
    await expect(page.locator('#picker-value')).toHaveText('math/linear-algebra/eigenvalues/problems/002-trace.md');
  });
});
