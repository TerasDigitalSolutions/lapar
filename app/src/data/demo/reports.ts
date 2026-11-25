/** Daily summary (DATA-MODEL 6.4 `get_daily_summary`, DECISIONS D14). */
import { addDays, mytDayOf, mytToday } from '../../lib/time';
import type { DailySummaryDTO, IsoDate, ItemSalesDTO } from '../types';
import { entitlements, fail, gate, type Ctx } from './util';

export function getDailySummary(ctx: Ctx, day: IsoDate): DailySummaryDTO {
  gate(ctx, 'daily_summary');
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('invalid_input', 'day');
  const today = mytToday(ctx.now());
  if (day > today) fail('invalid_input', 'day');
  const days = entitlements(ctx).limits.report_history_days;
  if (days !== null && day < addDays(today, -(days - 1))) fail('outside_report_window');

  const s = ctx.s;
  const orders = s.orders.filter((o) => o.status === 'approved' && mytDayOf(o.createdAt) === day);
  const ids = new Set(orders.map((o) => o.id));
  const lines = s.orderItems.filter((l) => ids.has(l.orderId) && l.status !== 'cancelled' && l.kind !== 'component');
  const salesSen = lines.reduce((sum, l) => sum + l.lineTotalSen, 0);
  const counted = new Set(lines.map((l) => l.orderId));
  const bills = new Set(orders.filter((o) => counted.has(o.id)).map((o) => o.tabId)).size;

  const byItem = new Map<string, ItemSalesDTO>();
  for (const l of lines) {
    const row = byItem.get(l.itemId) ?? { itemId: l.itemId, name: s.items.find((i) => i.id === l.itemId)?.name ?? l.nameSnapshot, qty: 0, revenueSen: 0 };
    row.qty += l.qty;
    row.revenueSen += l.lineTotalSen;
    byItem.set(l.itemId, row);
  }
  const topItems = [...byItem.values()].sort((a, b) => b.qty - a.qty || b.revenueSen - a.revenueSen || a.name.localeCompare(b.name)).slice(0, 5);

  return {
    day,
    salesSen,
    orders: counted.size,
    bills,
    // half up
    averageBillSen: bills ? Math.floor((2 * salesSen + bills) / (2 * bills)) : 0,
    topItems,
  };
}
