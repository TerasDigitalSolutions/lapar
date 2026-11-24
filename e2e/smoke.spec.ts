import { expect, test } from '@playwright/test';

test('landing loads and the demo link works', async ({ page }) => {
  await page.goto('/lapar/');
  await expect(page.getByRole('heading', { name: 'Lapar' })).toBeVisible();
  await page.getByRole('link', { name: 'Try the demo' }).click();
  await expect(page).toHaveURL(/\/lapar\/demo\/$/);
  await expect(page.getByRole('heading', { name: /Lapar demo/ })).toBeVisible();
});
