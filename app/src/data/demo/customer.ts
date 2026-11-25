/** Customer API (DATA-MODEL 6.1), Basic rules. Pro paths: card M1-G. */
import type {
  CustomerApi,
  CustomerOrderDTO,
  CustomerTabDTO,
  LineOption,
  MenuDTO,
  MenuItem,
  MenuSuggestion,
  OrderLineInput,
  PlaceOrderResult,
  PricedLine,
  ServiceReason,
} from '../types';
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
  nowIso,
  ordersOfTab,
  proTodo,
  tabMoney,
  tableByToken,
  text,
  type Ctx,
} from './util';

const REASONS: readonly ServiceReason[] = ['bill', 'water', 'other'];
const RATE_WINDOW_MS = 5 * 60_000;
const TABLE_RATE_LIMIT = 5;

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
        nudgeCategoryId: features.checkout_nudge ? s.shop.nudgeCategoryId : null,
      };
      const base = { shop, table: { label: table.label, kind: table.kind }, features, serverNow: nowIso(ctx) };
      if (!s.shop.active) return { ...base, categories: [], items: [] };

      const lang = features.multi_language_menu;
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
          s.autoPairings.filter((p) => p.sourceItemId === i.id).sort((a, b) => a.position - b.position).forEach((p) => add(p.suggestedItemId, 'auto'));
        return {
          id: i.id,
          categoryId: i.categoryId,
          name: i.name,
          description: i.description,
          translations: lang ? i.translations : {},
          priceSen: i.priceSen,
          effectivePriceSen: i.priceSen, // M1-G: promos
          promo: null,
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
        .map((c) => ({
          id: c.id,
          name: c.name,
          translations: lang ? c.translations : {},
          sort: c.sort,
          window: null, // M1-G: timed menus
          availableNow: true,
        }));
      return { ...base, categories, items };
    },

    async placeOrder(tableToken, input): Promise<PlaceOrderResult> {
      const s = ctx.s;
      const table = needTable(tableToken);
      if (!s.shop.active) fail('shop_inactive');
      gate(ctx, 'qr_ordering');
      const features = entitlements(ctx).features;
      if (table.kind === 'counter') proTodo(ctx, 'takeaway');
      if (input?.pickupAt != null) fail('invalid_input', 'pickup_at');
      const lines = input?.lines;
      if (!Array.isArray(lines) || lines.length < 1 || lines.length > 30) fail('invalid_input', 'lines');

      const since = ctx.now().getTime() - RATE_WINDOW_MS;
      const tableTabs = new Set(s.tabs.filter((t) => t.tableId === table.id).map((t) => t.id));
      const recent = s.orders.filter((o) => tableTabs.has(o.tabId) && new Date(o.createdAt).getTime() > since).length;
      if (recent >= TABLE_RATE_LIMIT) fail('rate_limited');

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
          proTodo(ctx, 'combos');
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
        // M1-G: timed menus and promos. Basic prices at the list price.
        const stationId = (features.multi_station && s.stations.find((x) => x.id === item.stationId && x.active)?.id) || defaultStation(s)?.id;
        if (!stationId) fail('not_found', 'station');
        return { item, qty, note, snapshot, optionsPriceSen, stationId, from };
      });

      const now = nowIso(ctx);
      let tab: TabRow | undefined = s.tabs.find((t) => t.tableId === table.id && t.status === 'open' && t.kind === 'table');
      const newTab = !tab;
      if (!tab) {
        tab = { id: ctx.id('tab'), tableId: table.id, kind: 'table', status: 'open', openedAt: now, closedAt: null, pickupNo: null, pickupAt: null, paidTotalSen: null, roundingSen: null, updatedAt: now };
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

      const priced: PricedLine[] = staged.map((l, i) => {
        const row: OrderItemRow = {
          id: ctx.id('line'),
          orderId: order.id,
          lineNo: i + 1,
          kind: 'item',
          parentLineId: null,
          itemId: l.item.id,
          nameSnapshot: l.item.name,
          listPriceSen: l.item.priceSen,
          unitPriceSen: l.item.priceSen,
          promoId: null,
          qty: l.qty,
          options: l.snapshot,
          optionsPriceSen: l.optionsPriceSen,
          lineTotalSen: l.qty * (l.item.priceSen + l.optionsPriceSen),
          note: l.note,
          stationId: l.stationId,
          status: needsApproval ? 'pending' : 'new',
          statusChangedAt: now,
          columnId: null,
          readyAt: null,
          servedAt: null,
          suggestedFromItemId: l.from,
          paidPaymentId: null,
          createdAt: now,
        };
        s.orderItems.push(row);
        return {
          lineId: row.id,
          itemId: row.itemId,
          kind: row.kind,
          name: row.nameSnapshot,
          qty: row.qty,
          listPriceSen: row.listPriceSen,
          unitPriceSen: row.unitPriceSen,
          optionsPriceSen: row.optionsPriceSen,
          lineTotalSen: row.lineTotalSen,
          promoId: null,
        };
      });
      tab.updatedAt = now;
      ctx.emit(change('tabs', newTab ? 'INSERT' : 'UPDATE', tab.id), change('orders', 'INSERT', order.id), ...priced.map((p) => change('order_items', 'INSERT', p.lineId)));
      return { orderId: order.id, tabId: tab.id, status: order.status, pickupNo: null, totalSen: priced.reduce((sum, p) => sum + p.lineTotalSen, 0), lines: priced };
    },

    async getTab(tableToken, tabId): Promise<CustomerTabDTO> {
      const s = ctx.s;
      const table = needTable(tableToken);
      if (table.kind === 'counter') return proTodo(ctx, 'takeaway');
      void tabId; // tables ignore the tab id
      const tab = s.tabs.find((t) => t.tableId === table.id && t.status === 'open');
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
      if (open) {
        // A repeat tap re-opens an acknowledged call (DECISIONS D26).
        open.tapCount += 1;
        open.note = clean ?? open.note;
        open.status = 'open';
        open.updatedAt = now;
        ctx.emit(change('service_requests', 'UPDATE', open.id));
        return;
      }
      const tab = s.tabs.find((t) => t.tableId === table.id && t.status === 'open');
      const row = { id: ctx.id('request'), tableId: table.id, tabId: tab?.id ?? null, reason, note: clean, status: 'open' as const, tapCount: 1, createdAt: now, updatedAt: now, acknowledgedAt: null, doneAt: null };
      s.requests.push(row);
      ctx.emit(change('service_requests', 'INSERT', row.id));
    },

    async getPickupBoard() {
      return fail('not_implemented', 'get_pickup_board');
    },
  };
}
