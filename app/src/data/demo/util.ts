/** Helpers shared by the demo modules: context, guards, money and DTO builders. */
import { PLAN_DEFAULTS, resolveEntitlements, withinLimit } from '../../entitlements/keys';
import {
  LaparError,
  type CustomerLineDTO,
  type Entitlements,
  type FeatureKey,
  type LaparErrorCode,
  type LimitKey,
  type ShopChange,
  type StaffLineDTO,
  type StationRow,
  type TableRow,
  type Uuid,
} from '../types';
import type { DemoState, OrderItemRow, OrderRow, TabRow } from './store';

export interface Ctx {
  /** Replaced wholesale on reset, so always read through `ctx.s`. */
  s: DemoState;
  now(): Date;
  /** Fresh readable id, e.g. `order-12`. */
  id(prefix: string): string;
  /** Row changes for `subscribeShop` plus `onChange` listeners; also schedules saving. */
  emit(...changes: ShopChange[]): void;
}

export const nowIso = (ctx: Ctx): string => ctx.now().toISOString();

export function fail(code: LaparErrorCode, detail?: string): never {
  throw new LaparError(code, detail);
}

export const entitlements = (ctx: Ctx): Entitlements => resolveEntitlements(PLAN_DEFAULTS[ctx.s.plan]);
export const has = (ctx: Ctx, key: FeatureKey): boolean => entitlements(ctx).features[key];

/** Server-side gate: the plan lacks the key. */
export function gate(ctx: Ctx, key: FeatureKey): void {
  if (!has(ctx, key)) fail('feature_not_enabled', key);
}

/** The key is on, but the demo does not implement it yet (card M1-G). */
export function proTodo(ctx: Ctx, key: FeatureKey): never {
  gate(ctx, key);
  return fail('not_implemented', key);
}

/** Limit check used when something is added or reactivated (DATA-MODEL 4 `enforce_limits`). */
export function assertWithinLimit(ctx: Ctx, key: LimitKey, count: number): void {
  if (!withinLimit(entitlements(ctx).limits[key], count)) fail('limit_reached', key);
}

export function assertShop(ctx: Ctx, shopId: Uuid): void {
  if (shopId !== ctx.s.shop.id) fail('forbidden');
}

/** Trimmed text of 1..max characters (or 0..max when `optional`); else invalid_input. */
export function text(value: unknown, max: number, field: string, optional = false): string {
  const t = typeof value === 'string' ? value.trim() : '';
  if (t.length > max || (!optional && t.length < 1)) fail('invalid_input', field);
  return t;
}

export const bySort = <T extends { sort: number }>(a: T, b: T): number => a.sort - b.sort;

export const defaultStation = (s: DemoState): StationRow | undefined =>
  s.stations.filter((x) => x.active).sort(bySort)[0];

export const tableByToken = (s: DemoState, token: string): TableRow | undefined =>
  typeof token === 'string' ? s.tables.find((t) => t.token === token && t.active) : undefined;

export const tabOf = (s: DemoState, id: Uuid): TabRow | undefined => s.tabs.find((t) => t.id === id);
export const linesOfOrder = (s: DemoState, orderId: Uuid): OrderItemRow[] =>
  s.orderItems.filter((l) => l.orderId === orderId).sort((a, b) => a.lineNo - b.lineNo);
export const ordersOfTab = (s: DemoState, tabId: Uuid): OrderRow[] => s.orders.filter((o) => o.tabId === tabId);

/** DATA-MODEL `tab_money`: totals count approved, not cancelled, non-component lines. */
export function tabMoney(s: DemoState, tabId: Uuid) {
  let totalSen = 0;
  let pendingSen = 0;
  for (const order of ordersOfTab(s, tabId)) {
    if (order.status !== 'approved' && order.status !== 'pending_approval') continue;
    for (const l of linesOfOrder(s, order.id)) {
      if (l.status === 'cancelled' || l.kind === 'component') continue;
      if (order.status === 'approved') totalSen += l.lineTotalSen;
      else pendingSen += l.lineTotalSen;
    }
  }
  let paidSen = 0;
  let roundingSen = 0;
  for (const p of s.payments) {
    if (p.tabId !== tabId) continue;
    paidSen += p.amountSen;
    roundingSen += p.roundingSen;
  }
  return { totalSen, pendingSen, paidSen, roundingSen };
}

export function customerLine(l: OrderItemRow): CustomerLineDTO {
  return {
    id: l.id,
    itemId: l.itemId,
    kind: l.kind,
    parentLineId: l.parentLineId,
    name: l.nameSnapshot,
    qty: l.qty,
    options: l.options,
    note: l.note,
    listPriceSen: l.listPriceSen,
    unitPriceSen: l.unitPriceSen,
    optionsPriceSen: l.optionsPriceSen,
    lineTotalSen: l.lineTotalSen,
    status: l.status,
  };
}

export const staffLine = (l: OrderItemRow): StaffLineDTO => ({
  ...customerLine(l),
  stationId: l.stationId,
  columnId: l.columnId,
  paidPaymentId: l.paidPaymentId,
  statusChangedAt: l.statusChangedAt,
});

export const change = (table: ShopChange['table'], event: ShopChange['event'], id: Uuid): ShopChange => ({ table, event, id });

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
