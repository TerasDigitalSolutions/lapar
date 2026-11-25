import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page, view: 'Customer' | 'Staff' | 'Manager') => page.getByLabel('View').selectOption({ label: view });

/** Adds one Nasi lemak and sends the order from whatever table the customer view is on. */
async function order(page: Page) {
  await open(page, 'Customer');
  await page.getByRole('button', { name: /^Nasi lemak\s*RM/ }).click();
  await page.getByRole('button', { name: 'Add to order' }).click();
  const suggest = page.getByRole('dialog', { name: 'Add something to go with it?' });
  if (await suggest.isVisible().catch(() => false)) await suggest.getByRole('button', { name: 'No thanks' }).click();
  await page.getByRole('button', { name: /View order/ }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  const nudge = page.getByRole('dialog', { name: 'Anything to drink or add?' });
  await nudge.getByRole('button', { name: 'No thanks, send order' }).click();
  await expect(page.getByText('Order sent. We will update it here.')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/lapar/demo/');
  await expect(page.getByRole('heading', { name: 'Lapar demo' })).toBeVisible();
});

test('tablet: order, approve, cook, serve and pay across both panes', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet');
  const staff = page.getByRole('region', { name: 'Staff and kitchen' });
  const phone = page.getByRole('region', { name: 'Customer phone' });

  await order(page);
  await expect(staff.getByRole('button', { name: 'Approve' })).toBeVisible();
  await staff.getByRole('button', { name: 'Approve' }).click();
  // The customer view polls every 10 s.
  await expect(phone.getByText('Received')).toBeVisible({ timeout: 15_000 });

  await staff.getByRole('tab', { name: 'Kitchen' }).click();
  await staff.getByRole('button', { name: 'Start shift' }).click();
  const card = () => staff.getByRole('button', { name: /Nasi lemak\. Tap/ });
  for (const col of ['New', 'Preparing', 'Cooking', 'Ready']) {
    await expect(staff.getByRole('region', { name: col }).getByRole('button', { name: /Nasi lemak\. Tap/ })).toBeVisible();
    await card().click();
  }
  await expect(phone.getByText('Served').first()).toBeVisible({ timeout: 15_000 });

  await staff.getByRole('tab', { name: 'Tables' }).click();
  await staff.getByRole('button', { name: /Table 1/ }).click();
  await page.getByRole('button', { name: 'Cash' }).click();
  await page.getByRole('button', { name: 'Confirm paid' }).click();
  await expect(page.getByText('Paid. The bill is closed.')).toBeVisible();
});

test('phone: one view at a time and a toast for activity in the hidden view', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await expect(page.getByRole('button', { name: /^Nasi lemak\s*RM/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await order(page);
  await expect(page.getByRole('status').getByText('New order from Table 1')).toBeVisible();

  await open(page, 'Staff');
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Nasi lemak\s*RM/ })).toHaveCount(0);
});

test('simulate rush brings in orders from other tables, and Stop ends it', async ({ page }, info) => {
  await open(page, 'Customer');
  await page.getByRole('button', { name: 'Simulate rush' }).click();
  // Narrow screens toast; wide screens show the rush's orders on the kitchen board (most are approved).
  if (info.project.name === 'phone') {
    await expect(page.getByRole('status').getByText(/New order from Table|: bill please|: water|: needs help/).first()).toBeVisible({ timeout: 15_000 });
  } else {
    const staff = page.getByRole('region', { name: 'Staff and kitchen' });
    await staff.getByRole('tab', { name: 'Kitchen' }).click();
    await staff.getByRole('button', { name: 'Start shift' }).click();
    await expect(staff.getByRole('button', { name: /Tap/ }).first()).toBeVisible({ timeout: 15_000 });
  }
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Simulate rush' })).toBeVisible();
});
