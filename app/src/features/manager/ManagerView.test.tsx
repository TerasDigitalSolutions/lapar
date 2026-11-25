import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test } from 'vitest';
import { DataProvider } from '../../data/context';
import { createDemoData } from '../../data/demo';
import type { LaparData, PlanId } from '../../data/types';
import { EntitlementsProvider } from '../../entitlements/hooks';
import { PLAN_DEFAULTS } from '../../entitlements/keys';
import { addDays, mytToday } from '../../lib/time';
import { ToastProvider } from '../../ui';
import { ManagerView } from './ManagerView';
import { reportBounds } from './TodaySection';

afterEach(cleanup);
const SHOP = 'shop-kopitiam-teras';

function setup(plan: PlanId = 'basic', wrap?: (d: ReturnType<typeof createDemoData>) => LaparData) {
  const d = createDemoData({ persist: false });
  if (plan === 'pro') d.setPlan('pro');
  const data: LaparData = wrap ? wrap(d) : d;
  const ui = (children: ReactNode) => (
    <DataProvider value={data}>
      <EntitlementsProvider value={PLAN_DEFAULTS[plan]}>
        <ToastProvider>{children}</ToastProvider>
      </EntitlementsProvider>
    </DataProvider>
  );
  render(ui(<ManagerView shopId={SHOP} />));
  return d;
}

const open = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

test('add an item, then edit its name and price', async () => {
  const d = setup();
  open('Menu');
  const first = (await d.owner.getMenuEditor(SHOP)).categories[0]!;
  await screen.findByRole('region', { name: first.name });
  fireEvent.click(screen.getByRole('button', { name: `Add dish to ${first.name}` }));

  // validation before saving
  fireEvent.click(screen.getByRole('button', { name: 'Save dish' }));
  expect(await screen.findByText('Please enter a name.')).toBeTruthy();
  type('Name', 'Kuih lapis');
  type('Price (RM)', 'abc');
  fireEvent.click(screen.getByRole('button', { name: 'Save dish' }));
  expect(await screen.findByText('Enter a price like 2.20.')).toBeTruthy();

  type('Price (RM)', '2.20');
  fireEvent.click(screen.getByRole('button', { name: 'Save dish' }));
  await waitFor(async () => expect((await d.owner.getMenuEditor(SHOP)).items.find((i) => i.name === 'Kuih lapis')?.priceSen).toBe(220));

  // edit it
  type('Name', 'Kuih seri muka');
  type('Price (RM)', '3.50');
  fireEvent.click(screen.getByRole('button', { name: 'Save dish' }));
  await waitFor(async () => {
    const item = (await d.owner.getMenuEditor(SHOP)).items.find((i) => i.name === 'Kuih seri muka');
    expect(item?.priceSen).toBe(350);
  });
  const items = (await d.owner.getMenuEditor(SHOP)).items.filter((i) => i.name.startsWith('Kuih'));
  expect(items).toHaveLength(1); // saved twice, still one dish

  // an option group with a bad min/max is refused, a good one is saved
  fireEvent.click(await screen.findByRole('button', { name: 'Add option group' }));
  type('Group name', 'Size');
  type('Fewest to choose', '3');
  type('Most to choose', '1');
  fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
  expect(await screen.findByText('The fewest cannot be more than the most.')).toBeTruthy();
  type('Fewest to choose', '1');
  fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
  await waitFor(async () => expect((await d.owner.getMenuEditor(SHOP)).groups.some((g) => g.name === 'Size' && g.minSelect === 1)).toBe(true));
});

test('categories reorder with the down button', async () => {
  const d = setup();
  open('Menu');
  const before = (await d.owner.getMenuEditor(SHOP)).categories.map((c) => c.name);
  expect(before.length).toBeGreaterThan(1);
  fireEvent.click(await screen.findByRole('button', { name: `Move ${before[0]} down` }));
  await waitFor(async () => expect((await d.owner.getMenuEditor(SHOP)).categories.map((c) => c.name).slice(0, 2)).toEqual([before[1], before[0]]));
  // the first category cannot go further up
  expect((screen.getByRole('button', { name: `Move ${before[1]} up` }) as HTMLButtonElement).disabled).toBe(true);
});

