import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
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
