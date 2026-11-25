import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DataProvider } from '../../data/context';
import { createDemoData } from '../../data/demo';
import { LaparError, type LaparDemoData } from '../../data/types';
import { EntitlementsProvider } from '../../entitlements/hooks';
import { PLAN_DEFAULTS } from '../../entitlements/keys';
import { ToastProvider } from '../../ui';
import { StaffPinForm } from './StaffPinForm';
import { StaffView } from './StaffView';

const SHOP = 'shop-kopitiam-teras';
const NASI = { itemId: 'item-nasi-lemak', qty: 1, optionIds: [] as string[] };

let d: LaparDemoData;
beforeEach(() => {
  localStorage.clear();
  d = createDemoData({ persist: false });
});
afterEach(cleanup);

const renderStaff = () =>
  render(
    <DataProvider value={d}>
      <EntitlementsProvider value={PLAN_DEFAULTS.basic}>
        <ToastProvider>
          <StaffView shopId={SHOP} />
        </ToastProvider>
      </EntitlementsProvider>
    </DataProvider>,
  );

test('approve moves the order off the pending list', async () => {
  await d.customer.placeOrder('demo-table-01', { lines: [NASI] });
  renderStaff();
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(screen.queryAllByTestId('pending-order')).toHaveLength(0));
  expect(await d.staff.listPendingOrders(SHOP)).toHaveLength(0);
});

test('reject needs a reason', async () => {
  const placed = await d.customer.placeOrder('demo-table-01', { lines: [NASI] });
  renderStaff();
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reject order' }));
  expect(screen.getByText('Pick or write a reason.')).toBeTruthy();
  expect(await d.staff.listPendingOrders(SHOP)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Sold out' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reject order' }));
  await waitFor(() => expect(screen.queryAllByTestId('pending-order')).toHaveLength(0));
  const tab = await d.customer.getTab('demo-table-01');
  expect(tab.orders.find((o) => o.id === placed.orderId)?.rejectedReason).toBe('Sold out');
});

test('cash payment shows the rounded total and closes the tab', async () => {
  const item = await d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-sides', name: 'Odd dish', priceSen: 1233 });
  const placed = await d.customer.placeOrder('demo-table-01', { lines: [{ itemId: item.id, qty: 1, optionIds: [] }] });
  await d.staff.approveOrder(placed.orderId);
  localStorage.setItem('lapar.staff.tab', JSON.stringify('tables'));
  renderStaff();
  fireEvent.click(await screen.findByRole('button', { name: /Table 1/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cash' }));
  expect(screen.getByText('Collect RM 12.35')).toBeTruthy();
  expect(screen.getByText('Rounding RM 0.02')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm paid' }));
  await waitFor(async () => {
    const tables = await d.staff.listTables(SHOP);
    expect(tables.find((x) => x.label === 'Table 1')?.openTabs).toHaveLength(0);
  });
});

test('sold-out toggle updates the item', async () => {
  localStorage.setItem('lapar.staff.tab', JSON.stringify('soldout'));
  renderStaff();
  fireEvent.click(await screen.findByRole('switch', { name: 'Nasi lemak' }));
  await waitFor(async () => expect((await d.staff.listSoldOutItems(SHOP)).find((i) => i.id === 'item-nasi-lemak')?.soldOut).toBe(true));
});

test('PIN form validates and maps errors', async () => {
  const onSubmit = vi.fn().mockRejectedValue(new LaparError('invalid_pin'));
  render(<StaffPinForm onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByText('Enter the shop code.')).toBeTruthy();
  expect(screen.getByText('The PIN is 4 to 6 digits.')).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Shop code'), { target: { value: 'kopitiam-teras' } });
  for (const k of ['1', '2', '3']) fireEvent.click(screen.getByRole('button', { name: k }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(onSubmit).not.toHaveBeenCalled(); // 3 digits is too short

  fireEvent.click(screen.getByRole('button', { name: '4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('kopitiam-teras', '1234'));
  expect(await screen.findByText('That PIN is not right.')).toBeTruthy();
});

test('set meal components are indented under their set line in approvals', async () => {
  d.setPlan('pro');
  await d.customer.placeOrder('demo-table-01', { lines: [{ itemId: 'item-set-a', qty: 1, optionIds: [] }] });
  renderStaff();
  const order = await screen.findByTestId('pending-order');
  const comps = [...order.querySelectorAll('li.ml-4')];
  expect(comps.length).toBeGreaterThan(0);
  expect(comps.map((c) => c.textContent).join()).toContain('Nasi');
});

test('a failed approval opens no print preview on Pro', async () => {
  d.setPlan('pro');
  await d.customer.placeOrder('demo-table-01', { lines: [NASI] });
  vi.spyOn(d.staff, 'approveOrder').mockRejectedValue(new LaparError('invalid_transition'));
  render(
    <DataProvider value={d}>
      <EntitlementsProvider value={PLAN_DEFAULTS.pro}>
        <ToastProvider>
          <StaffView shopId={SHOP} />
        </ToastProvider>
      </EntitlementsProvider>
    </DataProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(vi.mocked(d.staff.approveOrder)).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByTestId('receipt-preview')).toBeNull();
});

test('the Counter tile is hidden on Basic', async () => {
  localStorage.setItem('lapar.staff.tab', JSON.stringify('tables'));
  renderStaff();
  expect(await screen.findByText('Table 1')).toBeTruthy();
  expect(screen.queryByText('Counter')).toBeNull();
});
