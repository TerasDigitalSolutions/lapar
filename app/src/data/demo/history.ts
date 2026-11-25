/**
 * Thirty days of generated order history (DATA-MODEL 11 "History", DECISIONS D27): MYT days
 * today-30..today-1, one seeded mulberry32 per day, so the same "today" always gives the same rows.
 * Rows carry HISTORY_PREFIX ids so index.ts merges them at load and never persists them.
 */
import { roundCash } from '../../lib/money';
import { mulberry32 } from '../../lib/rng';
import { addDays, mytParts } from '../../lib/time';
import type { IsoDate, ItemRow, PaidMethod } from '../types';
import { HISTORY_PREFIX, type DemoState, type HistoryRows, type OrderItemRow } from './store';

const DAYS = 30;
const MIN = 60_000;
/** Order-hour weights: breakfast, lunch and early-evening peaks. */
const HOUR_WEIGHT: [number, number][] = [[7, 3], [8, 5], [9, 4], [10, 1.5], [11, 2], [12, 5], [13, 5], [14, 2], [15, 1], [16, 1], [17, 1.5], [18, 3], [19, 3], [20, 2], [21, 0.5]];
const HOUR_TOTAL = HOUR_WEIGHT.reduce((a, [, w]) => a + w, 0);
/** Favourites are picked more often; everything else weighs 1. */
const FAVOURITE: Record<string, number> = { 'nasi-lemak': 3, 'roti-canai': 3, 'kaya-toast': 2, 'mee-goreng-mamak': 2, 'teh-tarik': 3, kopi: 2 };
/** main slug -> [paired slug, chance]; 25% of paired lines carry suggested_from_item_id. */
const PAIRED: Record<string, [string, number][]> = {
  'nasi-lemak': [['teh-tarik', 0.6]],
  'roti-canai': [['teh-tarik', 0.5], ['extra-kari', 0.3]],
  'kaya-toast': [['half-boiled-eggs', 0.7], ['kopi', 0.6]],
};

