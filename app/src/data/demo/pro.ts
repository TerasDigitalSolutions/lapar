/** Pro owner API (DATA-MODEL 6.5): each method checks its feature key first, then the same rules as the SQL. */
import { CORE_BOARD_STATUSES, type BoardColumnRow, type ProApi, type PromoRow, type StationRow } from '../types';
import { newToken } from './owner';
import { exportOrders, exportShopMeta, getSalesReport, getUpsellReport } from './reports';
import { assertShop, assertWithinLimit, bySort, fail, gate, text, type Ctx } from './util';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const nextSort = (rows: { sort: number }[]) => rows.reduce((m, r) => Math.max(m, r.sort), -1) + 1;

export function createProApi(ctx: Ctx): ProApi {
  const s = () => ctx.s;
  const station = (id: string): StationRow => s().stations.find((x) => x.id === id) ?? fail('not_found');
  const columnsOf = (stationId: string) => s().boardColumns.filter((c) => c.stationId === stationId).sort(bySort);

  return {
    async saveStation(input) {
      gate(ctx, 'multi_station');
      assertShop(ctx, input.shopId);
      const name = text(input.name, 30, 'name');
      const existing = input.id ? station(input.id) : undefined;
      const active = input.active ?? existing?.active ?? true;
      const others = s().stations.filter((x) => x.active && x !== existing);
      if (active && !existing?.active) assertWithinLimit(ctx, 'max_stations', others.length);
      if (!active && existing?.active && !others.length) fail('invalid_input', 'last_station');
      const row: StationRow = existing ?? { id: ctx.id('station'), shopId: input.shopId, name, sort: nextSort(s().stations), active };
      if (!existing) s().stations.push(row);
      row.name = name;
      row.active = active;
      ctx.emit();
      return copy(row);
    },

    async getBoardColumns(stationId) {
      gate(ctx, 'custom_columns');
      station(stationId);
      return copy(columnsOf(stationId));
    },

    async setBoardColumns(stationId, columns) {
      gate(ctx, 'custom_columns');
      station(stationId);
      if (!Array.isArray(columns) || columns.length < 4 || columns.length > 12) fail('invalid_input', 'columns');
      const kept = columns.map((c) => c.id ?? null).filter((id): id is string => id !== null);
      const mine = new Set(columnsOf(stationId).map((c) => c.id));
      if (new Set(kept).size !== kept.length || kept.some((id) => !mine.has(id))) fail('invalid_input', 'columns');
      const order = columns.map((c) => CORE_BOARD_STATUSES.indexOf(c.coreStatus));
      if (order.some((n) => n < 0) || order.some((n, i) => i > 0 && n < order[i - 1]!) || CORE_BOARD_STATUSES.some((_, n) => !order.includes(n))) fail('invalid_input', 'columns');
      const names = columns.map((c) => text(c.name, 24, 'columns'));

      const rows: BoardColumnRow[] = columns.map((c, i) => {
        const row = c.id ? s().boardColumns.find((x) => x.id === c.id)! : { id: ctx.id('column'), shopId: s().shop.id, stationId, name: '', coreStatus: c.coreStatus, sort: 0 };
        return Object.assign(row, { name: names[i], coreStatus: c.coreStatus, sort: i });
      });
      s().boardColumns = [...s().boardColumns.filter((c) => c.stationId !== stationId), ...rows];
      // Cards in a removed (or re-typed) column fall back to the first column of their status.
      for (const l of s().orderItems) {
        if (l.columnId && !s().boardColumns.some((c) => c.id === l.columnId && c.coreStatus === l.status)) l.columnId = null;
      }
      ctx.emit();
      return copy(rows);
    },

    async listPromos(shopId) {
      gate(ctx, 'promos');
      assertShop(ctx, shopId);
      return copy(s().promos);
    },

    async savePromo(input) {
      gate(ctx, 'promos');
      assertShop(ctx, input.shopId);
      const name = text(input.name, 40, 'name');
      if (input.discountType !== 'percent' && input.discountType !== 'amount') fail('invalid_input', 'discount_type');
      const v = input.discountValue;
      if (!Number.isInteger(v) || v < 1 || (input.discountType === 'percent' && v > 100)) fail('invalid_input', 'discount_value');
      if (!Array.isArray(input.days) || !input.days.length || input.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) fail('invalid_input', 'days');
      if (!HHMM.test(input.startTime) || !HHMM.test(input.endTime) || input.startTime === input.endTime) fail('invalid_input', 'window');
      const itemIds = [...new Set(input.itemIds ?? [])];
      if (itemIds.some((id) => !s().items.some((i) => i.id === id))) fail('invalid_input', 'item_ids');
      const existing = input.id ? (s().promos.find((p) => p.id === input.id) ?? fail('not_found')) : undefined;
      const row: PromoRow = existing ?? { id: ctx.id('promo'), shopId: input.shopId, name, translations: {}, discountType: 'percent', discountValue: v, days: [], startTime: '', endTime: '', active: true, itemIds: [] };
      if (!existing) s().promos.push(row);
      Object.assign(row, {
        name,
        translations: copy(input.translations ?? {}),
        discountType: input.discountType,
        discountValue: v,
        days: [...input.days],
        startTime: input.startTime,
        endTime: input.endTime,
        active: input.active ?? true,
        itemIds,
      });
      ctx.emit();
      return copy(row);
    },

    async deletePromo(promoId) {
      gate(ctx, 'promos');
      const idx = s().promos.findIndex((p) => p.id === promoId);
      if (idx < 0) fail('not_found');
      s().promos.splice(idx, 1);
      for (const l of s().orderItems) if (l.promoId === promoId) l.promoId = null; // on delete set null
      ctx.emit();
    },

    async setComboComponents(comboItemId, components) {
      gate(ctx, 'combos');
      const combo = s().items.find((i) => i.id === comboItemId) ?? fail('not_found');
      if (!combo.isCombo) fail('invalid_input', 'combo_item_id');
      if (!Array.isArray(components) || components.length < 1 || components.length > 6) fail('invalid_input', 'components');
      if (new Set(components.map((c) => c.itemId)).size !== components.length) fail('invalid_input', 'components');
      for (const c of components) {
        const item = s().items.find((i) => i.id === c.itemId);
        if (!item || item.isCombo || !Number.isInteger(c.qty) || c.qty < 1 || c.qty > 10) fail('invalid_input', 'components');
      }
      s().comboComponents = [
        ...s().comboComponents.filter((c) => c.comboItemId !== comboItemId),
        ...components.map((c, sort) => ({ comboItemId, itemId: c.itemId, qty: c.qty, sort })),
      ];
      ctx.emit();
    },

    async regeneratePickupBoardToken(shopId) {
      gate(ctx, 'takeaway');
      assertShop(ctx, shopId);
      s().shop.pickupBoardToken = newToken();
      ctx.emit();
      return s().shop.pickupBoardToken!;
    },

    async getSalesReport(shopId) {
      assertShop(ctx, shopId);
      return getSalesReport(ctx);
    },
    async getUpsellReport(shopId) {
      assertShop(ctx, shopId);
      return getUpsellReport(ctx);
    },
    async exportShopMeta(shopId) {
      assertShop(ctx, shopId);
      return exportShopMeta(ctx);
    },
    async exportOrders(shopId) {
      assertShop(ctx, shopId);
      return exportOrders(ctx);
    },
  };
}
