/** Pro owner API. Card M1-G implements these; until then each is gated, then not_implemented. */
import type { FeatureKey, ProApi } from '../types';
import { proTodo, type Ctx } from './util';

export function createProApi(ctx: Ctx): ProApi {
  const todo = (key: FeatureKey) => async (): Promise<never> => proTodo(ctx, key);
  return {
    saveStation: todo('multi_station'),
    getBoardColumns: todo('custom_columns'),
    setBoardColumns: todo('custom_columns'),
    listPromos: todo('promos'),
    savePromo: todo('promos'),
    deletePromo: todo('promos'),
    setComboComponents: todo('combos'),
    regeneratePickupBoardToken: todo('takeaway'),
    getSalesReport: todo('full_reports'),
    getUpsellReport: todo('upsell_report'),
    exportShopMeta: todo('export_backup'),
    exportOrders: todo('export_backup'),
  };
}