export function generateHistory(state: DemoState, today: IsoDate): HistoryRows {
  const out: HistoryRows = { tabs: [], orders: [], orderItems: [], payments: [] };
  const byCat = (slug: string): ItemRow[] => state.items.filter((i) => i.active && i.categoryId === `cat-${slug}`);
  const bySlug = (slug: string): ItemRow | undefined => state.items.find((i) => i.active && i.id === `item-${slug}`);
  const breakfast = byCat('breakfast');
  const mains = [...byCat('rice'), ...byCat('noodles')];
  const drinks = byCat('drinks');
  const sides = byCat('sides');
  const sets = byCat('sets').filter((i) => i.isCombo);
  const tables = state.tables.filter((t) => t.active && t.kind === 'table');
  const staffId = state.staff[0]?.id ?? null;
  if (!tables.length || !breakfast.length || !mains.length) return out;

  const weight = (i: ItemRow) => FAVOURITE[i.id.slice(5)] ?? 1;
  const pick = (rng: () => number, list: ItemRow[]): ItemRow => {
    let r = rng() * list.reduce((a, i) => a + weight(i), 0);
    for (const i of list) if ((r -= weight(i)) < 0) return i;
    return list[list.length - 1]!;
  };
  let n = 0;

  for (let d = DAYS; d >= 1; d--) {
    const day = addDays(today, -d);
    const rng = mulberry32(Number(day.replaceAll('-', '')) ^ 0x1a9a2);
    const dayStart = Date.parse(`${day}T00:00:00+08:00`);
    const weekend = mytParts(new Date(dayStart + 12 * 60 * MIN)).weekday >= 6;
    const count = Math.round((18 + Math.floor(rng() * 13)) * (weekend ? 1.3 : 1));

    for (let k = 0; k < count; k++) {
      n++;
      let hr = rng() * HOUR_TOTAL;
      let hour = 12;
      for (const [h, w] of HOUR_WEIGHT) {
        if ((hr -= w) < 0) {
          hour = h;
          break;
        }
      }
      const createdMs = dayStart + hour * 60 * MIN + Math.floor(rng() * 3600) * 1000;
      const created = new Date(createdMs).toISOString();
      const approvedMs = createdMs + (60 + Math.floor(rng() * 121)) * 1000;

      const picks: [ItemRow, string | null][] = [];
      const main = pick(rng, hour < 11 ? breakfast : mains);
      picks.push([main, null]);
      let hasDrink = false;
      for (const [slug, chance] of PAIRED[main.id.slice(5)] ?? []) {
        const paired = bySlug(slug);
        if (paired && rng() < chance) {
          picks.push([paired, rng() < 0.25 ? main.id : null]);
          hasDrink ||= paired.categoryId === 'cat-drinks';
        }
      }
      if (!hasDrink && drinks.length && rng() < 0.8) picks.push([pick(rng, drinks), null]);
      if (sides.length && rng() < 0.3) {
        const side = pick(rng, sides);
        if (!picks.some(([i]) => i.id === side.id)) picks.push([side, null]);
      }
      if (sets.length && rng() < 0.1) picks.push([pick(rng, sets), null]);

      const tabId = `${HISTORY_PREFIX}tab-${n}`;
      const orderId = `${HISTORY_PREFIX}order-${n}`;
      const lines: OrderItemRow[] = [];
      let totalSen = 0;
      let lastServedMs = approvedMs;
      const line = (item: ItemRow, kind: OrderItemRow['kind'], parent: string | null, qty: number, unit: number, from: string | null): string => {
        const drink = item.categoryId === 'cat-drinks';
        const readyMs = approvedMs + (drink ? 2 + Math.floor(rng() * 4) : 3 + Math.floor(rng() * 13)) * MIN;
        const servedMs = readyMs + MIN;
        lastServedMs = Math.max(lastServedMs, servedMs);
        const id = `${HISTORY_PREFIX}line-${n}-${lines.length + 1}`;
        const total = qty * unit;
        if (kind !== 'component') totalSen += total;
        lines.push({
          id, orderId, lineNo: lines.length + 1, kind, parentLineId: parent, itemId: item.id, nameSnapshot: item.name,
          listPriceSen: unit, unitPriceSen: unit, promoId: null, qty, options: [], optionsPriceSen: 0, lineTotalSen: total, note: null,
          stationId: item.stationId, status: 'served', statusChangedAt: new Date(servedMs).toISOString(), columnId: null,
          readyAt: new Date(readyMs).toISOString(), servedAt: new Date(servedMs).toISOString(), suggestedFromItemId: from, paidPaymentId: null, createdAt: created,
        });
        return id;
      };
      for (const [item, from] of picks) {
        const qty = rng() < 0.12 ? 2 : 1;
        const id = line(item, item.isCombo ? 'combo' : 'item', null, qty, item.priceSen, from);
        if (item.isCombo) {
          for (const c of state.comboComponents.filter((x) => x.comboItemId === item.id)) {
            const ci = state.items.find((i) => i.id === c.itemId);
            if (ci) line(ci, 'component', id, c.qty * qty, 0, null);
          }
        }
      }

      const r = rng();
      const method: PaidMethod = r < 0.6 ? 'cash' : r < 0.9 ? 'duitnow' : 'card';
      const rounding = method === 'cash' ? roundCash(totalSen) - totalSen : 0;
      const paidAt = new Date(lastServedMs + (1 + Math.floor(rng() * 4)) * MIN).toISOString();
      out.tabs.push({
        id: tabId, tableId: tables[Math.floor(rng() * tables.length)]!.id, kind: 'table', status: 'closed', openedAt: created, closedAt: paidAt,
        pickupNo: null, pickupAt: null, paidTotalSen: totalSen, roundingSen: rounding, updatedAt: paidAt,
      });
      out.orders.push({ id: orderId, tabId, status: 'approved', createdAt: created, approvedAt: new Date(approvedMs).toISOString(), approvedByStaffId: staffId, rejectedReason: null });
      out.orderItems.push(...lines);
      out.payments.push({ id: `${HISTORY_PREFIX}pay-${n}`, tabId, method, amountSen: totalSen, roundingSen: rounding, createdAt: paidAt, createdByStaffId: staffId });
    }
  }
  return out;
}
