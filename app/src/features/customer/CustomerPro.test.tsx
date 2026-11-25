import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { DataProvider } from '../../data/context';
import { createDemoData } from '../../data/demo';
import { setLocale } from '../../i18n';
import { PickupBoardView } from '../pickup/PickupBoardView';
import { CustomerView } from './CustomerView';

const SHOP = 'shop-kopitiam-teras';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  setLocale('en');
});

async function setup(token: string, opts: { live?: boolean; clock?: 'afternoon' } = {}) {
  const data = createDemoData({ persist: false });
  data.setPlan('pro');
  await data.owner.updateShopSettings(SHOP, { approvalMode: 'none' });
  if (opts.clock) data.setClock(opts.clock);
  render(
    <DataProvider value={data}>
      <CustomerView tableToken={token} live={opts.live} />
    </DataProvider>,
  );
  return data;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

test('language switch translates the menu', async () => {
  await setup('demo-table-01');
  await screen.findByRole('heading', { name: 'Drinks' });
  fireEvent.click(screen.getByRole('radio', { name: 'BM' }));
  expect(await screen.findByRole('heading', { name: 'Minuman' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Pesanan saya' })).toBeTruthy();
});

test('promo shows struck list price, promo price and promo name', async () => {
  await setup('demo-table-01', { clock: 'afternoon' });
  const btn = await screen.findByRole('button', { name: /^Teh tarik/ });
  expect(btn.textContent).toContain('RM 1.76');
  expect(within(btn).getByText('was RM 2.20').className).toContain('line-through');
  expect(within(btn).getByText('Happy hour')).toBeTruthy();
});

test('a set lists its components and can be ordered with a note', async () => {
  const data = await setup('demo-table-01');
  fireEvent.click(await screen.findByRole('button', { name: /^Set A/ }));
  expect(screen.getByText('Includes: 1 x Nasi lemak, 1 x Teh tarik')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Note for the kitchen/), { target: { value: 'no ice' } });
  click('Add to order');
  const skip = screen.queryByRole('button', { name: 'No thanks' });
  if (skip) fireEvent.click(skip);
  click(/View order/);
  click('Place order');
  const nudge = await screen.findAllByRole('button', { name: /No thanks, send order|Place order/ }).catch(() => []);
  if (nudge.some((b) => b.textContent === 'No thanks, send order')) click('No thanks, send order');
  await screen.findByText('Order sent. We will update it here.');
  const tab = await data.customer.getTab('demo-table-01');
  expect(tab.orders[0]!.lines.map((l) => [l.kind, l.name])).toEqual([
    ['combo', 'Set A'],
    ['component', 'Nasi lemak'],
    ['component', 'Teh tarik'],
  ]);
});

test('counter token shows takeaway and the big pickup number after ordering', async () => {
  await setup('demo-counter');
  expect(await screen.findByText('Takeaway')).toBeTruthy();
  expect(screen.queryByRole('tab', { name: 'Call server' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: /^Nasi lemak\s*RM 5\.50$/ }));
  click('Add to order');
  const skip = screen.queryByRole('button', { name: 'No thanks' });
  if (skip) fireEvent.click(skip);
  click(/View order/);
  expect(screen.getByLabelText('Pickup time')).toBeTruthy();
  click('Place order');
  const nudge = screen.queryByRole('button', { name: 'No thanks, send order' }) ?? (await screen.findByRole('button', { name: 'No thanks, send order' }).catch(() => null));
  if (nudge) fireEvent.click(nudge);
  const box = await screen.findByRole('region', { name: 'Your pickup number' });
  expect(box.textContent).toContain('1');
  expect(screen.getByRole('heading', { name: 'My orders' })).toBeTruthy();
});

test('pickup board shows preparing and ready numbers', async () => {
  const data = createDemoData({ persist: false });
  data.setPlan('pro');
  await data.owner.updateShopSettings(SHOP, { approvalMode: 'none' });
  await data.customer.placeOrder('demo-counter', { lines: [{ itemId: 'item-nasi-lemak', qty: 1, optionIds: [] }] });
  render(
    <DataProvider value={data}>
      <PickupBoardView boardToken={data.pickupBoardToken} />
    </DataProvider>,
  );
  const prep = await screen.findByRole('region', { name: 'Preparing' });
  expect(within(prep).getByText('1')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Ready' })).getByText('None')).toBeTruthy();
});

test('live: status updates right after a staff action, without waiting for the poll', async () => {
  const data = await setup('demo-table-01', { live: true });
  fireEvent.click(await screen.findByRole('button', { name: /^Nasi lemak\s*RM 5\.50$/ }));
  click('Add to order');
  const skip = screen.queryByRole('button', { name: 'No thanks' });
  if (skip) fireEvent.click(skip);
  click(/View order/);
  click('Place order');
  const nudge = await screen.findByRole('button', { name: 'No thanks, send order' }).catch(() => null);
  if (nudge) fireEvent.click(nudge);
  await screen.findByText('Order sent. We will update it here.');
  await screen.findByText('Received');
  const board = await data.staff.getBoard(SHOP, null);
  await act(async () => {
    await data.staff.advanceItem(board.lines[0]!.id, 'preparing');
  });
  await waitFor(() => expect(screen.getAllByText('Cooking').length).toBeGreaterThan(0), { timeout: 2000 });
});
