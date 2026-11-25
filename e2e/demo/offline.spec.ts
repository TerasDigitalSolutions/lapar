import { expect, test } from '@playwright/test';

test('demo works offline after one visit and never leaves the origin', async ({ page, context, baseURL }) => {
  const offOrigin: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && new URL(r.url()).origin !== new URL(baseURL!).origin) offOrigin.push(r.url());
  });

  await page.goto('/lapar/demo/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Lapar demo/ })).toBeVisible();
  expect(offOrigin).toEqual([]);
});
