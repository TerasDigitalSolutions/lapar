import type { BoardColumnRow, ProApi, PromoRow, StationRow, Translations, Uuid } from '../types';
import { getClient } from './client';
import { toLaparError } from './errors';
import { camelRow } from './rows';

/** Awaits a supabase call, throwing a LaparError on any failure (including a failed import). */
async function run<T>(call: (c: Awaited<ReturnType<typeof getClient>>) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  try {
    const { data, error } = await call(await getClient());
    if (error) throw error;
    return data as T;
  } catch (e) {
    throw toLaparError(e);
  }
}

const rpc = <T>(fn: string, args: Record<string, unknown>) => run<T>((c) => c.rpc(fn, args));

const STATION_COLS = 'id, shop_id, name, sort, active';
const PROMO_COLS = 'id, shop_id, name, translations, discount_type, discount_value, days, start_time, end_time, active, promo_items(item_id)';

type PromoDbRow = Record<string, unknown> & { start_time: string; end_time: string; promo_items?: { item_id: Uuid }[] };

/** promos row (+ embedded promo_items) -> PromoRow. Postgres `time` arrives as HH:MM:SS. */
export function promoFromRow(r: PromoDbRow): PromoRow {
  const { promo_items, start_time, end_time, ...rest } = r;
  return {
    ...camelRow<Omit<PromoRow, 'itemIds' | 'startTime' | 'endTime'>>(rest),
    translations: (r.translations ?? {}) as Translations,
    startTime: start_time.slice(0, 5),
    endTime: end_time.slice(0, 5),
    itemIds: (promo_items ?? []).map((p) => p.item_id),
  };
}

export const proApi: ProApi = {
  async saveStation(input) {
    if (input.id) {
      const patch: Record<string, unknown> = { name: input.name };
      if (input.active !== undefined) patch.active = input.active;
      const row = await run<Record<string, unknown>>((c) => c.from('stations').update(patch).eq('id', input.id!).eq('shop_id', input.shopId).select(STATION_COLS).single());
      return camelRow<StationRow>(row);
    }
    const last = await run<{ sort: number }[]>((c) => c.from('stations').select('sort').eq('shop_id', input.shopId).order('sort', { ascending: false }).limit(1));
    const row = await run<Record<string, unknown>>((c) =>
      c.from('stations').insert({ shop_id: input.shopId, name: input.name, sort: (last[0]?.sort ?? -1) + 1, active: input.active ?? true }).select(STATION_COLS).single(),
    );
    return camelRow<StationRow>(row);
  },

  async getBoardColumns(stationId) {
    const rows = await run<Record<string, unknown>[]>((c) =>
      c.from('board_columns').select('id, shop_id, station_id, name, core_status, sort').eq('station_id', stationId).order('sort'),
    );
    return rows.map((r) => camelRow<BoardColumnRow>(r));
  },

  setBoardColumns: (stationId, columns) =>
    rpc<BoardColumnRow[]>('set_board_columns', { p_station_id: stationId, p_columns: columns.map((c) => ({ id: c.id ?? null, name: c.name, coreStatus: c.coreStatus })) }),

  async listPromos(shopId) {
    const rows = await run<PromoDbRow[]>((c) => c.from('promos').select(PROMO_COLS).eq('shop_id', shopId).order('created_at'));
    return rows.map(promoFromRow);
  },

  savePromo: (input) => rpc<PromoRow>('save_promo', { p_promo: input }),

  async deletePromo(promoId) {
    await run((c) => c.from('promos').delete().eq('id', promoId));
  },

  async setComboComponents(comboItemId, components) {
    await rpc('set_combo_components', { p_combo_item_id: comboItemId, p_components: components });
  },

  regeneratePickupBoardToken: (shopId) => rpc<string>('regenerate_pickup_board_token', { p_shop_id: shopId }),
  getSalesReport: (shopId, from, to) => rpc('get_sales_report', { p_shop_id: shopId, p_from: from, p_to: to }),
  // p_month is a date: 'YYYY-MM' becomes the first of the month.
  getUpsellReport: (shopId, month) => rpc('get_upsell_report', { p_shop_id: shopId, p_month: `${month}-01` }),
  exportShopMeta: (shopId) => rpc('export_shop_meta', { p_shop_id: shopId }),
  exportOrders: (shopId, from, to) => rpc('export_orders', { p_shop_id: shopId, p_from: from, p_to: to }),
};
