import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { DataProvider } from '../../data/context';
import { createDemoData } from '../../data/demo';
import { CustomerView } from './CustomerView';

const TOKEN = 'demo-table-01';

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

const setup = (token = TOKEN) => {
  const data = createDemoData({ persist: false });
  render(
    <DataProvider value={data}>
      <CustomerView tableToken={token} />
    </DataProvider>,
  );
  return data;
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const openItem = async (price: RegExp) => fireEvent.click(await screen.findByRole('button', { name: price }));
const NASI = /^Nasi lemak\s*RM 5\.50$/;
const TELUR = /^Telur mata\s*RM 1\.20$/;

test('unknown QR shows the invalid message', async () => {
  setup('nope');
  expect(await screen.findByText('This QR code is no longer valid')).toBeTruthy();
});

test('menu shows header, categories and prices', async () => {
  setup();
  expect(await screen.findByRole('heading', { name: 'Kopitiam Teras' })).toBeTruthy();
  expect(screen.getByText('Table 1')).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Categories' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Teh tarik\s*RM 2\.20$/ })).toBeTruthy();
});

test('a required option blocks Add until chosen', async () => {
  setup();
  await openItem(/^Teh tarik\s*RM 2\.20$/);
  const add = screen.getByRole('button', { name: 'Add to order' }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: /Ais/ }));
  expect(add.disabled).toBe(false);
  expect(within(screen.getByRole('dialog')).getAllByText('RM 2.50').length).toBeGreaterThan(0);
});

test('suggestions skip dishes already in the cart and show once per dish', async () => {
  setup();
  await openItem(TELUR);
  click('Add to order');
  await openItem(NASI);
  click('Add to order');
  const dialog = await screen.findByRole('dialog', { name: 'Add something to go with it?' });
  expect(within(dialog).queryByText('Telur mata')).toBeNull();
  expect(within(dialog).getByText('Ayam goreng')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'No thanks' }));
  expect(screen.queryByRole('dialog')).toBeNull();

  await openItem(NASI);
  click('Add to order');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('checkout nudge shows once, then the order shows Waiting for approval', async () => {
  setup();
  await openItem(NASI);
  click('Add to order');
  click('No thanks');
  click(/View order/);
  click('Place order');
  expect(await screen.findByRole('dialog', { name: 'Anything to drink or add?' })).toBeTruthy();
  click('No thanks, send order');
  expect((await screen.findAllByText('Waiting for approval')).length).toBeGreaterThan(0);
  expect(screen.getByText('Order sent. We will update it here.')).toBeTruthy();

  // Second order: no nudge this visit.
  fireEvent.click(screen.getByRole('tab', { name: 'Menu' }));
  await openItem(NASI);
  click('Add to order');
  click(/View order/);
  click('Place order');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('dialog', { name: 'Anything to drink or add?' })).toBeNull();
});

test('sold out dishes cannot be opened', async () => {
  const data = createDemoData({ persist: false });
  await data.staff.setSoldOut('item-kopi', true);
  render(
    <DataProvider value={data}>
      <CustomerView tableToken={TOKEN} />
    </DataProvider>,
  );
  const btn = (await screen.findByRole('button', { name: /^Kopi\s*Sold out/ })) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
});

test('repeat call merges into one open request', async () => {
  const data = setup();
  fireEvent.click(await screen.findByRole('tab', { name: 'Call server' }));
  click('Water');
  await screen.findByText('Done. Someone will come to your table.');
  click('Water');
  await waitFor(async () => expect((await data.customer.getTab(TOKEN)).openRequests).toHaveLength(1));
  const list = await screen.findByRole('list', { name: 'Open requests' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
});
