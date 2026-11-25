import { expect, test } from '@playwright/test';

// Needs a freshly seeded database (`supabase db reset`). Runs after the other specs: it changes shop A's staff code.
// Throwaway seed values from supabase/seed.sql (staff code KTRS-7Q4M, PIN 1234, owner-a@lapar.test).
test('the owner sees the staff code; a new code signs a staff device out', async ({ browser }) => {
  const opts = { baseURL: 'http://localhost:5173', viewport: { width: 390, height: 844 } };
  const staff = await (await browser.newContext(opts)).newPage();
  const owner = await (await browser.newContext(opts)).newPage();

  await staff.goto('/lapar/#/staff');
  await staff.getByLabel('Staff code').fill('ktrs 7q4m');
  for (const d of '1234') await staff.getByRole('button', { name: d, exact: true }).click();
  await staff.getByRole('button', { name: 'Sign in' }).click();
  await expect(staff.getByRole('tab', { name: /^Orders/ })).toBeVisible();

  await owner.goto('/lapar/#/manage');
  await owner.getByLabel('Email').fill('owner-a@lapar.test');
  await owner.getByLabel('Password').fill('lapar-local-only');
  await owner.getByRole('button', { name: 'Sign in' }).click();
  await owner.getByRole('button', { name: 'Staff' }).click();
  await expect(owner.getByTestId('staff-code')).toHaveText('KTRS-7Q4M');
  await expect(owner.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
  await owner.getByRole('button', { name: 'New staff code' }).click();
  await expect(owner.getByText(/All staff devices will be signed out/)).toBeVisible();
  await owner.getByRole('button', { name: 'Yes, make a new code' }).click();
  await expect(owner.getByText('New staff code made. Share it with your staff.')).toBeVisible();
  await expect(owner.getByTestId('staff-code')).not.toHaveText('KTRS-7Q4M');

  // the staff device is signed out (reload re-checks the session) and the old code no longer works
  await staff.reload();
  await expect(staff.getByLabel('Staff code')).toBeVisible();
  for (const d of '1234') await staff.getByRole('button', { name: d, exact: true }).click();
  await staff.getByRole('button', { name: 'Sign in' }).click();
  await expect(staff.getByText(/That staff code is not right/)).toBeVisible();
});
