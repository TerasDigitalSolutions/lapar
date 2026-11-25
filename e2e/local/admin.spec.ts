import { expect, test } from '@playwright/test';

// Needs a freshly seeded database (`supabase db reset`) and the owner RPCs (owner landing page, Plan page).
// Throwaway seed credentials from supabase/seed.sql; the new owner's password is local-only too.
test('admin sets up a shop, invites its owner, changes plan, override and WhatsApp number', async ({ page, browser }) => {
  await page.goto('/lapar/#/admin');
  await page.getByLabel('Email').fill('admin@lapar.test');
  await page.getByLabel('Password').fill('lapar-local-only');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // create the shop and its owner link
  await page.getByLabel('Shop name').fill('Warung Ujian');
  await expect(page.getByLabel('Shop code')).toHaveValue('warung-ujian');
  await page.getByLabel('Owner email').fill('new-owner@lapar.test');
  await page.getByRole('button', { name: 'Create shop and owner link' }).click();
  await expect(page.getByText(/This link works once/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
  const url = await page.getByRole('textbox', { name: 'Copy link' }).inputValue();
  expect(url).toContain('#/welcome?token_hash=');

  // the owner opens the link in a fresh browser context and sets a password
  const ctx = await browser.newContext({ baseURL: 'http://localhost:5173', viewport: { width: 390, height: 844 } });
  const owner = await ctx.newPage();
  // the link always points at the production site (SITE_BASE_URL); open the same hash on the local server
  await owner.goto(url.replace(/^[^#]+/, '/lapar/'));
  await owner.getByLabel('New password').fill('owner-local-only');
  await owner.getByLabel('Type it again').fill('owner-local-only');
  await owner.getByRole('button', { name: 'Save password and continue' }).click();
  await expect(owner).toHaveURL(/#\/manage/);
  await expect(owner.getByText('Warung Ujian').first()).toBeVisible();

  // plan, override with a note, WhatsApp number
  await page.getByRole('radio', { name: 'Pro' }).click();
  await expect(page.getByText('Plan changed')).toBeVisible();
  await page.getByRole('button', { name: 'Override max_tables' }).click();
  await page.getByLabel('Limit').fill('40');
  await page.getByRole('button', { name: 'Save' }).click(); // no note yet
  await expect(page.getByText('A note is required.')).toBeVisible();
  await page.getByLabel('Note').fill('Second floor opening');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('ov-max_tables')).toContainText('Second floor opening');
  await expect(page.getByTestId('ov-max_tables')).toContainText('admin@lapar.test');
  await page.getByRole('button', { name: /Back to shops/ }).click();
  await page.getByLabel('Ask Teras WhatsApp number').fill('60123456789');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('WhatsApp number saved')).toBeVisible();

  // the owner's Plan page now links to Ask Teras
  await owner.reload();
  await owner.getByRole('button', { name: 'Plan' }).click();
  await expect(owner.getByRole('link', { name: 'Ask Teras on WhatsApp' })).toHaveAttribute('href', 'https://wa.me/60123456789');
  await ctx.close();
});
