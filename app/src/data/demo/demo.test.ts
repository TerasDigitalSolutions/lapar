import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoData } from './index';
import { STORAGE_KEY } from './store';
import { isLaparError, type LaparDemoData } from '../types';

const SHOP = 'shop-kopitiam-teras';
const T1 = 'demo-table-01';
const T2 = 'demo-table-02';
const NASI = { itemId: 'item-nasi-lemak', qty: 1, optionIds: [] as string[] };
const TEH = { itemId: 'item-teh-tarik', qty: 1, optionIds: ['opt-teh-tarik-ais'] };

let clock: Date;
const advance = (ms: number) => void (clock = new Date(clock.getTime() + ms));
const make = (): LaparDemoData => createDemoData({ persist: false, now: () => clock, history: false });
const rejects = async (p: Promise<unknown>, code: string, detail?: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isLaparError(err, code as never), `expected ${code}, got ${String(err)}`).toBe(true);
  if (detail) expect((err as { detail?: string }).detail).toBe(detail);
};

beforeEach(() => {
  clock = new Date('2026-11-25T04:00:00Z'); // 12:00 MYT
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('order lifecycle', () => {
  it('place -> approve -> new -> preparing -> cooking -> ready -> served -> paid', async () => {
    const d = make();
    // A price that needs cash rounding (all seed prices are multiples of 10 sen).
    const item = await d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-sides', name: 'Odd dish', priceSen: 1233 });
    const placed = await d.customer.placeOrder(T1, { lines: [{ itemId: item.id, qty: 1, optionIds: [] }] });
    expect(placed.status).toBe('pending_approval'); // first order of the tab
    expect(placed.totalSen).toBe(1233);
    expect(placed.lines[0]).toMatchObject({ listPriceSen: 1233, unitPriceSen: 1233, lineTotalSen: 1233, kind: 'item' });

    let tab = await d.customer.getTab(T1);
    expect(tab.tab).toMatchObject({ pendingSen: 1233, totalSen: 0 });
    expect(tab.orders[0]?.lines[0]?.status).toBe('pending');

    const pending = await d.staff.listPendingOrders(SHOP);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ orderId: placed.orderId, tableLabel: 'Table 1', totalSen: 1233 });
    await d.staff.approveOrder(placed.orderId);
    await rejects(d.staff.approveOrder(placed.orderId), 'invalid_transition');

    const lineId = placed.lines[0]!.lineId;
    // Drinks and food share one board on Basic: everything goes to the first station.
    const board = await d.staff.getBoard(SHOP, null);
    expect(board.stationName).toBe('Kitchen');
    expect(board.columns.map((c) => c.coreStatus)).toEqual(['new', 'preparing', 'cooking', 'ready']);
    expect(board.lines.map((l) => [l.id, l.status, l.position, l.positionOf])).toEqual([[lineId, 'new', 1, 1]]);

    await rejects(d.staff.advanceItem(lineId, 'cooking'), 'invalid_transition');
    for (const to of ['preparing', 'cooking', 'ready'] as const) await d.staff.advanceItem(lineId, to);
    expect((await d.staff.listReadyLines(SHOP)).map((l) => l.id)).toEqual([lineId]);
    await d.staff.advanceItem(lineId, 'served');
    expect(await d.staff.listReadyLines(SHOP)).toEqual([]);

    const detail = await d.staff.getTabDetail(placed.tabId);
    expect(detail).toMatchObject({ status: 'open', totalSen: 1233, remainingSen: 1233 });
    const paid = await d.staff.recordPayment({ tabId: placed.tabId, method: 'cash' });
    expect(paid).toMatchObject({ amountSen: 1233, roundingSen: 2, remainingSen: 0, tabClosed: true });
    const closed = await d.staff.getTabDetail(placed.tabId);
    expect(closed).toMatchObject({ status: 'closed', paidSen: 1233, roundingSen: 2 });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.payments).toHaveLength(1);
    await rejects(d.staff.recordPayment({ tabId: placed.tabId, method: 'cash' }), 'tab_closed');
    tab = await d.customer.getTab(T1);
    expect(tab.tab).toBeNull(); // the table is free again
  });

  it('prices on the server with option deltas and snapshots options', async () => {
    const d = make();
    const r = await d.customer.placeOrder(T1, {
      lines: [
        { itemId: 'item-nasi-lemak', qty: 2, optionIds: ['opt-nasi-lemak-telur-mata'], note: '  no sambal ', suggestedFromItemId: 'item-teh-tarik' },
        { ...TEH, optionIds: ['opt-teh-tarik-ais', 'opt-teh-tarik-bungkus'] },
      ],
    });
    expect(r.lines.map((l) => l.lineTotalSen)).toEqual([2 * (550 + 120), 220 + 30 + 20]);
    expect(r.totalSen).toBe(1340 + 270);
    const tab = await d.customer.getTab(T1);
    const [a, b] = tab.orders[0]!.lines;
    expect(a).toMatchObject({ note: 'no sambal', optionsPriceSen: 120 });
    expect(a!.options).toEqual([{ groupId: 'group-nasi-lemak-add', groupName: 'Tambah', optionId: 'opt-nasi-lemak-telur-mata', name: 'Telur mata', priceDeltaSen: 120 }]);
    expect(b!.options.map((o) => o.name)).toEqual(['Ais', 'Bungkus']);
  });

  it('approval modes', async () => {
    const d = make();
    const place = (token: string) => d.customer.placeOrder(token, { lines: [NASI] });

    // first_order (default): only the first order of a tab waits.
    expect((await place(T1)).status).toBe('pending_approval');
    expect((await place(T1)).status).toBe('pending_approval'); // still nothing approved on the tab
    const [first] = await d.staff.listPendingOrders(SHOP);
    await d.staff.approveOrder(first!.orderId);
    expect((await place(T1)).status).toBe('approved');

    await d.owner.updateShopSettings(SHOP, { approvalMode: 'every_order' });
    expect((await place(T1)).status).toBe('pending_approval');

    await d.owner.updateShopSettings(SHOP, { approvalMode: 'none' });
    const auto = await place(T2);
    expect(auto.status).toBe('approved');
    const board = await d.staff.getBoard(SHOP, null);
    expect(board.lines.filter((l) => l.orderId === auto.orderId)).toHaveLength(1);
  });

  it('rejecting cancels the lines, and the tab total ignores them', async () => {
    const d = make();
    const r = await d.customer.placeOrder(T1, { lines: [NASI] });
    await rejects(d.staff.rejectOrder(r.orderId, '   '), 'invalid_input', 'reason');
    await d.staff.rejectOrder(r.orderId, 'Kitchen closed');
    const tab = await d.customer.getTab(T1);
    expect(tab.orders[0]).toMatchObject({ status: 'rejected', rejectedReason: 'Kitchen closed' });
    expect(tab.orders[0]!.lines[0]!.status).toBe('cancelled');
    expect(tab.tab).toMatchObject({ totalSen: 0, pendingSen: 0 });
  });

  it('cannot pay while orders wait for approval', async () => {
    const d = make();
    const r = await d.customer.placeOrder(T1, { lines: [NASI] });
    await rejects(d.staff.recordPayment({ tabId: r.tabId, method: 'cash' }), 'pending_orders');
  });
});

