import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page, view: 'Customer' | 'Staff' | 'Manager') => page.getByLabel('View').selectOption({ label: view });

/** The pane that shows the staff app: its own region on wide screens, the whole page on a phone. */
const staffPane = (page: Page, project: string) => (project === 'phone' ? page : page.getByRole('region', { name: 'Staff and kitchen' }));

async function addNasiLemak(page: Page) {
  await page.getByRole('button', { name: /^Nasi lemak\s*RM/ }).click();
  await page.getByRole('button', { name: 'Add to order' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/lapar/demo/');
  await expect(page.getByRole('heading', { name: 'Lapar demo' })).toBeVisible();
});

test('a tall sheet keeps its title and close button inside the phone frame', async ({ page }) => {
  await page.getByRole('button', { name: /^Teh tarik\s*RM/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Teh tarik' });
  const title = dialog.getByRole('heading', { name: 'Teh tarik' });
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(title).toBeInViewport();
  await expect(close).toBeInViewport();
  const frame = page.getByRole('region', { name: 'Customer phone' });
  if (await frame.count()) {
    const pane = (await frame.boundingBox())!;
    expect((await title.boundingBox())!.y).toBeGreaterThanOrEqual(pane.y);
  }
  await close.click();
  await expect(dialog).toHaveCount(0);
});

test('the cart bar stays visible after scrolling the menu', async ({ page }) => {
  await addNasiLemak(page);
  const suggest = page.getByRole('dialog', { name: 'Add something to go with it?' });
  if (await suggest.isVisible().catch(() => false)) await suggest.getByRole('button', { name: 'No thanks' }).click();
  const bar = page.getByRole('button', { name: /View order/ });
  await expect(bar).toBeInViewport();
  await page.getByRole('button', { name: /^Nasi lemak\s*RM/ }).evaluate((el) => {
    let n = el.parentElement;
    while (n && n.scrollHeight <= n.clientHeight + 1) n = n.parentElement;
    n?.scrollTo(0, n.scrollHeight);
  });
  await expect(bar).toBeInViewport();
});

test('Reset brings the add-on suggestions back', async ({ page }) => {
  const suggest = page.getByRole('dialog', { name: 'Add something to go with it?' });
  await addNasiLemak(page);
  await expect(suggest).toBeVisible();
  await suggest.getByRole('button', { name: 'No thanks' }).click();
  await addNasiLemak(page);
  await expect(suggest).toHaveCount(0); // dismissed for this visit

  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
  await addNasiLemak(page);
  await expect(suggest).toBeVisible();
});

test('a short rush fills the kitchen board, with an amber or red card', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Simulate rush' }).click();
  await page.waitForTimeout(3_000);
  if (info.project.name === 'phone') await open(page, 'Staff');
  const staff = staffPane(page, info.project.name);
  await staff.getByRole('tab', { name: 'Kitchen' }).click();
  await staff.getByRole('button', { name: 'Start shift' }).click();
  await expect(staff.getByRole('button', { name: /Tap/ }).first()).toBeVisible();
  await expect(staff.locator('article[data-age=amber], article[data-age=red]').first()).toBeVisible();
});

test('phone: order, approve, cook, serve and pay in one pane at a time', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await addNasiLemak(page);
  const suggest = page.getByRole('dialog', { name: 'Add something to go with it?' });
  if (await suggest.isVisible().catch(() => false)) await suggest.getByRole('button', { name: 'No thanks' }).click();
  await page.getByRole('button', { name: /View order/ }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.getByRole('dialog', { name: 'Anything to drink or add?' }).getByRole('button', { name: 'No thanks, send order' }).click();
  await expect(page.getByText('Order sent. We will update it here.')).toBeVisible();

  await open(page, 'Staff');
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('tab', { name: 'Kitchen' }).click();
  await page.getByRole('button', { name: 'Start shift' }).click();
  for (const col of ['New', 'Preparing', 'Cooking', 'Ready']) {
    await expect(page.getByRole('region', { name: col }).getByRole('button', { name: /Nasi lemak\. Tap/ })).toBeVisible();
    await page.getByRole('button', { name: /Nasi lemak\. Tap/ }).click();
  }
  await page.getByRole('tab', { name: 'Tables' }).click();
  await page.getByRole('button', { name: /Table 1/ }).click();
  await page.getByRole('button', { name: 'Cash' }).click();
  await page.getByRole('button', { name: 'Confirm paid' }).click();
  await expect(page.getByText('Paid. The bill is closed.')).toBeVisible();
});
