import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/lapar/demo/');
  await expect(page.getByRole('heading', { name: 'Lapar demo' })).toBeVisible();
});

test('the plan switch shows and hides the Pro badge on locked controls', async ({ page }) => {
  const locked = page.getByRole('button', { name: /Clock/ });
  await expect(locked).toContainText('Pro');
  await locked.click();
  await expect(page.getByRole('dialog', { name: /Timed menus is part of Lapar Pro/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).first().click();

  await page.getByLabel('Plan').selectOption('pro');
  await expect(locked).toHaveCount(0);
  await expect(page.getByLabel('Clock')).toBeVisible();

  await page.getByLabel('Plan').selectOption('basic');
  await expect(page.getByRole('button', { name: /Clock/ })).toContainText('Pro');
});

test('Reset asks first, then restores the seed', async ({ page }) => {
  await page.getByLabel('Plan').selectOption('pro');
  await page.getByLabel('View').selectOption({ label: 'Customer' });
  await page.getByRole('tab', { name: 'Call server' }).click();
  await page.getByRole('button', { name: 'Water' }).click();

  await page.getByLabel('View').selectOption({ label: 'Staff' });
  await expect(page.getByText('No calls.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Plan')).toHaveValue('pro');

  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByLabel('Plan')).toHaveValue('basic');
  await expect(page.getByText('No calls.')).toBeVisible();
});

test('no request leaves the origin while using the demo', async ({ page, baseURL }) => {
  const off: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && new URL(r.url()).origin !== new URL(baseURL!).origin) off.push(r.url());
  });
  await page.reload();
  await page.getByLabel('Plan').selectOption('pro');
  await page.getByLabel('View').selectOption({ label: 'Manager' });
  await expect(page.getByLabel('View')).toHaveValue('manager');
  expect(off).toEqual([]);
});
