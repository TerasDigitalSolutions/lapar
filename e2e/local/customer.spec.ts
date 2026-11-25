import { expect, test } from '@playwright/test';

// Needs a freshly seeded database (`supabase db reset`): the first order of a tab waits for approval.
test('customer orders Kopi O with Ais on the real backend', async ({ page }) => {
  const rpc: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/rpc/')) rpc.push(r.url().split('/').pop()!);
  });
  await page.goto('/lapar/#/t/lapar-local-a-table-01');
  await expect(page.getByRole('button', { name: /^Teh tarik\s*RM/ })).toBeVisible();

  await page.getByRole('button', { name: /^Kopi O\s*RM/ }).click();
  await page.getByText('Ais', { exact: true }).click();
  await page.getByRole('button', { name: 'Add to order' }).click();
  const suggest = page.getByRole('dialog', { name: 'Add something to go with it?' });
  if (await suggest.isVisible().catch(() => false)) await suggest.getByRole('button', { name: 'No thanks' }).click();
  await page.getByRole('button', { name: /View order/ }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  const nudge = page.getByRole('dialog', { name: 'Anything to drink or add?' });
  if (await nudge.isVisible().catch(() => false)) await nudge.getByRole('button', { name: 'No thanks, send order' }).click();

  await expect(page.getByText('Waiting for approval').first()).toBeVisible();
  expect(rpc).toContain('place_order');
});
