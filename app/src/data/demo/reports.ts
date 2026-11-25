/** Owner reports and exports (DATA-MODEL 6.4 and 6.5, DECISIONS D14, D31, D32), computed over the demo state. */
import { addDays, mytDayOf, mytParts, mytToday } from '../../lib/time';
import type {
  DailySummaryDTO,
  IsoDate,
  ItemSalesDTO,
  OrdersExportDTO,
  SalesReportDTO,
  ShopExportMeta,
  UpsellReportDTO,
} from '../types';
import type { OrderItemRow } from './store';
import { entitlements, fail, gate, nowIso, staffLine, type Ctx } from './util';

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

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const spanDays = (from: IsoDate, to: IsoDate): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const round1 = (x: number): number => Math.round(x * 10) / 10;

function checkRange(from: unknown, to: unknown, maxSpan: number): void {
  if (typeof from !== 'string' || typeof to !== 'string' || !DAY_RE.test(from) || !DAY_RE.test(to) || from > to || spanDays(from, to) > maxSpan) fail('invalid_input', 'range');
}

/** `assert_report_window`: the earliest visible day is MYT today - (N - 1) (D32); null = unlimited. */
function windowStart(ctx: Ctx): IsoDate | null {
  const days = entitlements(ctx).limits.report_history_days;
  return days === null ? null : addDays(mytToday(ctx.now()), -(days - 1));
}

/** Approved orders created in [from, to] (MYT) that have sellable lines (not cancelled, not components). */
function salesOrders(ctx: Ctx, from: IsoDate, to: IsoDate) {
  const orders = new Map<string, { tabId: string; day: IsoDate; hour: number; lines: OrderItemRow[] }>();
  for (const o of ctx.s.orders) {
    if (o.status !== 'approved') continue;
    const p = mytParts(new Date(o.createdAt));
    if (p.date >= from && p.date <= to) orders.set(o.id, { tabId: o.tabId, day: p.date, hour: p.hour, lines: [] });
  }
  for (const l of ctx.s.orderItems) {
    if (l.status !== 'cancelled' && l.kind !== 'component') orders.get(l.orderId)?.lines.push(l);
  }
  return [...orders.values()].filter((o) => o.lines.length > 0);
}

/** SQL `percentile_cont(0.5)` of a sorted list. */
const median = (v: number[]): number => (v.length % 2 ? v[v.length >> 1]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2);

const prepStats = (v: number[]) => ({ count: v.length, avgMinutes: round1(v.reduce((a, b) => a + b, 0) / v.length), medianMinutes: round1(median([...v].sort((a, b) => a - b))) });

export function getSalesReport(ctx: Ctx, from: IsoDate, to: IsoDate): SalesReportDTO {
  gate(ctx, 'full_reports');
  checkRange(from, to, 366);
  const min = windowStart(ctx);
  if (min && from < min) fail('outside_report_window');
  const s = ctx.s;

  const days = new Map<IsoDate, { salesSen: number; orders: number; tabs: Set<string> }>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { salesSen: 0, orders: 0, tabs: new Set() });
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, salesSen: 0, orders: 0 }));
  const byItem = new Map<string, ItemSalesDTO>(s.items.filter((i) => i.active).map((i) => [i.id, { itemId: i.id, name: i.name, qty: 0, revenueSen: 0 }]));
  const tabs = new Set<string>();
  let salesSen = 0;
  let orders = 0;
  for (const o of salesOrders(ctx, from, to)) {
    const sum = o.lines.reduce((a, l) => a + l.lineTotalSen, 0);
    const day = days.get(o.day)!;
    day.salesSen += sum;
    day.orders++;
    day.tabs.add(o.tabId);
    hours[o.hour]!.salesSen += sum;
    hours[o.hour]!.orders++;
    tabs.add(o.tabId);
    salesSen += sum;
    orders++;
    for (const l of o.lines) {
      const row = byItem.get(l.itemId);
      if (row) {
        row.qty += l.qty;
        row.revenueSen += l.lineTotalSen;
      }
    }
  }

  // Prep minutes: approval to ready, item and component lines whose ready_at falls in range.
  const approvedAt = new Map(s.orders.filter((o) => o.status === 'approved' && o.approvedAt).map((o) => [o.id, Date.parse(o.approvedAt!)]));
  const prepBy = new Map<string, number[]>();
  const all: number[] = [];
  for (const l of s.orderItems) {
    const a = approvedAt.get(l.orderId);
    if (a === undefined || !l.readyAt || l.status === 'cancelled') continue;
    const day = mytDayOf(l.readyAt);
    if (day < from || day > to) continue;
    const m = (Date.parse(l.readyAt) - a) / 60_000;
    all.push(m);
    prepBy.set(l.itemId, [...(prepBy.get(l.itemId) ?? []), m]);
  }

  return {
    from,
    to,
    salesSen,
    orders,
    bills: tabs.size,
    byDay: [...days].map(([day, d]) => ({ day, salesSen: d.salesSen, orders: d.orders, bills: d.tabs.size })),
    byHour: hours,
    items: [...byItem.values()].sort((a, b) => b.revenueSen - a.revenueSen || b.qty - a.qty || a.name.localeCompare(b.name)),
    prep: [...prepBy]
      .map(([itemId, v]) => ({ itemId, name: s.items.find((i) => i.id === itemId)?.name ?? itemId, ...prepStats(v) }))
      .sort((a, b) => b.avgMinutes - a.avgMinutes || a.name.localeCompare(b.name)),
    prepOverall: all.length ? prepStats(all) : { count: 0, avgMinutes: 0, medianMinutes: 0 },
  };
}

