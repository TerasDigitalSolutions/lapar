import { expect, test } from '@playwright/test';

// Needs a freshly seeded database (`supabase db reset`). Throwaway seed credentials from supabase/seed.sql.
test('owner adds an 11th table, regenerates its QR and opens Today', async ({ page }) => {
  await page.goto('/lapar/#/manage');
  await page.getByLabel('Email').fill('owner-a@lapar.test');
  await page.getByLabel('Password').fill('lapar-local-only');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('button', { name: 'Tables' }).click();
  await page.getByLabel('Table name').fill('Table 11');
  await page.getByRole('button', { name: 'Add table' }).click();
  await expect(page.getByText('Table added')).toBeVisible();

  await page.getByRole('button', { name: 'Show QR code for Table 11' }).click();
  await page.getByRole('button', { name: 'Make a new QR code' }).click();
  await page.getByRole('button', { name: 'Yes, make a new code' }).click();
  await expect(page.getByText('New QR code made. Print it and replace the old one.')).toBeVisible();

  // the sheet stays open to show the new code
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText('Sales', { exact: true })).toBeVisible();
});
