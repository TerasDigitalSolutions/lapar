import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { DataProvider } from '../../data/context';
import { createDemoData } from '../../data/demo';
import type { LaparDemoData } from '../../data/types';
import { EntitlementsProvider } from '../../entitlements/hooks';
import { PLAN_DEFAULTS, type PlanId } from '../../entitlements/keys';
import { ToastProvider } from '../../ui';
import { KitchenView } from '../kitchen/KitchenView';
import { PrintSheet, ticketSlips } from '../print';
import { StaffView } from './StaffView';

const SHOP = 'shop-kopitiam-teras';
let d: LaparDemoData;
beforeEach(() => {
  localStorage.clear();
  d = createDemoData({ persist: false });
});
afterEach(cleanup);

const renderWith = (plan: PlanId, ui: React.ReactNode) => {
  d.setPlan(plan);
  return render(
    <DataProvider value={d}>
      <EntitlementsProvider value={PLAN_DEFAULTS[plan]}>
        <ToastProvider>{ui}</ToastProvider>
      </EntitlementsProvider>
    </DataProvider>,
  );
};

/** A RM 10.00 approved bill on table 1. */
async function tenRinggitTab() {
  const item = await d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-sides', name: 'Ten dish', priceSen: 1000 });
  const placed = await d.customer.placeOrder('demo-table-01', { lines: [{ itemId: item.id, qty: 1, optionIds: [] }] });
  await d.staff.approveOrder(placed.orderId);
  localStorage.setItem('lapar.staff.tab', JSON.stringify('tables'));
}

