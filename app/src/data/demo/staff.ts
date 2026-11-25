/** Staff API (DATA-MODEL 6.3), Basic rules. The demo device is always a signed-in member. */
import { canMove } from '../../lib/status';
import { roundCash } from '../../lib/money';
import {
  CORE_BOARD_STATUSES,
  type BoardColumnDTO,
  type BoardDTO,
  type BoardLineDTO,
  type BoardStatus,
  type PaidMethod,
  type PendingOrderDTO,
  type StaffApi,
  type TabDetailDTO,
  type TableOverviewDTO,
  type TabSummaryDTO,
} from '../types';
import type { OrderItemRow, PaymentRow } from './store';
import {
  assertShop,
  bySort,
  change,
  defaultStation,
  entitlements,
  fail,
  gate,
  linesOfOrder,
  nowIso,
  ordersOfTab,
  staffLine,
  tabMoney,
  tabOf,
  text,
  type Ctx,
} from './util';

const METHODS: readonly PaidMethod[] = ['cash', 'duitnow', 'card', 'other'];
const BOARD: readonly string[] = CORE_BOARD_STATUSES;

export function createStaffApi(ctx: Ctx): StaffApi {
  const s = () => ctx.s;
  const needOrder = (id: string) => s().orders.find((o) => o.id === id) ?? fail('not_found');
  const tableOf = (tabId: string) => {
    const tab = tabOf(s(), tabId) ?? fail('not_found');
    return { tab, table: s().tables.find((t) => t.id === tab.tableId) ?? fail('not_found') };
  };

  const boardLine = (l: OrderItemRow): BoardLineDTO => {
    const order = needOrder(l.orderId);
    const { tab, table } = tableOf(order.tabId);
    const all = linesOfOrder(s(), order.id).filter((x) => x.kind !== 'combo' && x.status !== 'cancelled');
    const parent = l.parentLineId ? s().orderItems.find((x) => x.id === l.parentLineId) : undefined;
    return {
      id: l.id,
      orderId: order.id,
      tabId: tab.id,
      tableLabel: table.label,
      tableKind: table.kind,
      pickupNo: tab.pickupNo,
      itemId: l.itemId,
      name: l.nameSnapshot,
      qty: l.qty,
      options: l.options,
      note: l.note,
      kind: l.kind === 'component' ? 'component' : 'item',
      parentName: parent?.nameSnapshot ?? null,
      status: l.status as BoardStatus,
      columnId: l.columnId,
      stationId: l.stationId,
      position: all.findIndex((x) => x.id === l.id) + 1,
      positionOf: all.length,
      approvedAt: order.approvedAt ?? order.createdAt,
      statusChangedAt: l.statusChangedAt,
    };
  };

  const boardLines = (keep: (l: OrderItemRow) => boolean): BoardLineDTO[] =>
    s()
      .orderItems.filter((l) => l.kind !== 'combo' && keep(l) && s().orders.find((o) => o.id === l.orderId)?.status === 'approved')
      .map((l) => ({ l, at: needOrder(l.orderId).approvedAt ?? '' }))
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(({ l }) => boardLine(l));

  const summary = (tabId: string): TabSummaryDTO => {
    const tab = tabOf(s(), tabId) ?? fail('not_found');
    const m = tabMoney(s(), tabId);
    const orders = ordersOfTab(s(), tabId);
    const readyLines = orders.filter((o) => o.status === 'approved').flatMap((o) => linesOfOrder(s(), o.id)).filter((l) => l.kind !== 'combo' && l.status === 'ready').length;
    return {
      id: tab.id,
      openedAt: tab.openedAt,
      pickupNo: tab.pickupNo,
      pickupAt: tab.pickupAt,
      totalSen: m.totalSen,
      paidSen: m.paidSen,
      remainingSen: Math.max(0, m.totalSen - m.paidSen),
      pendingOrders: orders.filter((o) => o.status === 'pending_approval').length,
      readyLines,
    };
  };

  return {
    async listPendingOrders(shopId): Promise<PendingOrderDTO[]> {
      assertShop(ctx, shopId);
      return s()
        .orders.filter((o) => o.status === 'pending_approval')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((o) => {
          const { tab, table } = tableOf(o.tabId);
          const lines = linesOfOrder(s(), o.id);
          return {
            orderId: o.id,
            tabId: tab.id,
            tableId: table.id,
            tableLabel: table.label,
            tableKind: table.kind,
            pickupNo: tab.pickupNo,
            pickupAt: tab.pickupAt,
            createdAt: o.createdAt,
            totalSen: lines.filter((l) => l.kind !== 'component').reduce((sum, l) => sum + l.lineTotalSen, 0),
            lines: lines.map(staffLine),
          };
        });
    },

    async approveOrder(orderId) {
      const order = needOrder(orderId);
      if (order.status !== 'pending_approval') fail('invalid_transition');
      const { tab } = tableOf(order.tabId);
      if (tab.status !== 'open') fail('tab_closed');
      const now = nowIso(ctx);
      order.status = 'approved';
      order.approvedAt = now;
      order.approvedByStaffId = s().actorStaffId;
      const touched = linesOfOrder(s(), order.id).filter((l) => l.status === 'pending');
      for (const l of touched) {
        l.status = 'new';
        l.statusChangedAt = now;
      }
      tab.updatedAt = now;
      ctx.emit(change('orders', 'UPDATE', order.id), change('tabs', 'UPDATE', tab.id), ...touched.map((l) => change('order_items', 'UPDATE', l.id)));
    },

    async rejectOrder(orderId, reason) {
      const order = needOrder(orderId);
      const clean = text(reason, 140, 'reason');
      if (order.status !== 'pending_approval') fail('invalid_transition');
      const now = nowIso(ctx);
      order.status = 'rejected';
      order.rejectedReason = clean;
      const touched = linesOfOrder(s(), order.id);
      for (const l of touched) {
        l.status = 'cancelled';
        l.statusChangedAt = now;
      }
      tabOf(s(), order.tabId)!.updatedAt = now;
      ctx.emit(change('orders', 'UPDATE', order.id), ...touched.map((l) => change('order_items', 'UPDATE', l.id)));
    },

    async listServiceRequests(shopId) {
      assertShop(ctx, shopId);
      return s()
        .requests.filter((r) => r.status !== 'done')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => ({
          id: r.id,
          tableId: r.tableId,
          tableLabel: s().tables.find((t) => t.id === r.tableId)?.label ?? '',
          tabId: r.tabId,
          reason: r.reason,
          note: r.note,
          status: r.status,
          tapCount: r.tapCount,
          createdAt: r.createdAt,
          acknowledgedAt: r.acknowledgedAt,
          updatedAt: r.updatedAt,
        }));
    },

    async acknowledgeRequest(requestId) {
      const r = s().requests.find((x) => x.id === requestId) ?? fail('not_found');
      if (r.status === 'done') fail('invalid_transition');
      if (r.status === 'acknowledged') return;
      r.status = 'acknowledged';
      r.acknowledgedAt = nowIso(ctx);
      ctx.emit(change('service_requests', 'UPDATE', r.id));
    },

    async completeRequest(requestId) {
      const r = s().requests.find((x) => x.id === requestId) ?? fail('not_found');
      if (r.status === 'done') return;
      r.status = 'done';
      r.doneAt = nowIso(ctx);
      ctx.emit(change('service_requests', 'UPDATE', r.id));
    },

    async listStations(shopId) {
      assertShop(ctx, shopId);
      return s().stations.filter((x) => x.active).sort(bySort);
    },

    async getBoard(shopId, stationId): Promise<BoardDTO> {
      assertShop(ctx, shopId);
      const station = stationId ? s().stations.find((x) => x.id === stationId) : defaultStation(s());
      if (!station) fail('not_found');
      const custom = entitlements(ctx).features.custom_columns ? s().boardColumns.filter((c) => c.stationId === station.id).sort(bySort) : [];
      const columns: BoardColumnDTO[] = custom.length
        ? custom.map((c) => ({ id: c.id, name: c.name, coreStatus: c.coreStatus, sort: c.sort }))
        : CORE_BOARD_STATUSES.map((coreStatus, sort) => ({ id: null, name: null, coreStatus, sort }));
      return {
        stationId: station.id,
        stationName: station.name,
        columns,
        lines: boardLines((l) => l.stationId === station.id && BOARD.includes(l.status)),
        serverNow: nowIso(ctx),
      };
    },

    async advanceItem(orderItemId, to, columnId) {
      const l = s().orderItems.find((x) => x.id === orderItemId) ?? fail('not_found');
      const order = needOrder(l.orderId);
      if (order.status !== 'approved' || l.kind === 'combo') fail('invalid_transition');
      if (!canMove(l.status, to, columnId != null)) fail('invalid_transition');
      if (columnId != null) {
        gate(ctx, 'custom_columns');
        const col = s().boardColumns.find((c) => c.id === columnId && c.stationId === l.stationId && c.coreStatus === to);
        if (!col) fail('invalid_input', 'column_id');
      }
      const now = nowIso(ctx);
      l.status = to;
      l.columnId = columnId ?? null;
      l.statusChangedAt = now;
      if (to === 'ready') l.readyAt = now;
      if (to === 'served') l.servedAt = now;
      tabOf(s(), order.tabId)!.updatedAt = now;
      ctx.emit(change('order_items', 'UPDATE', l.id));
    },

    async listReadyLines(shopId) {
      assertShop(ctx, shopId);
      return boardLines((l) => l.status === 'ready').sort((a, b) => a.statusChangedAt.localeCompare(b.statusChangedAt));
    },

    async listTables(shopId): Promise<TableOverviewDTO[]> {
      assertShop(ctx, shopId);
      const active = s().tables.filter((t) => t.active);
      const ordered = [...active.filter((t) => t.kind === 'table').sort(bySort), ...active.filter((t) => t.kind === 'counter').sort(bySort)];
      return ordered.map((t) => ({
        tableId: t.id,
        label: t.label,
        kind: t.kind,
        openRequests: s().requests.filter((r) => r.tableId === t.id && r.status !== 'done').length,
        openTabs: s()
          .tabs.filter((tab) => tab.tableId === t.id && tab.status === 'open')
          .sort((a, b) => a.openedAt.localeCompare(b.openedAt))
          .map((tab) => summary(tab.id)),
      }));
    },

    async getTabDetail(tabId): Promise<TabDetailDTO> {
      const { tab, table } = tableOf(tabId);
      const m = tabMoney(s(), tab.id);
      const orders = ordersOfTab(s(), tab.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return {
        id: tab.id,
        tableId: table.id,
        tableLabel: table.label,
        tableKind: table.kind,
        status: tab.status,
        openedAt: tab.openedAt,
        closedAt: tab.closedAt,
        pickupNo: tab.pickupNo,
        pickupAt: tab.pickupAt,
        orders: orders.map((o) => ({ id: o.id, status: o.status, createdAt: o.createdAt, approvedAt: o.approvedAt, rejectedReason: o.rejectedReason, lines: linesOfOrder(s(), o.id).map(staffLine) })),
        payments: s()
          .payments.filter((p) => p.tabId === tab.id)
          .map((p) => ({ id: p.id, method: p.method, amountSen: p.amountSen, roundingSen: p.roundingSen, createdAt: p.createdAt, orderItemIds: s().orderItems.filter((l) => l.paidPaymentId === p.id).map((l) => l.id) })),
        totalSen: m.totalSen,
        paidSen: m.paidSen,
        remainingSen: Math.max(0, m.totalSen - m.paidSen),
        roundingSen: m.roundingSen,
        hasPendingOrders: orders.some((o) => o.status === 'pending_approval'),
        serverNow: nowIso(ctx),
      };
    },

    async recordPayment(input) {
      const { tab } = tableOf(input?.tabId);
      if (tab.status !== 'open') fail('tab_closed');
      gate(ctx, 'manual_payments');
      if (!METHODS.includes(input.method)) fail('invalid_input', 'method');
      if (ordersOfTab(s(), tab.id).some((o) => o.status === 'pending_approval')) fail('pending_orders');
      const now = nowIso(ctx);
      const m = tabMoney(s(), tab.id);
      const remaining = Math.max(0, m.totalSen - m.paidSen);
      const close = () => {
        const paid = s().payments.filter((p) => p.tabId === tab.id);
        tab.status = 'closed';
        tab.closedAt = now;
        tab.paidTotalSen = paid.reduce((sum, p) => sum + p.amountSen, 0);
        tab.roundingSen = paid.reduce((sum, p) => sum + p.roundingSen, 0);
      };
      let payment: PaymentRow | null = null;
      let splitLines: OrderItemRow[] = [];
      if (input.orderItemIds?.length) {
        gate(ctx, 'bill_split');
        const paidByAmount = s().payments.some((p) => p.tabId === tab.id && !s().orderItems.some((l) => l.paidPaymentId === p.id));
        if (paidByAmount) fail('invalid_input', 'mixed_split');
        const ids = new Set(input.orderItemIds);
        const approved = new Set(ordersOfTab(s(), tab.id).filter((o) => o.status === 'approved').map((o) => o.id));
        splitLines = s().orderItems.filter((l) => ids.has(l.id));
        if (splitLines.length !== ids.size || splitLines.some((l) => !approved.has(l.orderId) || l.kind === 'component' || l.status === 'cancelled' || l.paidPaymentId)) fail('invalid_input', 'order_item_ids');
      }
      if (remaining > 0) {
        const amount = splitLines.length ? splitLines.reduce((sum, l) => sum + l.lineTotalSen, 0) : (input.amountSen ?? remaining);
        if (!Number.isInteger(amount) || amount < 1 || amount > remaining) fail('invalid_input', splitLines.length ? 'order_item_ids' : 'amount');
        if (amount < remaining && !splitLines.length) gate(ctx, 'bill_split');
        payment = {
          id: ctx.id('payment'),
          tabId: tab.id,
          method: input.method,
          amountSen: amount,
          roundingSen: input.method === 'cash' ? roundCash(amount) - amount : 0,
          createdAt: now,
          createdByStaffId: s().actorStaffId,
        };
        s().payments.push(payment);
        for (const l of splitLines) l.paidPaymentId = payment.id;
      }
      const after = tabMoney(s(), tab.id);
      const tabClosed = after.paidSen >= after.totalSen;
      if (tabClosed) close();
      tab.updatedAt = now;
      ctx.emit(change('tabs', 'UPDATE', tab.id));
      return {
        paymentId: payment?.id ?? null,
        amountSen: payment?.amountSen ?? 0,
        roundingSen: payment?.roundingSen ?? 0,
        remainingSen: Math.max(0, after.totalSen - after.paidSen),
        tabClosed,
      };
    },

    async listSoldOutItems(shopId) {
      assertShop(ctx, shopId);
      const cats = new Map(s().categories.map((c) => [c.id, c]));
      return s()
        .items.filter((i) => i.active)
        .sort((a, b) => (cats.get(a.categoryId)?.sort ?? 0) - (cats.get(b.categoryId)?.sort ?? 0) || a.sort - b.sort)
        .map((i) => ({ id: i.id, categoryId: i.categoryId, categoryName: cats.get(i.categoryId)?.name ?? '', name: i.name, soldOut: i.soldOut }));
    },

    async setSoldOut(itemId, soldOut) {
      const item = s().items.find((i) => i.id === itemId) ?? fail('not_found');
      item.soldOut = !!soldOut;
      ctx.emit();
    },
  };
}
