import { beforeEach, expect, test, vi } from 'vitest';
import { LaparError } from '../types';

const client = { rpc: vi.fn(), from: vi.fn() };
vi.mock('./client', () => ({ getClient: () => Promise.resolve(client) }));
const { proApi, promoFromRow } = await import('./pro');

/** Chainable, awaitable query stub resolving to `result`. */
function query(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'single']) q[m] = vi.fn(() => q);
  q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
  return q;
}

beforeEach(() => {
  client.rpc.mockReset();
  client.from.mockReset();
});

test('promo row mapping: camelCase, HH:MM times, item ids from promo_items', () => {
  expect(
    promoFromRow({
      id: 'p1', shop_id: 's1', name: 'Happy hour', translations: {}, discount_type: 'percent', discount_value: 20,
      days: [1, 2], start_time: '15:00:00', end_time: '18:30:00', active: true, promo_items: [{ item_id: 'i1' }, { item_id: 'i2' }],
    }),
  ).toEqual({
    id: 'p1', shopId: 's1', name: 'Happy hour', translations: {}, discountType: 'percent', discountValue: 20,
    days: [1, 2], startTime: '15:00', endTime: '18:30', active: true, itemIds: ['i1', 'i2'],
  });
});

test('listPromos selects promos with embedded promo_items', async () => {
  const q = query({ data: [{ id: 'p', shop_id: 's', name: 'n', translations: {}, discount_type: 'amount', discount_value: 50, days: [7], start_time: '08:00:00', end_time: '10:00:00', active: false, promo_items: [] }], error: null });
  client.from.mockReturnValue(q);
  const rows = await proApi.listPromos('s');
  expect(client.from).toHaveBeenCalledWith('promos');
  expect((q.select as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain('promo_items(item_id)');
  expect(rows[0]).toMatchObject({ discountType: 'amount', startTime: '08:00', itemIds: [] });
});

test('RPCs use p_* arguments', async () => {
  client.rpc.mockResolvedValue({ data: { salesSen: 1 }, error: null });
  await proApi.getSalesReport('s', '2026-01-01', '2026-01-31');
  expect(client.rpc).toHaveBeenCalledWith('get_sales_report', { p_shop_id: 's', p_from: '2026-01-01', p_to: '2026-01-31' });
  await proApi.getUpsellReport('s', '2026-03');
  expect(client.rpc).toHaveBeenLastCalledWith('get_upsell_report', { p_shop_id: 's', p_month: '2026-03-01' });
  await proApi.setBoardColumns('st', [{ name: 'New', coreStatus: 'new' }]);
  expect(client.rpc).toHaveBeenLastCalledWith('set_board_columns', { p_station_id: 'st', p_columns: [{ id: null, name: 'New', coreStatus: 'new' }] });
});

test('database errors map through toLaparError', async () => {
  client.rpc.mockResolvedValue({ data: null, error: { message: 'feature_not_enabled', details: 'full_reports' } });
  await expect(proApi.exportShopMeta('s')).rejects.toMatchObject({ code: 'feature_not_enabled', detail: 'full_reports' });
  client.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(proApi.regeneratePickupBoardToken('s')).rejects.toBeInstanceOf(LaparError);
  client.from.mockReturnValue(query({ data: null, error: { code: '23503', message: 'fk' } }));
  await expect(proApi.deletePromo('p')).rejects.toMatchObject({ code: 'in_use' });
});