describe('validation', () => {
  it('rate limits a table to 5 orders in 5 minutes', async () => {
    const d = make();
    await d.owner.updateShopSettings(SHOP, { approvalMode: 'none' });
    for (let i = 0; i < 5; i++) await d.customer.placeOrder(T1, { lines: [NASI] });
    await rejects(d.customer.placeOrder(T1, { lines: [NASI] }), 'rate_limited');
    await d.customer.placeOrder(T2, { lines: [NASI] }); // another table is fine
    advance(5 * 60_000);
    await d.customer.placeOrder(T1, { lines: [NASI] });
  });

  it('sold out, unavailable and unknown', async () => {
    const d = make();
    await d.staff.setSoldOut('item-nasi-lemak', true);
    await rejects(d.customer.placeOrder(T1, { lines: [NASI] }), 'sold_out', 'item-nasi-lemak');
    expect((await d.customer.getMenu(T1)).items.find((i) => i.id === 'item-nasi-lemak')?.soldOut).toBe(true);
    await d.staff.setSoldOut('item-nasi-lemak', false);
    await d.owner.saveItem({ ...(await d.owner.getMenuEditor(SHOP)).items.find((i) => i.id === 'item-nasi-lemak')!, active: false });
    await rejects(d.customer.placeOrder(T1, { lines: [NASI] }), 'item_unavailable', 'item-nasi-lemak');
    await rejects(d.customer.placeOrder(T1, { lines: [{ ...NASI, itemId: 'nope' }] }), 'item_unavailable');
    await rejects(d.customer.placeOrder('bad-token', { lines: [NASI] }), 'not_found');
  });

  it('option min and max', async () => {
    const d = make();
    const order = (optionIds: string[]) => d.customer.placeOrder(T1, { lines: [{ itemId: 'item-teh-tarik', qty: 1, optionIds }] });
    await rejects(order([]), 'invalid_input', 'option_ids'); // temp group needs exactly 1
    await rejects(order(['opt-teh-tarik-panas', 'opt-teh-tarik-ais']), 'invalid_input', 'option_ids'); // max 1
    await rejects(order(['opt-nasi-lemak-sambal']), 'invalid_input', 'option_ids'); // another item's option
    await rejects(order(['opt-teh-tarik-ais', 'opt-teh-tarik-ais']), 'invalid_input', 'option_ids'); // duplicate
    await order(['opt-teh-tarik-panas']);
    const nasi = (n: number) =>
      d.customer.placeOrder(T2, {
        lines: [{ itemId: 'item-nasi-lemak', qty: 1, optionIds: ['opt-nasi-lemak-telur-mata', 'opt-nasi-lemak-ayam-goreng', 'opt-nasi-lemak-sambal'].slice(0, n) }],
      });
    await nasi(3); // max 3
  });

  it('input bounds', async () => {
    const d = make();
    const line = (over: object) => d.customer.placeOrder(T1, { lines: [{ ...NASI, ...over }] });
    await rejects(d.customer.placeOrder(T1, { lines: [] }), 'invalid_input', 'lines');
    await rejects(d.customer.placeOrder(T1, { lines: Array(31).fill(NASI) }), 'invalid_input', 'lines');
    await rejects(line({ qty: 0 }), 'invalid_input', 'qty');
    await rejects(line({ qty: 100 }), 'invalid_input', 'qty');
    await rejects(line({ qty: 1.5 }), 'invalid_input', 'qty');
    await rejects(line({ note: 'x'.repeat(141) }), 'invalid_input', 'note');
    await rejects(line({ suggestedFromItemId: 'nope' }), 'invalid_input');
    await rejects(d.customer.placeOrder(T1, { lines: [NASI], pickupAt: clock.toISOString() }), 'invalid_input', 'pickup_at');
    await line({ qty: 99, note: 'x'.repeat(140) });
  });

  it('inactive shop and Pro-only paths', async () => {
    const d = make();
    await rejects(d.customer.placeOrder('demo-counter', { lines: [NASI] }), 'feature_not_enabled', 'takeaway');
    await rejects(d.customer.placeOrder(T1, { lines: [{ ...NASI, itemId: 'item-set-a' }] }), 'feature_not_enabled', 'combos');
    await rejects(d.customer.getPickupBoard('demo-pickup'), 'feature_not_enabled', 'takeaway');
    await d.admin.setShopActive(SHOP, false);
    expect((await d.customer.getMenu(T1)).shop.active).toBe(false);
    expect((await d.customer.getMenu(T1)).items).toEqual([]);
    await rejects(d.customer.placeOrder(T1, { lines: [NASI] }), 'shop_inactive');
  });
});

