import { expect, test, type Page } from '@playwright/test';

// Needs a freshly seeded database (`supabase db reset`): the first order of a tab waits for approval.
// Throwaway seed values from supabase/seed.sql (shop kopitiam-teras, PIN 1234).
// The customer phone has no realtime; it polls every 10 s.
const POLL = { timeout: 25_000 };

async function addItem(page: Page, name: RegExp, option?: string) {
  await page.getByRole('button', { name }).click();
  if (option) await page.getByText(option, { exact: true }).click();
  await page.getByRole('button', { name: 'Add to order' }).click();
  const suggest = page.getByRole('dialog', { name: 'Add something to go with it?' });
  if (await suggest.isVisible().catch(() => false)) await suggest.getByRole('button', { name: 'No thanks' }).click();
}

test('scan, order, approve, New to Served, pay and close the tab', async ({ browser }) => {
  test.setTimeout(120_000);
  const opts = { baseURL: 'http://localhost:5173', viewport: { width: 390, height: 844 } };
  const customerCtx = await browser.newContext(opts);
  const staffCtx = await browser.newContext(opts);
  const customer = await customerCtx.newPage();
  const staff = await staffCtx.newPage();

  // customer, Table 3
  await customer.goto('/lapar/#/t/lapar-local-a-table-03');
  await addItem(customer, /^Teh tarik\s*RM/, 'Ais');
  await addItem(customer, /^Nasi lemak\s*RM/);
  await customer.getByRole('button', { name: /View order/ }).click();
  await customer.getByRole('button', { name: 'Place order' }).click();
  const nudge = customer.getByRole('dialog', { name: 'Anything to drink or add?' });
  if (await nudge.isVisible().catch(() => false)) await nudge.getByRole('button', { name: 'No thanks, send order' }).click();
  await expect(customer.getByText('Waiting for approval').first()).toBeVisible(POLL);

  // staff signs in and approves
  await staff.goto('/lapar/#/staff');
  await staff.getByLabel('Shop code').fill('kopitiam-teras');
  for (const d of '1234') await staff.getByRole('button', { name: d, exact: true }).click();
  await staff.getByRole('button', { name: 'Sign in' }).click();
  await expect(staff.getByRole('tab', { name: /^Orders/ })).toBeVisible();
  await staff.getByRole('button', { name: 'Approve' }).click();
  await expect(customer.getByText('Received').first()).toBeVisible(POLL);

  // kitchen: New, Preparing, Cooking, Ready, then served
  await staff.getByRole('tab', { name: 'Kitchen' }).click();
  await staff.getByRole('button', { name: 'Start shift' }).click();
  for (const [from, to] of [['New', 'Preparing'], ['Preparing', 'Cooking'], ['Cooking', 'Ready']]) {
    for (const item of ['Teh tarik', 'Nasi lemak']) {
      await staff.getByRole('region', { name: from }).getByRole('button', { name: new RegExp(`${item}\\. Tap: ${to}`) }).click();
      await expect(staff.getByRole('region', { name: to }).getByText(item)).toBeVisible();
    }
  }
  await expect(customer.getByText('Ready', { exact: true }).first()).toBeVisible(POLL);
  await staff.getByRole('tab', { name: /^Orders/ }).click();
  for (const item of ['Teh tarik', 'Nasi lemak']) await staff.getByRole('button', { name: new RegExp(`^Mark ${item}.* served`) }).click();
  await expect(customer.getByText('Served', { exact: true }).first()).toBeVisible(POLL);

  // pay at the table
  await staff.getByRole('tab', { name: 'Tables' }).click();
  await staff.getByRole('button', { name: /Table 3/ }).click();
  await staff.getByRole('button', { name: 'Cash' }).click();
  await expect(staff.getByText(/^Collect RM/)).toBeVisible();
  await staff.getByRole('button', { name: 'Confirm paid' }).click();
  await expect(staff.getByText('Paid. The bill is closed.')).toBeVisible();

  // the customer's bill is gone
  await expect(customer.getByText('Running bill')).toHaveCount(0, POLL);
  await customerCtx.close();
  await staffCtx.close();
});