test('equal split of RM 10.00 three ways pays 334/333/333 and closes the tab', async () => {
  await tenRinggitTab();
  renderWith('pro', <StaffView shopId={SHOP} />);
  fireEvent.click(await screen.findByRole('button', { name: /Table 1/ }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Equally' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add one' }));
  fireEvent.click(screen.getByRole('button', { name: 'Card' }));
  expect(screen.getByText('Collect RM 3.34')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm paid' }));
  await waitFor(() => expect(screen.getAllByTestId('payment')).toHaveLength(1));
  expect(await screen.findByText('Collect RM 3.33')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm paid' }));
  await waitFor(() => expect(screen.getAllByTestId('payment')).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm paid' }));
  await waitFor(async () => expect((await d.staff.listTables(SHOP)).find((x) => x.label === 'Table 1')?.openTabs).toHaveLength(0));
});

test('item split pays the ticked lines only', async () => {
  const a = await d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-sides', name: 'Dish A', priceSen: 600 });
  const b = await d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-sides', name: 'Dish B', priceSen: 400 });
  const placed = await d.customer.placeOrder('demo-table-01', { lines: [a, b].map((i) => ({ itemId: i.id, qty: 1, optionIds: [] })) });
  await d.staff.approveOrder(placed.orderId);
  localStorage.setItem('lapar.staff.tab', JSON.stringify('tables'));
  renderWith('pro', <StaffView shopId={SHOP} />);
  fireEvent.click(await screen.findByRole('button', { name: /Table 1/ }));
  fireEvent.click(await screen.findByRole('radio', { name: 'By item' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Dish A/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Cash' }));
  expect(screen.getByText('Collect RM 6.00')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm paid' }));
  await waitFor(() => expect(screen.getAllByTestId('payment')).toHaveLength(1));
  expect(screen.queryByRole('checkbox', { name: /Dish A/ })).toBeNull();
  expect(screen.getByRole('checkbox', { name: /Dish B/ })).toBeTruthy();
});

test('a failed payment shows a readable message, not the code', async () => {
  await tenRinggitTab();
  renderWith('pro', <StaffView shopId={SHOP} />);
  fireEvent.click(await screen.findByRole('button', { name: /Table 1/ }));
  fireEvent.click(await screen.findByRole('radio', { name: 'By item' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Ten dish/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Cash' }));
  // Another device pays part of the bill by amount first, so the item split is now mixed.
  const tab = (await d.staff.listTables(SHOP)).find((x) => x.label === 'Table 1')!.openTabs[0]!;
  await d.staff.recordPayment({ tabId: tab.id, method: 'cash', amountSen: 300 });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm paid' }));
  expect(await screen.findByText(/cannot also be split by item/)).toBeTruthy();
  expect(screen.queryByText(/mixed_split/)).toBeNull();
});

test('Basic sees locked split and print instead of the Pro controls', async () => {
  await tenRinggitTab();
  renderWith('basic', <StaffView shopId={SHOP} />);
  fireEvent.click(await screen.findByRole('button', { name: /Table 1/ }));
  expect(await screen.findByText('Split the bill')).toBeTruthy();
  expect(screen.queryByRole('radio', { name: 'Equally' })).toBeNull();
  expect(screen.getAllByText('Pro').length).toBeGreaterThan(0);
});

test('print bill opens a 58 mm receipt preview', async () => {
  await tenRinggitTab();
  renderWith('pro', <StaffView shopId={SHOP} />);
  fireEvent.click(await screen.findByRole('button', { name: /Table 1/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Print bill' }));
  const preview = await screen.findByTestId('receipt-preview');
  expect(within(preview).getByText('Ten dish', { exact: false })).toBeTruthy();
  expect(preview.querySelector('.slip')?.className).toContain('w-[58mm]');
  expect(document.querySelector('#lapar-print-root')).toBeTruthy();
});

test('approving prints a ticket per order and station on Pro', async () => {
  const placed = await d.customer.placeOrder('demo-table-01', { lines: [{ itemId: 'item-nasi-lemak', qty: 1, optionIds: [] }] });
  expect(placed.orderId).toBeTruthy();
  renderWith('pro', <StaffView shopId={SHOP} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  const preview = await screen.findByTestId('receipt-preview');
  expect(preview.textContent).toContain('Nasi lemak');
  expect(preview.textContent).toContain('Kitchen ticket');
});

test('Pro tables tab opens the pickup board overlay with the shop token', async () => {
  localStorage.setItem('lapar.staff.tab', JSON.stringify('tables'));
  renderWith('pro', <StaffView shopId={SHOP} />);
  const token = (await d.owner.getShopSettings(SHOP)).pickupBoardToken!;
  fireEvent.click(await screen.findByRole('button', { name: 'Open pickup board' }));
  await waitFor(() => expect(document.querySelector(`[data-board-token="${token}"]`)).toBeTruthy());
});

test('ticket slips render inside a 58 mm container', () => {
  const slips = ticketSlips({ place: 'Table 1', createdAt: new Date().toISOString(), pickupAt: null, lines: [{ qty: 2, name: 'Teh', options: [], note: null, kind: 'item', stationId: 's1' }] }, [{ id: 's1', name: 'Drinks' }]);
  render(<PrintSheet slips={slips} onClose={() => undefined} />);
  const root = document.querySelector('#lapar-print-root')!;
  expect(root.querySelector('.slip')?.className).toContain('w-[58mm]');
  expect(root.textContent).toContain('Drinks');
});

test('kitchen station picker switches boards and is remembered', async () => {
  d.setPlan('pro');
  const water = await d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-drinks', stationId: 'station-drinks', name: 'Plain tea', priceSen: 200 });
  const eggs = await d.customer.placeOrder('demo-table-01', { lines: [{ itemId: water.id, qty: 1, optionIds: [] }] });
  await d.staff.approveOrder(eggs.orderId);
  renderWith('pro', <KitchenView shopId={SHOP} />);
  await screen.findByRole('radiogroup', { name: 'Station' });
  fireEvent.click(screen.getByRole('radio', { name: 'Drinks' }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'New' }).textContent).toContain('Plain tea'));
  expect(JSON.parse(localStorage.getItem('lapar.kitchen.station')!)).toBe('station-drinks');
  fireEvent.click(screen.getByRole('radio', { name: 'Kitchen' }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'New' }).textContent).not.toContain('Plain tea'));
});

test('custom columns: cards move through named columns with their column id', async () => {
  const board = await d.staff.getBoard(SHOP, null);
  const station = board.stationId;
  d.setPlan('pro');
  await d.pro.setBoardColumns(station, [
    { name: 'Queue', coreStatus: 'new' },
    { name: 'Prep', coreStatus: 'preparing' },
    { name: 'Wok', coreStatus: 'cooking' },
    { name: 'Pass', coreStatus: 'ready' },
  ]);
  const placed = await d.customer.placeOrder('demo-table-01', { lines: [{ itemId: 'item-nasi-lemak', qty: 1, optionIds: [] }] });
  await d.staff.approveOrder(placed.orderId);
  renderWith('pro', <KitchenView shopId={SHOP} />);
  const col = (n: string) => screen.getByRole('region', { name: n }).textContent;
  await waitFor(() => expect(col('Queue')).toContain('Nasi'));
  fireEvent.click(screen.getByRole('button', { name: /× Nasi/ }));
  await waitFor(() => expect(col('Prep')).toContain('Nasi'));
  const moved = (await d.staff.getBoard(SHOP, station)).lines[0]!;
  expect(moved.columnId).toBeTruthy();
});

test('kitchen shows a readable message when a move fails', async () => {
  const placed = await d.customer.placeOrder('demo-table-01', { lines: [{ itemId: 'item-nasi-lemak', qty: 1, optionIds: [] }] });
  await d.staff.approveOrder(placed.orderId);
  renderWith('basic', <KitchenView shopId={SHOP} />);
  const card = await screen.findByRole('button', { name: /× Nasi/ });
  // The line is cancelled elsewhere, so advancing it is no longer a valid step.
  const line = (await d.staff.getBoard(SHOP, null)).lines[0]!;
  await d.staff.advanceItem(line.id, 'cancelled');
  fireEvent.click(card);
  expect(await screen.findByText(/cannot be done at this step/)).toBeTruthy();
});