describe('menu', () => {
  it('shows the Basic menu only', async () => {
    const d = make();
    const menu = await d.customer.getMenu(T1);
    expect(menu.table).toEqual({ label: 'Table 1', kind: 'table' });
    expect(menu.categories.map((c) => c.name)).toEqual(['Drinks', 'Breakfast', 'Rice', 'Noodles', 'Sides']);
    expect(menu.items).toHaveLength(20); // no sets on Basic
    expect(menu.shop.nudgeCategoryId).toBe('cat-drinks');
    const nasi = menu.items.find((i) => i.id === 'item-nasi-lemak')!;
    expect(nasi.suggestions).toEqual([
      { itemId: 'item-teh-tarik', source: 'manual' },
      { itemId: 'item-telur-mata', source: 'manual' },
      { itemId: 'item-ayam-goreng', source: 'manual' },
    ]);
    expect(nasi.translations).toEqual({});
    expect(nasi.promo).toBeNull();
    expect(menu.features.full_reports).toBe(false);
    expect(menu.categories.every((c) => c.window === null && c.availableNow)).toBe(true);
  });

  it('results are copies', async () => {
    const d = make();
    const menu = await d.customer.getMenu(T1);
    menu.items[0]!.name = 'Changed';
    expect((await d.customer.getMenu(T1)).items[0]!.name).not.toBe('Changed');
  });
});

