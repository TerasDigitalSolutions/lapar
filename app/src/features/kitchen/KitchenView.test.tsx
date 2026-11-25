import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createDemoData } from '../../data/demo';
import { DataProvider } from '../../data/context';
import { EntitlementsProvider } from '../../entitlements/hooks';
import { PLAN_DEFAULTS } from '../../entitlements/keys';
import { KitchenView } from './KitchenView';

afterEach(cleanup);
const SHOP = 'shop-kopitiam-teras';

test('tap a card through to Ready, then back and cancel', async () => {
  const d = createDemoData({ persist: false });
  const placed = await d.customer.placeOrder('demo-table-01', { lines: [{ itemId: 'item-nasi-lemak', qty: 2, optionIds: [] }] });
  await d.staff.approveOrder(placed.orderId);
  render(
    <DataProvider value={d}>
      <EntitlementsProvider value={PLAN_DEFAULTS.basic}>
        <KitchenView shopId={SHOP} />
      </EntitlementsProvider>
    </DataProvider>,
  );
  const inColumn = (name: string) => screen.getByRole('region', { name }).textContent;
  const tap = () => fireEvent.click(screen.getByRole('button', { name: /2 × Nasi/ }));
  await waitFor(() => expect(inColumn('New')).toContain('Nasi'));
  expect(inColumn('New')).toContain('Table 1');
  expect(inColumn('New')).toContain('1 of 1');

  tap();
  await waitFor(() => expect(inColumn('Preparing')).toContain('Nasi'));
  tap();
  await waitFor(() => expect(inColumn('Cooking')).toContain('Nasi'));
  tap();
  await waitFor(() => expect(inColumn('Ready')).toContain('Nasi'));

  fireEvent.click(screen.getByRole('button', { name: /More options/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Move back to Cooking' }));
  await waitFor(() => expect(inColumn('Cooking')).toContain('Nasi'));

  fireEvent.click(screen.getByRole('button', { name: /More options/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel this item' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel item' }));
  await waitFor(() => expect(screen.queryByText(/Nasi/)).toBeNull());
  expect((await d.staff.getBoard(SHOP, null)).lines).toHaveLength(0);
});

const renderKitchen = (d: ReturnType<typeof createDemoData>) =>
  render(
    <DataProvider value={d}>
      <EntitlementsProvider value={PLAN_DEFAULTS.basic}>
        <KitchenView shopId={SHOP} />
      </EntitlementsProvider>
    </DataProvider>,
  );

test('Start shift shows once per page load, not on every remount', async () => {
  const d = createDemoData({ persist: false });
  const first = renderKitchen(d);
  fireEvent.click(await screen.findByRole('button', { name: 'Start shift' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Start shift' })).toBeNull());
  first.unmount();
  renderKitchen(d);
  await waitFor(() => expect(screen.getByRole('region', { name: 'New' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Start shift' })).toBeNull();
});

test('the demo ignores navigator.onLine (it never uses the network)', async () => {
  const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  renderKitchen(createDemoData({ persist: false }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'New' })).toBeTruthy());
  expect(screen.queryByText(/No connection/)).toBeNull();
  spy.mockRestore();
});

test('a card names its table and minutes for screen readers', async () => {
  const d = createDemoData({ persist: false });
  const placed = await d.customer.placeOrder('demo-table-01', { lines: [{ itemId: 'item-nasi-lemak', qty: 1, optionIds: [] }] });
  await d.staff.approveOrder(placed.orderId);
  renderKitchen(d);
  expect(await screen.findByRole('button', { name: /Nasi.*Table 1, 1 of 1, \d+ min/ })).toBeTruthy();
});
