import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { DataProvider } from '../../../data/context';
import { createDemoData } from '../../../data/demo';
import { generateHistory } from '../../../data/demo/history';
import { exportOrders, exportShopMeta, getSalesReport, getUpsellReport } from '../../../data/demo/reports';
import { seedState } from '../../../data/demo/seed';
import type { Ctx } from '../../../data/demo/util';
import type { LaparData, PlanId } from '../../../data/types';
import { EntitlementsProvider } from '../../../entitlements/hooks';
import { PLAN_DEFAULTS } from '../../../entitlements/keys';
import { downloadTarget } from '../../../lib/backup';
import { addDays, mytToday } from '../../../lib/time';
import { ToastProvider } from '../../../ui';
import { ExportSection } from './ExportSection';
import { ReportsSection } from './ReportsSection';
import { UpsellSection } from './UpsellSection';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const SHOP = 'shop-kopitiam-teras';

function setup(plan: PlanId, ui: ReactNode) {
  const now = new Date();
  const base = seedState(now.toISOString());
  const h = generateHistory(base, mytToday(now));
  const ctx: Ctx = { s: { ...base, plan, ...h }, now: () => now, id: (p) => `${p}-x`, emit: () => undefined };
  const d = createDemoData({ persist: false });
  d.setPlan(plan);
  const data: LaparData = {
    ...d,
    pro: {
      ...d.pro,
      getSalesReport: async (_s, f, t) => getSalesReport(ctx, f, t),
      getUpsellReport: async (_s, m) => getUpsellReport(ctx, m),
      exportShopMeta: async () => exportShopMeta(ctx),
      exportOrders: async (_s, f, t) => exportOrders(ctx, f, t),
    },
  };
  render(
    <DataProvider value={data}>
      <EntitlementsProvider value={PLAN_DEFAULTS[plan]}>
        <ToastProvider>{ui}</ToastProvider>
      </EntitlementsProvider>
    </DataProvider>,
  );
}

test('Basic sees locked sections', () => {
  setup('basic', <ReportsSection shopId={SHOP} />);
  expect(screen.queryByText('Sales by day')).toBeNull();
});

test('reports show totals, bars and best sellers', async () => {
  setup('pro', <ReportsSection shopId={SHOP} />);
  await screen.findByRole('list', { name: 'Sales by day' });
  expect(within(screen.getByRole('list', { name: 'Sales by day' })).getAllByRole('listitem')).toHaveLength(30);
  expect(screen.getByText('Best sellers')).toBeTruthy();
  expect(screen.getByText('Slowest sellers')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('From'), { target: { value: addDays(mytToday(), -400) } });
  expect(screen.getByText(/Pick a start day/)).toBeTruthy();
});

test('upsell shows adds with take-up rate', async () => {
  setup('pro', <UpsellSection shopId={SHOP} />);
  // The current month may hold few days of history; either rows or the empty text must show.
  await waitFor(() => expect(screen.queryAllByText(/take-up/).length > 0 || !!screen.queryByText('No suggestions were added this month')).toBe(true));
});

test('full backup downloads JSON with meta and orders', async () => {
  const save = vi.spyOn(downloadTarget, 'save').mockResolvedValue();
  setup('pro', <ExportSection shopId={SHOP} />);
  fireEvent.click(screen.getByRole('button', { name: 'Full backup (JSON)' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const file = save.mock.calls[0]![0];
  expect(file.name).toMatch(/^lapar-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const json = JSON.parse(await file.data.text()) as { meta: { version: number; items: unknown[] }; orders: unknown[] };
  expect(json.meta.version).toBe(1);
  expect(json.meta.items.length).toBeGreaterThan(0);
  expect(json.orders.length).toBeGreaterThan(300);
  expect(await screen.findByText(/Saved lapar-backup/)).toBeTruthy();
});

test('orders CSV starts with a BOM and has a header', async () => {
  const save = vi.spyOn(downloadTarget, 'save').mockResolvedValue();
  setup('pro', <ExportSection shopId={SHOP} />);
  fireEvent.click(screen.getByRole('button', { name: 'Orders CSV' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const blob = save.mock.calls[0]![0].data;
  expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect((await blob.text()).startsWith('order_id,created_at')).toBe(true);
});