describe('server calls', () => {
  it('merges taps, reopens an acknowledged call, and reports open requests', async () => {
    const d = make();
    await d.customer.callServer(T1, 'bill');
    await d.customer.callServer(T1, 'bill', ' cash ');
    await d.customer.callServer(T1, 'water');
    let list = await d.staff.listServiceRequests(SHOP);
    expect(list.map((r) => [r.reason, r.tapCount, r.note, r.tableLabel])).toEqual([
      ['bill', 2, 'cash', 'Table 1'],
      ['water', 1, null, 'Table 1'],
    ]);
    const bill = list[0]!;
    await d.staff.acknowledgeRequest(bill.id);
    await d.staff.acknowledgeRequest(bill.id); // no-op
    expect((await d.staff.listServiceRequests(SHOP))[0]!.status).toBe('acknowledged');
    await d.customer.callServer(T1, 'bill');
    list = await d.staff.listServiceRequests(SHOP);
    expect(list[0]).toMatchObject({ status: 'open', tapCount: 3 });
    await d.staff.completeRequest(bill.id);
    await rejects(d.staff.acknowledgeRequest(bill.id), 'invalid_transition');
    await d.customer.callServer(T1, 'bill'); // a new request after done
    expect((await d.staff.listServiceRequests(SHOP)).filter((r) => r.reason === 'bill')).toHaveLength(1);
    expect((await d.customer.getTab(T1)).openRequests.map((r) => r.reason).sort()).toEqual(['bill', 'water']);
    await rejects(d.customer.callServer(T1, 'other', 'x'.repeat(141)), 'invalid_input', 'note');
  });

  it('shows open tables and open requests to staff', async () => {
    const d = make();
    await d.customer.placeOrder(T1, { lines: [NASI] });
    await d.customer.callServer(T1, 'water');
    const tables = await d.staff.listTables(SHOP);
    expect(tables).toHaveLength(11);
    expect(tables[0]).toMatchObject({ label: 'Table 1', openRequests: 1 });
    expect(tables[0]!.openTabs[0]).toMatchObject({ pendingOrders: 1, totalSen: 0 });
    expect(tables.at(-1)!.kind).toBe('counter');
  });
});