test('Tables: limit badge on Basic, hidden on Pro; QR sheet shows the url and warns before regenerating', async () => {
  const d = setup();
  open('Tables');
  const row = await screen.findByText('Table 1');
  expect(screen.getByLabelText(/^\d+ of 15 used$/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Show QR code for Table 1' }));
  const dialog = await screen.findByRole('dialog', { name: 'QR code for Table 1' });
  const token = (await d.owner.listTables(SHOP)).find((x) => x.label === 'Table 1')!.token;
  expect(dialog.textContent).toContain(`#/t/${token}`);
  expect(dialog.querySelector('svg')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Make a new QR code' }));
  expect(within(dialog).getByText(/will stop working straight away/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, make a new code' }));
  await waitFor(async () => expect((await d.owner.listTables(SHOP)).find((x) => x.label === 'Table 1')!.token).not.toBe(token));
  expect(row).toBeTruthy();

  cleanup();
  setup('pro');
  open('Tables');
  await screen.findByText('Table 1');
  expect(screen.queryByLabelText(/used$/)).toBeNull();
});

test('Tables: a table can be added and a duplicate name is refused', async () => {
  const d = setup();
  open('Tables');
  await screen.findByText('Table 1');
  type('Table name', 'table 1');
  fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
  expect(await screen.findByText('You already have a table with that name.')).toBeTruthy();
  type('Table name', 'Patio 1');
  fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
  await waitFor(async () => expect((await d.owner.listTables(SHOP)).some((x) => x.label === 'Patio 1')).toBe(true));
});

test('Staff: PIN must be 4 to 6 digits', async () => {
  const d = setup();
  open('Staff');
  await screen.findByRole('button', { name: 'Add staff' });
  type('Name', 'Aina');
  type('PIN', '12');
  fireEvent.click(screen.getByRole('button', { name: 'Add staff' }));
  expect(await screen.findByText('The PIN must be 4 to 6 digits.')).toBeTruthy();
  type('PIN', '482913');
  fireEvent.click(screen.getByRole('button', { name: 'Add staff' }));
  await waitFor(async () => expect((await d.owner.listStaff(SHOP)).some((s) => s.name === 'Aina')).toBe(true));
});

test('reportBounds: the window starts N-1 days back and unlimited has no start', () => {
  expect(reportBounds('2026-11-25', 30)).toEqual({ min: '2026-10-27', max: '2026-11-25' });
  expect(reportBounds('2026-11-25', 1)).toEqual({ min: '2026-11-25', max: '2026-11-25' });
  expect(reportBounds('2026-11-25', null)).toEqual({ min: undefined, max: '2026-11-25' });
});

test('Today: the date input is limited to the report window and shows a summary', async () => {
  setup();
  const input = (await screen.findByLabelText('Date')) as HTMLInputElement;
  const today = mytToday();
  expect(input.max).toBe(today);
  expect(input.min).toBe(addDays(today, -29));
  await screen.findByText('Top 5 dishes');
  fireEvent.change(input, { target: { value: addDays(today, -31) } });
  expect((await screen.findByRole('alert')).textContent).toContain('Please pick a date from');
});

test('Plan: Ask Teras is hidden when the number is null and shown otherwise', async () => {
  setup();
  open('Plan');
  await screen.findByText('Lapar Basic');
  expect(screen.queryByRole('link', { name: /Ask Teras/ })).toBeNull();
  expect(screen.getByText(/To change your plan/)).toBeTruthy();
  cleanup();

  setup('basic', (d) => ({
    ...d,
    owner: { ...d.owner, getShopPlan: async (id: string) => ({ ...(await d.owner.getShopPlan(id)), askTerasWhatsapp: '1234567890' }) },
  }) as LaparData);
  open('Plan');
  const link = (await screen.findByRole('link', { name: /Ask Teras/ })) as HTMLAnchorElement;
  expect(link.href).toBe('https://wa.me/1234567890');
});

test('Pro sections show a lock on Basic and open on Pro', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /Reports/ }));
  expect(await screen.findByRole('button', { name: /Full reports/ })).toBeTruthy();
  cleanup();
  setup('pro');
  fireEvent.click(screen.getByRole('button', { name: /Reports/ }));
  expect(await screen.findByText('Coming soon')).toBeTruthy();
});
