/** Customer API (DATA-MODEL 6.1), Basic rules. Pro paths: card M1-G. */
import { bestPromo, promoEndsAt } from '../../lib/pricing';
import { inWindow, mytDayOf, mytToday } from '../../lib/time';
import type {
  CustomerApi,
  CustomerOrderDTO,
  CustomerTabDTO,
  LineOption,
  MenuDTO,
  MenuItem,
  MenuSuggestion,
  OrderLineInput,
  PickupBoardDTO,
  PlaceOrderResult,
  PricedLine,
  ServiceReason,
} from '../types';
import { computeAutoPairings } from './pairings';
import type { OrderItemRow, OrderRow, TabRow } from './store';
import {
  bySort,
  change,
  customerLine,
  defaultStation,
  entitlements,
  fail,
  gate,
  linesOfOrder,
  menuNow,
  nowIso,
  ordersOfTab,
  tabMoney,
  tableByToken,
  text,
  type Ctx,
} from './util';

const REASONS: readonly ServiceReason[] = ['bill', 'water', 'other'];
const RATE_WINDOW_MS = 5 * 60_000;
const TABLE_RATE_LIMIT = 5;
const COUNTER_RATE_LIMIT = 20;
const DAY_MS = 86_400_000;
const CALL_THROTTLE_MS = 10_000;
// A table tab opened before today (MYT) is stale: customers no longer see it and the next order closes it.
const isStale = (ctx: Ctx, tab: TabRow) => mytDayOf(tab.openedAt) < mytToday(ctx.now());