describe('payments', () => {
  it('Basic cannot split a bill', async () => {
    const d = make();
    await d.owner.updateShopSettings(SHOP, { approvalMode: 'none' });
    const r = await d.customer.placeOrder(T1, { lines: [NASI, NASI] });
    await rejects(d.staff.recordPayment({ tabId: r.tabId, method: 'cash', amountSen: 500 }), 'feature_not_enabled', 'bill_split');
    await rejects(d.staff.recordPayment({ tabId: r.tabId, method: 'cash', orderItemIds: [r.lines[0]!.lineId] }), 'feature_not_enabled', 'bill_split');
    await rejects(d.staff.recordPayment({ tabId: r.tabId, method: 'cash', amountSen: 5000 }), 'invalid_input', 'amount');
    // paying the full remaining amount explicitly is fine
    const paid = await d.staff.recordPayment({ tabId: r.tabId, method: 'duitnow', amountSen: 1100 });
    expect(paid).toMatchObject({ roundingSen: 0, tabClosed: true });
  });
});

describe('limits and staff', () => {
  it('Basic allows 15 tables and 3 staff', async () => {
    const d = make();
    for (let i = 11; i <= 15; i++) await d.owner.saveTable({ shopId: SHOP, label: `Table ${i}` });
    await rejects(d.owner.saveTable({ shopId: SHOP, label: 'Table 16' }), 'limit_reached', 'max_tables');
    await rejects(d.owner.saveTable({ shopId: SHOP, label: 'table 15' }), 'invalid_input', 'label');
    await rejects(d.owner.saveTable({ shopId: SHOP, label: 'Bar', kind: 'counter' }), 'feature_not_enabled', 'takeaway');
    const plan = await d.owner.getShopPlan(SHOP);
    expect(plan.usage).toEqual({ tables: 15, stations: 2, staff: 2 });

    await d.owner.addStaff(SHOP, 'Siti', '2468');
    await rejects(d.owner.addStaff(SHOP, 'Four', '1357'), 'limit_reached', 'max_staff');
    // deactivating frees a seat; reactivating hits the limit again
    const siti = (await d.owner.listStaff(SHOP)).find((m) => m.name === 'Siti')!;
    await d.owner.updateStaff(siti.id, { active: false });
    await d.owner.addStaff(SHOP, 'Four', '1357');
    await rejects(d.owner.updateStaff(siti.id, { active: true }), 'limit_reached', 'max_staff');
  });

  it('refuses duplicate and malformed PINs', async () => {
    const d = make();
    await rejects(d.owner.addStaff(SHOP, 'Clone', '1234'), 'duplicate_pin');
    await rejects(d.owner.addStaff(SHOP, 'Bad', '12'), 'invalid_input', 'pin');
    await rejects(d.owner.addStaff(SHOP, '', '2468'), 'invalid_input', 'name');
    const ravi = (await d.owner.listStaff(SHOP)).find((m) => m.name === 'Ravi')!;
    await rejects(d.owner.resetStaffPin(ravi.id, '1234'), 'duplicate_pin');
    await d.owner.resetStaffPin(ravi.id, '5678'); // own PIN is fine
    await d.owner.resetStaffPin(ravi.id, '4321');
    expect((await d.auth.claimStaffSession('kopitiam-teras', '4321')).staffName).toBe('Ravi');
  });

  it('claims a staff session, then locks the shop after 5 wrong PINs for 10 minutes', async () => {
    const d = make();
    expect(await d.auth.getUser()).toMatchObject({ isAnonymous: false });
    expect((await d.auth.claimStaffSession('kopitiam-teras', '1234')).staffName).toBe('Aminah');
    await rejects(d.auth.claimStaffSession('nowhere', '1234'), 'not_found');
    for (let i = 0; i < 4; i++) await rejects(d.auth.claimStaffSession('kopitiam-teras', '0000'), 'invalid_pin');
    await rejects(d.auth.claimStaffSession('kopitiam-teras', '0000'), 'pin_locked');
    await rejects(d.auth.claimStaffSession('kopitiam-teras', '1234'), 'pin_locked'); // right PIN is refused too
    advance(10 * 60_000 + 1000);
    expect((await d.auth.claimStaffSession('kopitiam-teras', '5678')).staffName).toBe('Ravi');
    // approvals are recorded for the signed-in staff member
    expect((await d.auth.getStaffSession())?.staffId).toBe('staff-ravi');
  });
});