export function getUpsellReport(ctx: Ctx, month: string): UpsellReportDTO {
  gate(ctx, 'upsell_report');
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('invalid_input', 'month');
  const first = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  const min = windowStart(ctx);
  const from = min && min > first ? min : first;
  const names = new Map(ctx.s.items.map((i) => [i.id, i.name]));

  const sourceOrders = new Map<string, number>();
  const pairs = new Map<string, { sourceItemId: string; suggestedItemId: string; adds: number; revenueSen: number }>();
  let revenueSen = 0;
  let adds = 0;
  for (const o of salesOrders(ctx, from, last)) {
    // Orders containing the source item, once per order.
    for (const id of new Set(o.lines.map((l) => l.itemId))) sourceOrders.set(id, (sourceOrders.get(id) ?? 0) + 1);
    for (const l of o.lines) {
      if (!l.suggestedFromItemId) continue;
      const key = `${l.suggestedFromItemId}>${l.itemId}`;
      const row = pairs.get(key) ?? { sourceItemId: l.suggestedFromItemId, suggestedItemId: l.itemId, adds: 0, revenueSen: 0 };
      row.adds++;
      row.revenueSen += l.lineTotalSen;
      pairs.set(key, row);
      adds++;
      revenueSen += l.lineTotalSen;
    }
  }
  return {
    month,
    revenueSen,
    adds,
    rows: [...pairs.values()]
      .map((p) => ({
        ...p,
        sourceName: names.get(p.sourceItemId) ?? p.sourceItemId,
        suggestedName: names.get(p.suggestedItemId) ?? p.suggestedItemId,
        sourceOrders: sourceOrders.get(p.sourceItemId) ?? 0,
      }))
      .sort((a, b) => b.adds - a.adds || b.revenueSen - a.revenueSen || a.sourceName.localeCompare(b.sourceName)),
  };
}

export function exportShopMeta(ctx: Ctx): ShopExportMeta {
  gate(ctx, 'export_backup');
  const s = ctx.s;
  // No PIN hashes, pins or sessions: only these tables are copied (a JSON round trip detaches them from live state).
  const copy = JSON.parse(
    JSON.stringify({
      shop: s.shop, categories: s.categories, items: s.items, groups: s.groups, options: s.options, pairings: s.pairings,
      comboComponents: s.comboComponents, stations: s.stations, boardColumns: s.boardColumns, promos: s.promos, tables: s.tables, staff: s.staff,
    }),
  ) as Omit<ShopExportMeta, 'version' | 'exportedAt'>;
  return { version: 1, exportedAt: nowIso(ctx), ...copy };
}

function group<T>(rows: T[], key: (r: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k !== null) m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

export function exportOrders(ctx: Ctx, from: IsoDate, to: IsoDate): OrdersExportDTO {
  gate(ctx, 'export_backup');
  checkRange(from, to, 93);
  const s = ctx.s;
  const inRange = (iso: string) => {
    const d = mytDayOf(iso);
    return d >= from && d <= to;
  };
  const tabs = new Map(s.tabs.map((t) => [t.id, t]));
  const tables = new Map(s.tables.map((t) => [t.id, t]));
  const orders = s.orders.filter((o) => inRange(o.createdAt)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lines = group(s.orderItems, (l) => l.orderId);
  const paidLines = group(s.orderItems, (l) => l.paidPaymentId);
  return {
    from,
    to,
    orders: orders.map((o) => {
      const tab = tabs.get(o.tabId);
      const table = tables.get(tab?.tableId ?? '');
      return {
        id: o.id,
        status: o.status,
        createdAt: o.createdAt,
        approvedAt: o.approvedAt,
        rejectedReason: o.rejectedReason,
        lines: (lines.get(o.id) ?? []).sort((a, b) => a.lineNo - b.lineNo).map(staffLine),
        tabId: o.tabId,
        tableLabel: table?.label ?? '',
        tableKind: table?.kind ?? tab?.kind ?? 'table',
        pickupNo: tab?.pickupNo ?? null,
      };
    }),
    payments: s.payments
      .filter((p) => inRange(p.createdAt))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((p) => ({
        id: p.id,
        method: p.method,
        amountSen: p.amountSen,
        roundingSen: p.roundingSen,
        createdAt: p.createdAt,
        orderItemIds: (paidLines.get(p.id) ?? []).map((l) => l.id),
        tabId: p.tabId,
        tableLabel: tables.get(tabs.get(p.tabId)?.tableId ?? '')?.label ?? '',
      })),
  };
}
