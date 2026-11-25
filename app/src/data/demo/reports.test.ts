import { expect, test } from 'vitest';
import { addDays, mytDayOf, mytToday } from '../../lib/time';
import { generateHistory } from './history';
import { computeAutoPairings } from './pairings';
import { exportOrders, exportShopMeta, getDailySummary, getSalesReport, getUpsellReport } from './reports';
import { seedState } from './seed';
import { HISTORY_PREFIX, withoutHistory, type DemoState } from './store';
import type { Ctx } from './util';

const NOW = new Date('2026-11-25T04:00:00Z');
const TODAY = mytToday(NOW);

function build(plan: DemoState['plan'] = 'pro', now = NOW): { ctx: Ctx; today: string } {
  const base = seedState(now.toISOString());
  const h = generateHistory(base, mytToday(now));
  const s: DemoState = { ...base, plan, tabs: h.tabs, orders: h.orders, orderItems: h.orderItems, payments: h.payments };
  return { ctx: { s, now: () => now, id: (p) => `${p}-x`, emit: () => undefined }, today: mytToday(now) };
}

test('history is identical on two runs, covers 30 days, and is never persisted', () => {
  const a = generateHistory(seedState(NOW.toISOString()), TODAY);
  const b = generateHistory(seedState(NOW.toISOString()), TODAY);
  expect(b).toEqual(a);
  const days = new Set(a.orders.map((o) => mytDayOf(o.createdAt)));
  expect(days.size).toBe(30);
  expect([...days].sort()[0]).toBe(addDays(TODAY, -30));
  expect([...days].sort()[29]).toBe(addDays(TODAY, -1));
  for (const rows of [a.tabs, a.orders, a.orderItems, a.payments]) expect(rows.every((r) => r.id.startsWith(HISTORY_PREFIX))).toBe(true);
  const kept = withoutHistory({ ...seedState(NOW.toISOString()), ...a });
  expect(kept.orders).toHaveLength(0);
  // a different "today" gives different days
  expect(generateHistory(seedState(NOW.toISOString()), addDays(TODAY, 1))).not.toEqual(a);
});

test('history looks like a kopitiam: orders per day, peaks, drinks, suggestions, paid tabs', () => {
  const { ctx } = build();
  const s = ctx.s;
  const perDay = new Map<string, number>();
  for (const o of s.orders) perDay.set(mytDayOf(o.createdAt), (perDay.get(mytDayOf(o.createdAt)) ?? 0) + 1);
  for (const n of perDay.values()) expect(n).toBeGreaterThanOrEqual(18);
  const r = getSalesReport(ctx, addDays(TODAY, -30), TODAY);
  const hr = (h: number) => r.byHour[h]!.orders;
  expect(hr(8) + hr(9)).toBeGreaterThan(hr(15) + hr(16));
  expect(hr(12) + hr(13)).toBeGreaterThan(hr(15) + hr(16));
  const drinkOrders = new Set(s.orderItems.filter((l) => l.itemId.match(/teh|kopi|milo|sirap/)).map((l) => l.orderId)).size;
  expect(drinkOrders / s.orders.length).toBeGreaterThan(0.7);
  expect(s.orderItems.some((l) => l.suggestedFromItemId)).toBe(true);
  expect(s.tabs.every((t) => t.status === 'closed')).toBe(true);
  expect(s.payments).toHaveLength(s.tabs.length);
  expect(computeAutoPairings(s, NOW).length).toBeGreaterThan(0);
});

test('report totals equal the sum of days, hours, items; average bill rounds half up', () => {
  const { ctx } = build();
  const from = addDays(TODAY, -29);
  const r = getSalesReport(ctx, from, TODAY);
  expect(r.byDay).toHaveLength(30);
  expect(r.salesSen).toBe(r.byDay.reduce((a, d) => a + d.salesSen, 0));
  expect(r.orders).toBe(r.byDay.reduce((a, d) => a + d.orders, 0));
  expect(r.bills).toBe(r.byDay.reduce((a, d) => a + d.bills, 0));
  expect(r.byHour).toHaveLength(24);
  expect(r.byHour.reduce((a, h) => a + h.salesSen, 0)).toBe(r.salesSen);
  expect(r.items.reduce((a, i) => a + i.revenueSen, 0)).toBe(r.salesSen);
  expect(r.items).toHaveLength(ctx.s.items.filter((i) => i.active).length);
  expect(r.prepOverall.count).toBeGreaterThan(0);

  const day = r.byDay[5]!;
  const sum = getDailySummary(ctx, day.day);
  expect(sum.salesSen).toBe(day.salesSen);
  expect(sum.orders).toBe(day.orders);
  expect(sum.bills).toBe(day.bills);
  expect(sum.averageBillSen).toBe(Math.floor((2 * day.salesSen + day.bills) / (2 * day.bills)));
});

test('upsell report counts suggestion adds and take-up per pair', () => {
  const { ctx } = build();
  const month = TODAY.slice(0, 7);
  const u = getUpsellReport(ctx, month);
  const lines = ctx.s.orderItems.filter((l) => l.suggestedFromItemId && mytDayOf(l.createdAt).startsWith(month));
  expect(u.adds).toBe(lines.length);
  expect(u.revenueSen).toBe(lines.reduce((a, l) => a + l.lineTotalSen, 0));
  expect(u.rows.reduce((a, r) => a + r.adds, 0)).toBe(u.adds);
  for (const row of u.rows) expect(row.adds).toBeLessThanOrEqual(row.sourceOrders);
  expect(() => getUpsellReport(ctx, '2026-13')).toThrow();
});

test('gates, ranges and windows', () => {
  const { ctx } = build('basic');
  expect(() => getSalesReport(ctx, TODAY, TODAY)).toThrow(/feature_not_enabled/);
  expect(() => exportShopMeta(ctx)).toThrow(/feature_not_enabled/);
  const pro = build('pro').ctx;
  expect(() => getSalesReport(pro, TODAY, addDays(TODAY, -1))).toThrow(/invalid_input/);
  expect(() => getSalesReport(pro, addDays(TODAY, -400), TODAY)).toThrow(/invalid_input/);
  expect(() => exportOrders(pro, addDays(TODAY, -93), TODAY)).toThrow(/invalid_input/);
  expect(() => exportOrders(pro, addDays(TODAY, -92), TODAY)).not.toThrow();
});

test('export: meta has no secrets; orders and payments fall in range', () => {
  const { ctx } = build();
  const meta = exportShopMeta(ctx);
  expect(meta.version).toBe(1);
  expect(meta.items.length).toBeGreaterThan(0);
  expect(JSON.stringify(meta)).not.toMatch(/staffPins|"pin"/);
  const day = addDays(TODAY, -3);
  const e = exportOrders(ctx, day, day);
  expect(e.orders.length).toBeGreaterThan(0);
  expect(e.orders.every((o) => mytDayOf(o.createdAt) === day && o.lines.length > 0 && o.tableLabel)).toBe(true);
  expect(e.payments.length).toBe(e.orders.length);
});