describe('owner menu editing', () => {
  it('categories: create, rename, in_use, delete', async () => {
    const d = make();
    const cat = await d.owner.saveCategory({ shopId: SHOP, name: 'Desserts' });
    expect(cat.sort).toBe(6);
    await d.owner.saveCategory({ shopId: SHOP, id: cat.id, name: 'Sweets' });
    await rejects(d.owner.deleteCategory('cat-drinks'), 'in_use');
    await d.owner.deleteCategory(cat.id);
    await rejects(d.owner.deleteCategory(cat.id), 'not_found');
    await rejects(d.owner.saveCategory({ shopId: SHOP, name: ' ' }), 'invalid_input', 'name');
  });

  it('items, options and reordering', async () => {
    const d = make();
    const item = await d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-sides', name: 'Keropok', priceSen: 300 });
    expect(item).toMatchObject({ stationId: 'station-kitchen', sort: 3, active: true, photoState: 'none' });
    await rejects(d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-sides', name: 'X', priceSen: -1 }), 'invalid_input', 'price_sen');
    await rejects(d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-sides', name: 'X', priceSen: 1, isCombo: true }), 'feature_not_enabled', 'combos');
    const group = await d.owner.saveModifierGroup({ shopId: SHOP, itemId: item.id, name: 'Size', minSelect: 1, maxSelect: 1 });
    await rejects(d.owner.saveModifierGroup({ shopId: SHOP, itemId: item.id, name: 'Bad', minSelect: 2, maxSelect: 1 }), 'invalid_input');
    await rejects(d.owner.saveModifierOption({ shopId: SHOP, groupId: group.id, name: 'Neg', priceDeltaSen: -10 }), 'invalid_input', 'price_delta_sen');
    const opt = await d.owner.saveModifierOption({ shopId: SHOP, groupId: group.id, name: 'Large', priceDeltaSen: 100 });
    const r = await d.customer.placeOrder(T1, { lines: [{ itemId: item.id, qty: 1, optionIds: [opt.id] }] });
    expect(r.totalSen).toBe(400);
    await d.owner.deleteModifierGroup(group.id);
    expect((await d.owner.getMenuEditor(SHOP)).options.some((o) => o.id === opt.id)).toBe(false);

    await d.owner.reorder('items', ['item-ayam-goreng', 'item-telur-mata']);
    const sides = (await d.owner.getMenuEditor(SHOP)).items.filter((i) => ['item-ayam-goreng', 'item-telur-mata'].includes(i.id));
    expect(sides.map((i) => [i.id, i.sort])).toEqual([['item-ayam-goreng', 0], ['item-telur-mata', 1]]);
    await rejects(d.owner.reorder('items', ['nope']), 'not_found');
  });

  it('pairings, table tokens and photos', async () => {
    const d = make();
    await d.owner.setPairings('item-kopi', ['item-kaya-toast', 'item-roti-canai']);
    expect((await d.customer.getMenu(T1)).items.find((i) => i.id === 'item-kopi')!.suggestions.map((s) => s.itemId)).toEqual(['item-kaya-toast', 'item-roti-canai']);
    await rejects(d.owner.setPairings('item-kopi', ['item-kopi']), 'invalid_input');
    await rejects(d.owner.setPairings('item-kopi', ['item-a', 'item-b', 'item-c', 'item-d']), 'invalid_input');
    const before = (await d.owner.listTables(SHOP))[0]!;
    const after = await d.owner.regenerateTableToken(before.id);
    expect(after.token).not.toBe(before.token);
    expect(after.token.length).toBeGreaterThanOrEqual(22);
    await rejects(d.customer.getMenu(before.token), 'not_found');
    const photo = await d.owner.uploadItemPhoto(SHOP, 'item-kopi', new Blob(['x'], { type: 'image/webp' }));
    expect(photo).toMatchObject({ photoState: 'staging' });
    expect(photo.photoUrl).toMatch(/^data:/);
  });

  it('shop settings', async () => {
    const d = make();
    await d.owner.updateShopSettings(SHOP, { name: 'Kopitiam Baru', nudgeCategoryId: null });
    expect(await d.owner.getShopSettings(SHOP)).toMatchObject({ name: 'Kopitiam Baru', nudgeCategoryId: null, planId: 'basic' });
    await rejects(d.owner.updateShopSettings(SHOP, { nudgeCategoryId: 'nope' }), 'invalid_input');
    await rejects(d.owner.updateShopSettings('other-shop', { name: 'x' }), 'forbidden');
  });
});

describe('daily summary', () => {
  it('counts approved, not cancelled lines of orders created that MYT day', async () => {
    const d = make();
    await d.owner.updateShopSettings(SHOP, { approvalMode: 'none' });
    const a = await d.customer.placeOrder(T1, { lines: [{ ...NASI, qty: 2 }, TEH] });
    await d.customer.placeOrder(T1, { lines: [NASI] });
    await d.customer.placeOrder(T2, { lines: [TEH] });
    await d.staff.advanceItem(a.lines[1]!.lineId, 'cancelled');
    await d.owner.updateShopSettings(SHOP, { approvalMode: 'every_order' });
    await d.customer.placeOrder(T2, { lines: [NASI] }); // pending: not counted
    const s = await d.owner.getDailySummary(SHOP, '2026-11-25');
    expect(s).toMatchObject({ day: '2026-11-25', salesSen: 3 * 550 + 250, orders: 3, bills: 2, averageBillSen: Math.round((3 * 550 + 250) / 2) });
    expect(s.topItems.map((t) => [t.itemId, t.qty, t.revenueSen])).toEqual([
      ['item-nasi-lemak', 3, 1650],
      ['item-teh-tarik', 1, 250],
    ]);
    expect((await d.owner.getDailySummary(SHOP, '2026-11-24')).salesSen).toBe(0);
    await rejects(d.owner.getDailySummary(SHOP, '2026-11-26'), 'invalid_input', 'day');
    await rejects(d.owner.getDailySummary(SHOP, '2026-10-26'), 'outside_report_window'); // 30 days: Nov 25 back to Oct 27
    await d.owner.getDailySummary(SHOP, '2026-10-27');
  });

  it('after midnight MYT the day rolls over', async () => {
    const d = make();
    clock = new Date('2026-11-25T15:59:00Z'); // 23:59 MYT
    await d.owner.updateShopSettings(SHOP, { approvalMode: 'none' });
    await d.customer.placeOrder(T1, { lines: [NASI] });
    advance(2 * 60_000); // 00:01 on the 26th
    expect((await d.owner.getDailySummary(SHOP, '2026-11-25')).salesSen).toBe(550);
    expect((await d.owner.getDailySummary(SHOP, '2026-11-26')).salesSen).toBe(0);
  });
});

describe('plan, Pro stubs and admin', () => {
  it('flips entitlements with the plan and keeps data', async () => {
    const d = make();
    expect(d.getPlan()).toBe('basic');
    expect((await d.getEntitlements(SHOP)).features.bill_split).toBe(false);
    expect((await d.getEntitlements(SHOP)).limits.max_tables).toBe(15);
    await d.customer.placeOrder(T1, { lines: [NASI] });
    d.setPlan('pro');
    expect((await d.getEntitlements(SHOP)).features.bill_split).toBe(true);
    expect((await d.getEntitlements(SHOP)).limits.max_tables).toBeNull();
    expect((await d.customer.getMenu(T1)).features.promos).toBe(true);
    expect((await d.customer.getMenu(T1)).items.some((i) => i.id === 'item-set-a')).toBe(true);
    expect((await d.staff.listPendingOrders(SHOP)).length).toBe(1);
    expect((await d.pro.getSalesReport(SHOP, '2026-11-01', '2026-11-25')).byDay.length).toBeGreaterThan(0);
    d.setPlan('basic');
    await rejects(d.pro.listPromos(SHOP), 'feature_not_enabled', 'promos');
    await rejects(d.pro.exportShopMeta(SHOP), 'feature_not_enabled', 'export_backup');
  });

  it('admin lists the demo shop and refuses the rest', async () => {
    const d = make();
    const [shop] = await d.admin.listShops();
    expect(shop).toMatchObject({ name: 'Kopitiam Teras', planId: 'basic', lastOrderAt: null });
    expect(await d.admin.getPlatformSettings()).toEqual({ whatsappNumber: null });
    await rejects(d.admin.createShop({ name: 'x', slug: 'xx' }), 'not_implemented');
  });
});

describe('events', () => {
  it('reports changes to subscribers and onChange listeners', async () => {
    const d = make();
    const changes: string[] = [];
    const states: string[] = [];
    let any = 0;
    const off = d.subscribeShop(SHOP, (c) => changes.push(c.table), (s) => states.push(s));
    d.onChange(() => any++);
    await d.customer.placeOrder(T1, { lines: [NASI] });
    expect(states).toEqual(['live']);
    expect(changes).toEqual(expect.arrayContaining(['tabs', 'orders', 'order_items']));
    expect(any).toBe(1);
    off();
    changes.length = 0;
    await d.customer.callServer(T1, 'bill');
    expect(changes).toEqual([]);
  });
});

describe('persistence', () => {
  it('saves live state (debounced) and restores it', async () => {
    vi.useFakeTimers();
    const d = createDemoData({ now: () => clock });
    const r = await d.customer.placeOrder(T1, { lines: [NASI] });
    d.setPlan('pro');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // not yet
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    const again = createDemoData({ now: () => clock });
    expect(again.getPlan()).toBe('pro');
    expect((await again.staff.listPendingOrders(SHOP)).map((o) => o.orderId)).toEqual([r.orderId]);
    // ids keep counting from the saved sequence
    const r2 = await again.customer.placeOrder(T2, { lines: [NASI] });
    expect(r2.orderId).not.toBe(r.orderId);
  });

  it('falls back to the seed on bad JSON or another version', async () => {
    localStorage.setItem(STORAGE_KEY, '{bad');
    expect(createDemoData().getPlan()).toBe('basic');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, plan: 'pro' }));
    expect(createDemoData().getPlan()).toBe('basic');
  });

  it('works when localStorage throws', async () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const d = createDemoData({ now: () => clock });
    await d.customer.placeOrder(T1, { lines: [NASI] });
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect((await d.staff.listPendingOrders(SHOP)).length).toBe(1);
  });

  it('reset() restores the seed and clears saved state', async () => {
    vi.useFakeTimers();
    const d = createDemoData({ now: () => clock });
    await d.customer.placeOrder(T1, { lines: [NASI] });
    await d.owner.addStaff(SHOP, 'Siti', '2468');
    d.setPlan('pro');
    d.setClock('lunch');
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    d.reset();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(d.getPlan()).toBe('basic');
    expect(d.getClock()).toBe('real');
    expect(await d.staff.listPendingOrders(SHOP)).toEqual([]);
    expect(await d.owner.listStaff(SHOP)).toHaveLength(2);
    expect((await d.getEntitlements(SHOP)).features.bill_split).toBe(false);
  });

  it('exposes the demo QR tokens', () => {
    const d = make();
    expect(d.tables.map((t) => t.token)).toEqual([...Array.from({ length: 10 }, (_, i) => `demo-table-${String(i + 1).padStart(2, '0')}`), 'demo-counter']);
    expect(d.tables.at(-1)).toMatchObject({ label: 'Counter', kind: 'counter' });
    expect(d.pickupBoardToken).toBe('demo-pickup');
    expect(d.kind).toBe('demo');
  });
});
