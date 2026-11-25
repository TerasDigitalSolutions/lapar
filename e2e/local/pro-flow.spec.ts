import { expect, test, type Page } from '@playwright/test';

// Needs a freshly seeded database (`supabase db reset`). Throwaway seed values from supabase/seed.sql
// (staff code RCTH-8W5N, PIN 2468, owner-b@lapar.test). The customer phone polls every 10 s.
const POLL = { timeout: 25_000 };
const opts = { baseURL: 'http://localhost:5173', viewport: { width: 390, height: 844 } };

async function addItem(page: Page, name: RegExp, option?: string) {
  await page.getByRole('button', { name }).click();
  if (option) await page.getByText(option, { exact: true }).click();
  await page.getByRole('button', { name: 'Add to order' }).click();
  const suggest = page.getByRole('dialog', { name: 'Add something to go with it?' });
  if (await suggest.isVisible().catch(() => false)) await suggest.getByRole('button', { name: 'No thanks' }).click();
}

async function placeOrder(page: Page) {
  await page.getByRole('button', { name: /View order/ }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  const nudge = page.getByRole('dialog', { name: 'Anything to drink or add?' });
  if (await nudge.isVisible().catch(() => false)) await nudge.getByRole('button', { name: 'No thanks, send order' }).click();
}

// Pro shops open a kitchen-ticket preview after approving; close it.
async function approve(staff: Page) {
  await staff.getByRole('button', { name: 'Approve' }).click();
  await staff.getByRole('dialog', { name: 'Print ticket' }).getByRole('button', { name: 'Close' }).click();
}

// "Start shift" shows once per page load; after that the Kitchen tab opens straight onto the board.
async function openKitchen(staff: Page) {
  await staff.getByRole('tab', { name: 'Kitchen' }).click();
  const start = staff.getByRole('button', { name: 'Start shift' });
  await expect(start.or(staff.getByRole('region', { name: 'New' })).first()).toBeVisible();
  if (await start.isVisible()) await start.click();
}

async function staffSignIn(page: Page) {
  await page.goto('/lapar/#/staff');
  await page.getByLabel('Staff code').fill('RCTH-8W5N');
  for (const d of '2468') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('tab', { name: /^Orders/ })).toBeVisible();
}

test('Pro: counter pickup, two stations, set, equal split, reports, export and promo', async ({ browser }) => {
  test.setTimeout(180_000);
  const customerCtx = await browser.newContext(opts);
  const staffCtx = await browser.newContext(opts);
  const boardCtx = await browser.newContext(opts);
  const customer = await customerCtx.newPage();
  const staff = await staffCtx.newPage();
  const board = await boardCtx.newPage();

  // counter order shows a pickup number
  await customer.goto('/lapar/#/t/lapar-local-b-counter-1');
  await addItem(customer, /^Teh tarik\s*RM/, 'Ais');
  await addItem(customer, /^Nasi lemak\s*RM/);
  await placeOrder(customer);
  await expect(customer.getByText('Your pickup number')).toBeVisible(POLL);

  // staff approves; the public pickup board lists it under Preparing
  await staffSignIn(staff);
  await approve(staff);
  await board.goto('/lapar/#/pickup/lapar-local-b-pickup-01');
  await expect(board.getByRole('region', { name: 'Preparing' }).getByRole('listitem')).toHaveCount(1, POLL);

  // Drinks and Kitchen boards each move their own item to Ready
  await openKitchen(staff);
  const advance = async (item: string, steps: string[]) => {
    for (let i = 0; i < steps.length - 1; i++) {
      await staff.getByRole('region', { name: steps[i] }).getByRole('button', { name: new RegExp(`${item}\\. Tap: ${steps[i + 1]}`) }).click();
      await expect(staff.getByRole('region', { name: steps[i + 1] }).getByText(item)).toBeVisible();
    }
  };
  const path = ['New', 'Preparing', 'Cooking', 'Ready'];
  await staff.getByRole('radio', { name: 'Drinks' }).click();
  await advance('Teh tarik', path);
  await staff.getByRole('radio', { name: 'Kitchen' }).click();
  await advance('Nasi lemak', path);
  await expect(board.getByRole('region', { name: 'Ready' }).getByRole('listitem')).toHaveCount(1, POLL);

  // Table 2 orders Set A: its components land on both stations
  const table = await (await browser.newContext(opts)).newPage();
  await table.goto('/lapar/#/t/lapar-local-b-table-02');
  await addItem(table, /^Set A\s*RM/);
  await placeOrder(table);
  await expect(table.getByText('Waiting for approval').first()).toBeVisible(POLL);
  await staff.getByRole('tab', { name: /^Orders/ }).click();
  await approve(staff);
  await openKitchen(staff);
  await staff.getByRole('radio', { name: 'Drinks' }).click();
  await expect(staff.getByRole('region', { name: 'New' }).getByText('Part of Set A')).toBeVisible();
  await staff.getByRole('radio', { name: 'Kitchen' }).click();
  await expect(staff.getByRole('region', { name: 'New' }).getByText('Part of Set A')).toBeVisible();

  // split the bill equally two ways; the tab closes after the second share
  await staff.getByRole('tab', { name: 'Tables' }).click();
  await staff.getByRole('button', { name: /Table 2/ }).click();
  await staff.getByRole('radio', { name: 'Equally' }).click();
  await staff.getByRole('button', { name: 'Cash' }).click();
  await staff.getByRole('button', { name: 'Confirm paid' }).click();
  await expect(staff.getByText('Left to pay')).toBeVisible();
  await staff.getByRole('button', { name: 'Cash' }).click();
  await staff.getByRole('button', { name: 'Confirm paid' }).click();
  await expect(staff.getByText('Paid. The bill is closed.')).toBeVisible();

  // owner: Reports render, Orders CSV downloads, promo made all-day
  const ownerCtx = await browser.newContext(opts);
  const owner = await ownerCtx.newPage();
  await owner.goto('/lapar/#/manage');
  await owner.getByLabel('Email').fill('owner-b@lapar.test');
  await owner.getByLabel('Password').fill('lapar-local-only');
  await owner.getByRole('button', { name: 'Sign in' }).click();
  await owner.getByRole('button', { name: /^Reports/ }).click();
  await expect(owner.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(owner.getByText('Best sellers')).toBeVisible();
  await owner.getByRole('button', { name: /^Export/ }).click();
  const [download] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('button', { name: 'Orders CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);

  await owner.getByRole('button', { name: /^Promos/ }).click();
  await owner.getByRole('button', { name: 'Edit Happy hour' }).click();
  await owner.getByLabel('From').fill('00:00');
  await owner.getByLabel('Until').fill('23:59');
  await owner.getByRole('button', { name: 'Save promo' }).click();
  await expect(owner.getByText('Promo saved')).toBeVisible();

  // a new order is charged the promo price: Teh tarik 2.20 less 20% plus Ais 0.30
  const promo = await (await browser.newContext(opts)).newPage();
  await promo.goto('/lapar/#/t/lapar-local-b-table-01');
  await addItem(promo, /^Teh tarik\s*RM/, 'Ais');
  await placeOrder(promo);
  await expect(promo.getByRole('region', { name: 'Running bill' })).toContainText('RM 2.06', POLL);
});
