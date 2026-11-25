/** Builds the export files (D31: orders are fetched in pages of at most 93 days). */
import type { BackupFile, IsoDate, OrdersExportDTO, ProApi } from '../../../data/types';
import { toCsv } from '../../../lib/csv';
import { addDays, mytDayOf, mytToday } from '../../../lib/time';

const PAGE_DAYS = 93;
const CSV = 'text/csv;charset=utf-8';

/** Every order and payment in [from, to], fetched in pages of PAGE_DAYS. */
export async function fetchOrders(pro: ProApi, shopId: string, from: IsoDate, to: IsoDate): Promise<OrdersExportDTO> {
  const out: OrdersExportDTO = { from, to, orders: [], payments: [] };
  for (let start = from; start <= to; start = addDays(start, PAGE_DAYS)) {
    const end = addDays(start, PAGE_DAYS - 1) < to ? addDays(start, PAGE_DAYS - 1) : to;
    const page = await pro.exportOrders(shopId, start, end);
    out.orders.push(...page.orders);
    out.payments.push(...page.payments);
  }
  return out;
}

const csv = (name: string, text: string): BackupFile => ({ name, mime: CSV, data: new Blob([text], { type: CSV }) });
const stamp = (from: IsoDate, to: IsoDate) => `${from}_${to}`;

export async function ordersCsv(pro: ProApi, shopId: string, from: IsoDate, to: IsoDate): Promise<BackupFile> {
  const d = await fetchOrders(pro, shopId, from, to);
  const rows = d.orders.flatMap((o) => o.lines.map((l) => ({ o, l })));
  return csv(
    `lapar-orders-${stamp(from, to)}.csv`,
    toCsv(rows, [
      { header: 'order_id', value: (r) => r.o.id },
      { header: 'created_at', value: (r) => r.o.createdAt },
      { header: 'status', value: (r) => r.o.status },
      { header: 'table', value: (r) => r.o.tableLabel },
      { header: 'pickup_no', value: (r) => r.o.pickupNo },
      { header: 'line_kind', value: (r) => r.l.kind },
      { header: 'item', value: (r) => r.l.name },
      { header: 'qty', value: (r) => r.l.qty },
      { header: 'unit_price_sen', value: (r) => r.l.unitPriceSen },
      { header: 'options_price_sen', value: (r) => r.l.optionsPriceSen },
      { header: 'line_total_sen', value: (r) => r.l.lineTotalSen },
      { header: 'line_status', value: (r) => r.l.status },
      { header: 'note', value: (r) => r.l.note },
    ]),
  );
}

export async function paymentsCsv(pro: ProApi, shopId: string, from: IsoDate, to: IsoDate): Promise<BackupFile> {
  const d = await fetchOrders(pro, shopId, from, to);
  return csv(
    `lapar-payments-${stamp(from, to)}.csv`,
    toCsv(d.payments, [
      { header: 'payment_id', value: (p) => p.id },
      { header: 'created_at', value: (p) => p.createdAt },
      { header: 'table', value: (p) => p.tableLabel },
      { header: 'method', value: (p) => p.method },
      { header: 'amount_sen', value: (p) => p.amountSen },
      { header: 'rounding_sen', value: (p) => p.roundingSen },
    ]),
  );
}

export async function salesByDayCsv(pro: ProApi, shopId: string, from: IsoDate, to: IsoDate): Promise<BackupFile> {
  const r = await pro.getSalesReport(shopId, from, to);
  return csv(
    `lapar-sales-by-day-${stamp(from, to)}.csv`,
    toCsv(r.byDay, [
      { header: 'day', value: (d) => d.day },
      { header: 'sales_sen', value: (d) => d.salesSen },
      { header: 'orders', value: (d) => d.orders },
      { header: 'bills', value: (d) => d.bills },
    ]),
  );
}

/** Shop meta plus every order and payment from the shop's creation (or the oldest day with data) to today. */
export async function fullJson(pro: ProApi, shopId: string): Promise<BackupFile> {
  const meta = await pro.exportShopMeta(shopId);
  const today = mytToday();
  const from = mytDayOf(meta.shop.createdAt) < addDays(today, -30) ? mytDayOf(meta.shop.createdAt) : addDays(today, -30);
  const { orders, payments } = await fetchOrders(pro, shopId, from, today);
  const text = JSON.stringify({ meta, orders, payments }, null, 2);
  return { name: `lapar-backup-${today}.json`, mime: 'application/json', data: new Blob([text], { type: 'application/json' }) };
}