export function createCustomerApi(ctx: Ctx): CustomerApi {
  const needTable = (token: string) => tableByToken(ctx.s, token) ?? fail('not_found');

  return {
    async getMenu(tableToken): Promise<MenuDTO> {
      const s = ctx.s;
      const table = needTable(tableToken);
      const { features } = entitlements(ctx);
      const shop = {
        id: s.shop.id,
        name: s.shop.name,
        slug: s.shop.slug,
        logoUrl: s.shop.logoUrl,
        active: s.shop.active,
        theme: s.shop.theme,
        nudgeCategoryId: features.checkout_nudge ? s.shop.nudgeCategoryId : null,
      };
      const base = { shop, table: { label: table.label, kind: table.kind }, features, serverNow: nowIso(ctx) };
      if (!s.shop.active) return { ...base, categories: [], items: [] };

      const lang = features.multi_language_menu;
      const at = menuNow(ctx);
      const auto = features.auto_pairings ? computeAutoPairings(s, ctx.now()) : [];
      const catSort = new Map(s.categories.map((c) => [c.id, c.sort]));
      const itemsById = new Map(s.items.map((i) => [i.id, i]));
      const rows = s.items
        .filter((i) => i.active && (!i.isCombo || features.combos))
        .sort((a, b) => (catSort.get(a.categoryId) ?? 0) - (catSort.get(b.categoryId) ?? 0) || a.sort - b.sort);

      const items: MenuItem[] = rows.map((i) => {
        const suggestions: MenuSuggestion[] = [];
        const add = (itemId: string, source: 'manual' | 'auto') => {
          if (itemsById.get(itemId)?.active && !suggestions.some((x) => x.itemId === itemId)) suggestions.push({ itemId, source });
        };
        if (features.manual_pairings)
          s.pairings.filter((p) => p.sourceItemId === i.id).sort((a, b) => a.position - b.position).forEach((p) => add(p.suggestedItemId, 'manual'));
        if (features.auto_pairings)
          auto.filter((p) => p.sourceItemId === i.id).sort((a, b) => a.position - b.position).forEach((p) => add(p.suggestedItemId, 'auto'));
        const best = features.promos ? bestPromo(i, s.promos, at) : null;
        return {
          id: i.id,
          categoryId: i.categoryId,
          name: i.name,
          description: i.description,
          translations: lang ? i.translations : {},
          priceSen: i.priceSen,
          effectivePriceSen: best?.priceSen ?? i.priceSen,
          promo: best ? { id: best.promo.id, name: best.promo.name, translations: lang ? best.promo.translations : {}, endsAt: promoEndsAt(best.promo, at) } : null,
          photoUrl: i.photoUrl,
          soldOut: i.soldOut,
          sort: i.sort,
          groups: s.groups
            .filter((g) => g.itemId === i.id)
            .sort(bySort)
            .map((g) => ({
              id: g.id,
              name: g.name,
              translations: lang ? g.translations : {},
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              options: s.options
                .filter((o) => o.groupId === g.id)
                .sort(bySort)
                .map((o) => ({ id: o.id, name: o.name, translations: lang ? o.translations : {}, priceDeltaSen: o.priceDeltaSen })),
            })),
          suggestions,
          combo:
            features.combos && i.isCombo
              ? {
                  components: s.comboComponents
                    .filter((c) => c.comboItemId === i.id)
                    .sort(bySort)
                    .flatMap((c) => {
                      const it = itemsById.get(c.itemId);
                      return it ? [{ itemId: it.id, name: it.name, translations: lang ? it.translations : {}, qty: c.qty }] : [];
                    }),
                }
              : null,
        };
      });

      // Demo only: categories with nothing to order are left out (the Sets category when combos are off).
      const used = new Set(items.map((i) => i.categoryId));
      const categories = s.categories
        .filter((c) => used.has(c.id))
        .sort(bySort)
        .map((c) => {
          const window = features.timed_menus ? c.window : null;
          return { id: c.id, name: c.name, translations: lang ? c.translations : {}, sort: c.sort, window, availableNow: !window || inWindow(window, at) };
        });
      return { ...base, categories, items };
    },

    async placeOrder(tableToken, input): Promise<PlaceOrderResult> {
      const s = ctx.s;
      const table = needTable(tableToken);
      if (!s.shop.active) fail('shop_inactive');
      gate(ctx, 'qr_ordering');
      const features = entitlements(ctx).features;
      const counter = table.kind === 'counter';
      if (counter) gate(ctx, 'takeaway');
      let pickupAt: string | null = null;
      if (input?.pickupAt != null) {
        const when = new Date(input.pickupAt);
        if (!counter || Number.isNaN(when.getTime()) || when.getTime() < ctx.now().getTime() - 60_000 || mytDayOf(when.toISOString()) !== mytToday(ctx.now())) fail('invalid_input', 'pickup_at');
        pickupAt = when.toISOString();
      }
      const lines = input?.lines;
      if (!Array.isArray(lines) || lines.length < 1 || lines.length > 30) fail('invalid_input', 'lines');

      const since = ctx.now().getTime() - RATE_WINDOW_MS;
      const tableTabs = new Set(s.tabs.filter((t) => t.tableId === table.id).map((t) => t.id));
      const recent = s.orders.filter((o) => tableTabs.has(o.tabId) && new Date(o.createdAt).getTime() > since).length;
      if (recent >= (counter ? COUNTER_RATE_LIMIT : TABLE_RATE_LIMIT)) fail('rate_limited');
      const at = menuNow(ctx);

      // Validate and price every line before changing anything.
      const staged = lines.map((raw: OrderLineInput) => {
        const qty = raw?.qty;
        if (!Number.isInteger(qty) || qty < 1 || qty > 99) fail('invalid_input', 'qty');
        const note = raw.note == null ? null : text(raw.note, 140, 'note', true) || null;
        const optionIds = raw.optionIds ?? [];
        if (!Array.isArray(optionIds) || new Set(optionIds).size !== optionIds.length) fail('invalid_input', 'option_ids');
        const from = raw.suggestedFromItemId ?? null;
        if (from !== null && !s.items.some((i) => i.id === from)) fail('invalid_input', 'suggested_from_item_id');
        const item = typeof raw.itemId === 'string' ? s.items.find((i) => i.id === raw.itemId) : undefined;
        if (!item || !item.active) fail('item_unavailable', String(raw.itemId));
        if (item.soldOut) fail('sold_out', item.id);
        if (item.isCombo) {
          gate(ctx, 'combos');
          if (optionIds.length) fail('invalid_input', 'option_ids');
          if (!s.comboComponents.some((c) => c.comboItemId === item.id && s.items.some((x) => x.id === c.itemId))) fail('item_unavailable', item.id);
        }
        if (features.timed_menus) {
          const window = s.categories.find((c) => c.id === item.categoryId)?.window;
          if (window && !inWindow(window, at)) fail('item_unavailable', item.id);
        }
        const groups = s.groups.filter((g) => g.itemId === item.id);
        const picked = optionIds.map((id) => s.options.find((o) => o.id === id && groups.some((g) => g.id === o.groupId)) ?? fail('invalid_input', 'option_ids'));
        if (picked.length && !features.modifiers) fail('feature_not_enabled', 'modifiers');
        for (const g of groups) {
          const n = picked.filter((o) => o.groupId === g.id).length;
          if (n < g.minSelect || n > g.maxSelect) fail('invalid_input', 'option_ids');
        }
        const snapshot: LineOption[] = picked.map((o) => ({
          groupId: o.groupId,
          groupName: groups.find((g) => g.id === o.groupId)?.name ?? '',
          optionId: o.id,
          name: o.name,
          priceDeltaSen: o.priceDeltaSen,
        }));
        const optionsPriceSen = snapshot.reduce((sum, o) => sum + o.priceDeltaSen, 0);
        const routed = (itemStationId: string) => (features.multi_station && s.stations.find((x) => x.id === itemStationId && x.active)?.id) || defaultStation(s)?.id;
        const best = features.promos ? bestPromo(item, s.promos, at) : null;
        const stationId = item.isCombo ? defaultStation(s)?.id : routed(item.stationId);
        if (!stationId) fail('not_found', 'station');
        const components = item.isCombo
          ? s.comboComponents
              .filter((c) => c.comboItemId === item.id)
              .sort(bySort)
              .flatMap((c) => {
                const it = s.items.find((x) => x.id === c.itemId);
                return it ? [{ item: it, qty: qty * c.qty, stationId: routed(it.stationId) ?? stationId }] : [];
              })
          : [];
        return { item, qty, note, snapshot, optionsPriceSen, stationId, from, unitSen: best?.priceSen ?? item.priceSen, promoId: best?.promo.id ?? null, components };
      });

      const now = nowIso(ctx);
      let tab: TabRow | undefined = counter ? undefined : s.tabs.find((t) => t.tableId === table.id && t.status === 'open' && t.kind === 'table');
      if (tab && isStale(ctx, tab)) {
        tab.status = 'closed';
        tab.closedAt = now;
        tab.updatedAt = now;
        ctx.emit(change('tabs', 'UPDATE', tab.id));
        tab = undefined;
      }
      const newTab = !tab;
      if (!tab) {
        let pickupNo: number | null = null;
        if (counter) {
          const day = mytToday(ctx.now());
          let row = s.pickupCounters.find((c) => c.day === day);
          if (!row) s.pickupCounters.push((row = { day, lastNo: 0 }));
          pickupNo = ++row.lastNo;
        }
        tab = { id: ctx.id('tab'), tableId: table.id, kind: table.kind, status: 'open', openedAt: now, closedAt: null, pickupNo, pickupAt, paidTotalSen: null, roundingSen: null, updatedAt: now };
        s.tabs.push(tab);
      }
      const mode = features.approvals ? s.shop.approvalMode : 'none';
      const hasApproved = ordersOfTab(s, tab.id).some((o) => o.status === 'approved');
      const needsApproval = mode === 'every_order' || (mode === 'first_order' && !hasApproved);
      const order: OrderRow = {
        id: ctx.id('order'),
        tabId: tab.id,
        status: needsApproval ? 'pending_approval' : 'approved',
        createdAt: now,
        approvedAt: needsApproval ? null : now,
        approvedByStaffId: null,
        rejectedReason: null,
      };
      s.orders.push(order);

      const priced: PricedLine[] = [];
      let lineNo = 0;
      const push = (row: Omit<OrderItemRow, 'id' | 'orderId' | 'lineNo' | 'status' | 'statusChangedAt' | 'columnId' | 'readyAt' | 'servedAt' | 'paidPaymentId' | 'createdAt' | 'lineTotalSen'>) => {
        const line: OrderItemRow = {
          ...row,
          id: ctx.id('line'),
          orderId: order.id,
          lineNo: ++lineNo,
          lineTotalSen: row.qty * (row.unitPriceSen + row.optionsPriceSen),
          status: needsApproval ? 'pending' : 'new',
          statusChangedAt: now,
          columnId: null,
          readyAt: null,
          servedAt: null,
          paidPaymentId: null,
          createdAt: now,
        };
        s.orderItems.push(line);
        priced.push({
          lineId: line.id,
          itemId: line.itemId,
          kind: line.kind,
          name: line.nameSnapshot,
          qty: line.qty,
          listPriceSen: line.listPriceSen,
          unitPriceSen: line.unitPriceSen,
          optionsPriceSen: line.optionsPriceSen,
          lineTotalSen: line.lineTotalSen,
          promoId: line.promoId,
        });
        return line;
      };
      for (const l of staged) {
        const parent = push({
          kind: l.item.isCombo ? 'combo' : 'item',
          parentLineId: null,
          itemId: l.item.id,
          nameSnapshot: l.item.name,
          listPriceSen: l.item.priceSen,
          unitPriceSen: l.unitSen,
          promoId: l.promoId,
          qty: l.qty,
          options: l.snapshot,
          optionsPriceSen: l.optionsPriceSen,
          note: l.note,
          stationId: l.stationId,
          suggestedFromItemId: l.from,
        });
        for (const c of l.components)
          push({ kind: 'component', parentLineId: parent.id, itemId: c.item.id, nameSnapshot: c.item.name, listPriceSen: 0, unitPriceSen: 0, promoId: null, qty: c.qty, options: [], optionsPriceSen: 0, note: l.note, stationId: c.stationId, suggestedFromItemId: null });
      }
      tab.updatedAt = now;
      ctx.emit(change('tabs', newTab ? 'INSERT' : 'UPDATE', tab.id), change('orders', 'INSERT', order.id), ...priced.map((p) => change('order_items', 'INSERT', p.lineId)));
      return { orderId: order.id, tabId: tab.id, status: order.status, pickupNo: tab.pickupNo, totalSen: priced.reduce((sum, p) => sum + p.lineTotalSen, 0), lines: priced };
    },

    async getTab(tableToken, tabId): Promise<CustomerTabDTO> {
      const s = ctx.s;
      const table = needTable(tableToken);
      let tab: TabRow | undefined;
      if (table.kind === 'counter') {
        if (typeof tabId !== 'string' || !tabId) fail('invalid_input', 'tab_id');
        tab = s.tabs.find((t) => t.id === tabId && t.tableId === table.id);
        if (!tab || ctx.now().getTime() - new Date(tab.openedAt).getTime() > DAY_MS) fail('not_found');
      } else {
        tab = s.tabs.find((t) => t.tableId === table.id && t.status === 'open' && !isStale(ctx, t)); // tables ignore the tab id
      }
      const orders: CustomerOrderDTO[] = tab
        ? ordersOfTab(s, tab.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((o) => ({ id: o.id, status: o.status, createdAt: o.createdAt, rejectedReason: o.rejectedReason, lines: linesOfOrder(s, o.id).map(customerLine) }))
        : [];
      const money = tab ? tabMoney(s, tab.id) : null;
      return {
        table: { label: table.label, kind: table.kind },
        tab: tab && money ? { id: tab.id, status: tab.status, openedAt: tab.openedAt, closedAt: tab.closedAt, pickupNo: tab.pickupNo, pickupAt: tab.pickupAt, totalSen: money.totalSen, pendingSen: money.pendingSen, paidSen: money.paidSen } : null,
        orders,
        openRequests: s.requests.filter((r) => r.tableId === table.id && r.status !== 'done').map((r) => ({ reason: r.reason, status: r.status, createdAt: r.createdAt })),
        serverNow: nowIso(ctx),
      };
    },

    async callServer(tableToken, reason, note) {
      const s = ctx.s;
      const table = needTable(tableToken);
      if (!s.shop.active) fail('shop_inactive');
      gate(ctx, 'call_server');
      if (!REASONS.includes(reason)) fail('invalid_input', 'reason');
      const clean = note == null ? null : text(note, 140, 'note', true) || null;
      const now = nowIso(ctx);
      const open = s.requests.find((r) => r.tableId === table.id && r.reason === reason && r.status !== 'done');
      if (open && open.status === 'open' && ctx.now().getTime() - new Date(open.updatedAt).getTime() < CALL_THROTTLE_MS) return; // throttled
      if (open) {
        // A repeat tap re-opens an acknowledged call (DECISIONS D26).
        open.tapCount += 1;
        open.note = clean ?? open.note;
        open.status = 'open';
        open.updatedAt = now;
        ctx.emit(change('service_requests', 'UPDATE', open.id));
        return;
      }
      const tab = s.tabs.find((t) => t.tableId === table.id && t.status === 'open' && !isStale(ctx, t));
      const row = { id: ctx.id('request'), tableId: table.id, tabId: tab?.id ?? null, reason, note: clean, status: 'open' as const, tapCount: 1, createdAt: now, updatedAt: now, acknowledgedAt: null, doneAt: null };
      s.requests.push(row);
      ctx.emit(change('service_requests', 'INSERT', row.id));
    },

    async getPickupBoard(boardToken): Promise<PickupBoardDTO> {
      const s = ctx.s;
      if (typeof boardToken !== 'string' || s.shop.pickupBoardToken !== boardToken) fail('not_found');
      gate(ctx, 'takeaway');
      const today = mytToday(ctx.now());
      const counters = new Set(s.tables.filter((t) => t.kind === 'counter').map((t) => t.id));
      const preparing: number[] = [];
      const ready: number[] = [];
      for (const tab of s.tabs) {
        if (!counters.has(tab.tableId) || tab.pickupNo === null || mytDayOf(tab.openedAt) !== today) continue;
        const orders = ordersOfTab(s, tab.id).filter((o) => o.status === 'approved');
        if (!orders.length) continue;
        const lines = orders.flatMap((o) => linesOfOrder(s, o.id)).filter((l) => l.kind !== 'combo' && l.status !== 'cancelled');
        if (!lines.length || lines.every((l) => l.status === 'served')) continue;
        if (lines.some((l) => l.status === 'new' || l.status === 'preparing' || l.status === 'cooking')) preparing.push(tab.pickupNo);
        else if (lines.some((l) => l.status === 'ready')) ready.push(tab.pickupNo);
      }
      const asc = (a: number, b: number) => a - b;
      return { shopName: s.shop.name, theme: s.shop.theme, preparing: preparing.sort(asc), ready: ready.sort(asc), serverNow: nowIso(ctx) };
    },
  };
}
