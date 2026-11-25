import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoData } from './index';
import { isLaparError, type BoardColumnInput, type LaparDemoData } from '../types';

const SHOP = 'shop-kopitiam-teras';
const COUNTER = 'demo-counter';
const table = (n: number) => `demo-table-${String(n).padStart(2, '0')}`;
const line = (itemId: string, qty = 1, extra: object = {}) => ({ itemId, qty, optionIds: [] as string[], ...extra });
const TEH = (qty = 1) => line('item-teh-tarik', qty, { optionIds: ['opt-teh-tarik-panas'] });

let clock: Date;
const make = async (plan: 'basic' | 'pro' = 'pro'): Promise<LaparDemoData> => {
  const d = createDemoData({ persist: false, now: () => clock, history: false });
  d.setPlan(plan);
  await d.owner.updateShopSettings(SHOP, { approvalMode: 'none' });
  return d;
};
const rejects = async (p: Promise<unknown>, code: string, detail?: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isLaparError(err, code as never), `expected ${code}, got ${String(err)}`).toBe(true);
  if (detail) expect((err as { detail?: string }).detail).toBe(detail);
};

beforeEach(() => {
  clock = new Date('2026-11-25T04:00:00Z'); // Wednesday 12:00 MYT
});

describe('timed menus, promos and the demo clock', () => {
  it('judges windows and promos at the clock preset', async () => {
    const d = await make();
    let menu = await d.customer.getMenu(table(1));
    const bf = () => menu.categories.find((c) => c.id === 'cat-breakfast')!;
    expect(bf()).toMatchObject({ window: { from: '06:00', to: '11:30', days: null }, availableNow: false });
    expect(menu.categories.find((c) => c.id === 'cat-noodles')!.availableNow).toBe(true);
    expect(menu.items.find((i) => i.id === 'item-teh-tarik')).toMatchObject({ promo: null, effectivePriceSen: 220 });
    await rejects(d.customer.placeOrder(table(1), { lines: [line('item-roti-canai')] }), 'item_unavailable', 'item-roti-canai');

    d.setClock('breakfast');
    menu = await d.customer.getMenu(table(1));
    expect(bf().availableNow).toBe(true);
    expect((await d.customer.placeOrder(table(1), { lines: [line('item-roti-canai', 1, { optionIds: ['opt-roti-canai-dhal'] })] })).status).toBe('approved');

    d.setClock('afternoon');
    menu = await d.customer.getMenu(table(2));
    const teh = menu.items.find((i) => i.id === 'item-teh-tarik')!;
    expect(teh).toMatchObject({ priceSen: 220, effectivePriceSen: 176 });
    expect(teh.promo).toMatchObject({ id: 'promo-happy-hour', endsAt: '2026-11-25T09:00:00.000Z' });
    expect(teh.promo!.translations.ms?.name).toBe('Waktu gembira');
    const placed = await d.customer.placeOrder(table(2), { lines: [TEH(2)] });
    expect(placed.lines[0]).toMatchObject({ listPriceSen: 220, unitPriceSen: 176, lineTotalSen: 352, promoId: 'promo-happy-hour' });
    expect(placed.totalSen).toBe(352);

    d.setClock('real');
    expect((await d.customer.getMenu(table(2))).items.find((i) => i.id === 'item-teh-tarik')!.promo).toBeNull();
  });

  it('shows no windows or promos on Basic', async () => {
    const d = await make('basic');
    d.setClock('afternoon');
    const menu = await d.customer.getMenu(table(1));
    expect(menu.items.find((i) => i.id === 'item-teh-tarik')!.promo).toBeNull();
    expect(menu.categories.every((c) => c.window === null && c.availableNow)).toBe(true);
    expect((await d.customer.placeOrder(table(1), { lines: [TEH()] })).lines[0]!.unitPriceSen).toBe(220);
  });
});

describe('promo owner API', () => {
  it('validates, saves, replaces items and deletes', async () => {
    const d = await make();
    const base = { shopId: SHOP, name: 'Lunch', translations: {}, discountType: 'amount' as const, discountValue: 50, days: [3] as (1 | 2 | 3 | 4 | 5 | 6 | 7)[], startTime: '11:00', endTime: '14:00', active: true, itemIds: ['item-nasi-lemak'] };
    const bad = (over: object) => rejects(d.pro.savePromo({ ...base, ...over } as never), 'invalid_input');
    await bad({ name: '' });
    await bad({ discountValue: 0 });
    await bad({ discountType: 'percent', discountValue: 101 });
    await bad({ days: [] });
    await bad({ days: [8] });
    await bad({ startTime: '11:00', endTime: '11:00' });
    await bad({ itemIds: ['nope'] });
    await rejects(d.pro.savePromo({ ...base, id: 'nope' }), 'not_found');

    const saved = await d.pro.savePromo(base);
    expect(await d.pro.listPromos(SHOP)).toHaveLength(2);
    expect((await d.customer.getMenu(table(1))).items.find((i) => i.id === 'item-nasi-lemak')).toMatchObject({ effectivePriceSen: 500, promo: { id: saved.id } });
    const edited = await d.pro.savePromo({ ...base, id: saved.id, itemIds: ['item-sirap-bandung'] });
    expect(edited.itemIds).toEqual(['item-sirap-bandung']);
    expect((await d.customer.getMenu(table(1))).items.find((i) => i.id === 'item-nasi-lemak')!.promo).toBeNull();

    const order = await d.customer.placeOrder(table(1), { lines: [line('item-teh-o-ais-limau')] });
    await d.pro.deletePromo(saved.id);
    await rejects(d.pro.deletePromo(saved.id), 'not_found');
    expect(await d.pro.listPromos(SHOP)).toHaveLength(1);
    expect(order.lines[0]!.promoId).toBeNull();
  });
});

describe('combos and station routing', () => {
  it('expands a combo into component lines routed by station', async () => {
    const d = await make();
    const menu = await d.customer.getMenu(table(1));
    expect(menu.items.find((i) => i.id === 'item-set-a')!.combo!.components.map((c) => [c.itemId, c.qty])).toEqual([['item-nasi-lemak', 1], ['item-teh-tarik', 1]]);

    await rejects(d.customer.placeOrder(table(1), { lines: [line('item-set-a', 1, { optionIds: ['opt-teh-tarik-ais'] })] }), 'invalid_input', 'option_ids');
    const placed = await d.customer.placeOrder(table(1), { lines: [line('item-set-a', 2, { note: 'no ice' }), line('item-teh-o-ais-limau')] });
    expect(placed.totalSen).toBe(1400 + 280);
    expect(placed.lines.map((l) => [l.kind, l.name, l.qty, l.lineTotalSen])).toEqual([
      ['combo', 'Set A', 2, 1400],
      ['component', 'Nasi lemak', 2, 0],
      ['component', 'Teh tarik', 2, 0],
      ['item', 'Teh O ais limau', 1, 280],
    ]);
    const tab = await d.customer.getTab(table(1));
    expect(tab.tab!.totalSen).toBe(1680);
    expect(tab.orders[0]!.lines.map((l) => l.parentLineId)).toEqual([null, placed.lines[0]!.lineId, placed.lines[0]!.lineId, null]);

    const kitchen = await d.staff.getBoard(SHOP, 'station-kitchen');
    expect(kitchen.lines.map((l) => [l.name, l.kind, l.parentName, l.note, l.position, l.positionOf])).toEqual([['Nasi lemak', 'component', 'Set A', 'no ice', 1, 3]]);
    const drinks = await d.staff.getBoard(SHOP, 'station-drinks');
    expect(drinks.lines.map((l) => [l.name, l.position])).toEqual([['Teh tarik', 2], ['Teh O ais limau', 3]]);
    await rejects(d.staff.advanceItem(placed.lines[0]!.lineId, 'preparing'), 'invalid_transition'); // the combo line itself
  });

  it('Basic sends everything to the first station', async () => {
    const d = await make('basic');
    await d.customer.placeOrder(table(1), { lines: [TEH(), line('item-nasi-lemak')] });
    expect((await d.staff.getBoard(SHOP, 'station-kitchen')).lines).toHaveLength(2);
    expect((await d.staff.getBoard(SHOP, 'station-drinks')).lines).toHaveLength(0);
  });

  it('manages stations and combo components', async () => {
    const d = await make();
    const added = await d.pro.saveStation({ shopId: SHOP, name: 'Grill' });
    expect(added).toMatchObject({ name: 'Grill', active: true, sort: 2 });
    await rejects(d.pro.saveStation({ shopId: SHOP, name: '' }), 'invalid_input');
    await rejects(d.pro.saveStation({ shopId: SHOP, name: 'x'.repeat(31) }), 'invalid_input');
    await d.pro.saveStation({ shopId: SHOP, id: added.id, name: 'Grill', active: false });
    await d.pro.saveStation({ shopId: SHOP, id: 'station-drinks', name: 'Drinks', active: false });
    await rejects(d.pro.saveStation({ shopId: SHOP, id: 'station-kitchen', name: 'Kitchen', active: false }), 'invalid_input', 'last_station');
    // Items of an inactive station fall back to the default station.
    await d.customer.placeOrder(table(1), { lines: [TEH()] });
    expect((await d.staff.getBoard(SHOP, null)).lines.map((l) => l.name)).toEqual(['Teh tarik']);

    const set = 'item-set-b';
    await rejects(d.pro.setComboComponents('item-nasi-lemak', [{ itemId: 'item-sirap-bandung', qty: 1 }]), 'invalid_input');
    await rejects(d.pro.setComboComponents(set, []), 'invalid_input');
    await rejects(d.pro.setComboComponents(set, [{ itemId: 'item-set-a', qty: 1 }]), 'invalid_input');
    await rejects(d.pro.setComboComponents(set, [{ itemId: 'item-sirap-bandung', qty: 11 }]), 'invalid_input');
    await rejects(d.pro.setComboComponents(set, [{ itemId: 'item-sirap-bandung', qty: 1 }, { itemId: 'item-sirap-bandung', qty: 1 }]), 'invalid_input');
    await d.pro.setComboComponents(set, [{ itemId: 'item-teh-o-ais-limau', qty: 2 }]);
    const menu = await d.customer.getMenu(table(2));
    expect(menu.items.find((i) => i.id === set)!.combo!.components).toMatchObject([{ itemId: 'item-teh-o-ais-limau', qty: 2 }]);
  });
});

describe('counter orders and the pickup board', () => {
  it('numbers pickups per MYT day and tracks them on the board', async () => {
    const d = await make();
    const one = await d.customer.placeOrder(COUNTER, { lines: [line('item-nasi-lemak')], pickupAt: new Date(clock.getTime() + 30 * 60_000).toISOString() });
    const two = await d.customer.placeOrder(COUNTER, { lines: [line('item-sirap-bandung')] });
    expect([one.pickupNo, two.pickupNo]).toEqual([1, 2]);
    expect(one.tabId).not.toBe(two.tabId);

    await rejects(d.customer.getTab(COUNTER), 'invalid_input', 'tab_id');
    await rejects(d.customer.getTab(COUNTER, 'nope'), 'not_found');
    const t = await d.customer.getTab(COUNTER, one.tabId);
    expect(t.tab).toMatchObject({ pickupNo: 1, totalSen: 550, pickupAt: new Date(clock.getTime() + 30 * 60_000).toISOString() });

    await rejects(d.customer.placeOrder(COUNTER, { lines: [line('item-sirap-bandung')], pickupAt: new Date(clock.getTime() - 5 * 60_000).toISOString() }), 'invalid_input', 'pickup_at');
    await rejects(d.customer.placeOrder(COUNTER, { lines: [line('item-sirap-bandung')], pickupAt: new Date(clock.getTime() + 24 * 3600_000).toISOString() }), 'invalid_input', 'pickup_at');
    await rejects(d.customer.placeOrder(COUNTER, { lines: [line('item-sirap-bandung')], pickupAt: 'soon' }), 'invalid_input', 'pickup_at');

    const board = () => d.customer.getPickupBoard(d.pickupBoardToken);
    expect(await board()).toMatchObject({ shopName: 'Kopitiam Teras', preparing: [1, 2], ready: [] });
    const lines = (await d.staff.getTabDetail(one.tabId)).orders[0]!.lines;
    for (const to of ['preparing', 'cooking', 'ready'] as const) await d.staff.advanceItem(lines[0]!.id, to);
    expect(await board()).toMatchObject({ preparing: [2], ready: [1] });
    await d.staff.advanceItem(lines[0]!.id, 'served');
    expect(await board()).toMatchObject({ preparing: [2], ready: [] }); // all served: left out
    await rejects(d.customer.getPickupBoard('wrong'), 'not_found');

    clock = new Date('2026-11-25T16:30:00Z'); // 00:30 on the 26th: numbering restarts, old tabs are not today's
    expect(await board()).toMatchObject({ preparing: [], ready: [] });
    expect((await d.customer.placeOrder(COUNTER, { lines: [line('item-sirap-bandung')] })).pickupNo).toBe(1);
  });

  it('waits for approval before a counter tab shows on the board', async () => {
    const d = await make();
    await d.owner.updateShopSettings(SHOP, { approvalMode: 'every_order' });
    const placed = await d.customer.placeOrder(COUNTER, { lines: [line('item-sirap-bandung')] });
    expect(placed.status).toBe('pending_approval');
    expect((await d.customer.getPickupBoard(d.pickupBoardToken)).preparing).toEqual([]);
    await d.staff.approveOrder(placed.orderId);
    expect((await d.customer.getPickupBoard(d.pickupBoardToken)).preparing).toEqual([1]);
  });

  it('allows 20 counter orders in 5 minutes', async () => {
    const d = await make();
    for (let i = 0; i < 20; i++) await d.customer.placeOrder(COUNTER, { lines: [line('item-sirap-bandung')] });
    await rejects(d.customer.placeOrder(COUNTER, { lines: [line('item-sirap-bandung')] }), 'rate_limited');
  });

  it('regenerates the board token and the old one stops working', async () => {
    const d = await make();
    const old = d.pickupBoardToken;
    const fresh = await d.pro.regeneratePickupBoardToken(SHOP);
    expect(fresh).not.toBe(old);
    expect(d.pickupBoardToken).toBe(fresh);
    await rejects(d.customer.getPickupBoard(old), 'not_found');
    await d.customer.getPickupBoard(fresh);
  });
});

describe('custom columns', () => {
  const cols = (...spec: [string, string][]): BoardColumnInput[] => spec.map(([name, coreStatus]) => ({ name, coreStatus: coreStatus as BoardColumnInput['coreStatus'] }));
  const ok = cols(['In', 'new'], ['Prep', 'preparing'], ['Wok', 'cooking'], ['Grill', 'cooking'], ['Pass', 'ready']);

  it('validates set_board_columns', async () => {
    const d = await make();
    const bad = (c: BoardColumnInput[]) => rejects(d.pro.setBoardColumns('station-kitchen', c), 'invalid_input', 'columns');
    await bad(ok.slice(0, 3));
    await bad([...ok, ...ok, ...ok]);
    await bad(cols(['A', 'new'], ['B', 'preparing'], ['C', 'cooking'], ['D', 'cooking'])); // no ready
    await bad(cols(['A', 'new'], ['B', 'cooking'], ['C', 'preparing'], ['D', 'ready'])); // goes backwards
    await bad(cols(['A', 'new'], ['B', 'preparing'], ['C', 'cooking'], ['x'.repeat(25), 'ready']));
    await bad([...ok.slice(0, 4), { id: 'nope', name: 'Pass', coreStatus: 'ready' }]);
    await rejects(d.pro.setBoardColumns('nope', ok), 'not_found');
  });

  it('saves, keeps ids, reorders and moves cards between columns', async () => {
    const d = await make();
    const saved = await d.pro.setBoardColumns('station-kitchen', ok);
    expect(saved.map((c) => [c.name, c.sort])).toEqual([['In', 0], ['Prep', 1], ['Wok', 2], ['Grill', 3], ['Pass', 4]]);
    expect((await d.staff.getBoard(SHOP, 'station-kitchen')).columns.map((c) => c.name)).toEqual(['In', 'Prep', 'Wok', 'Grill', 'Pass']);

    const placed = await d.customer.placeOrder(table(1), { lines: [line('item-nasi-lemak')] });
    const id = placed.lines[0]!.lineId;
    const [, prep, wok, grill] = saved;
    await d.staff.advanceItem(id, 'preparing', prep!.id);
    await d.staff.advanceItem(id, 'cooking', wok!.id);
    await d.staff.advanceItem(id, 'cooking', grill!.id); // same status, other column
    expect((await d.staff.getBoard(SHOP, 'station-kitchen')).lines[0]).toMatchObject({ status: 'cooking', columnId: grill!.id });
    await rejects(d.staff.advanceItem(id, 'ready', wok!.id), 'invalid_input', 'column_id'); // wrong core status
    await rejects(d.staff.advanceItem(id, 'cooking'), 'invalid_transition'); // same status needs a column
    await d.staff.advanceItem(id, 'ready'); // no column: back to the first of its status
    expect((await d.staff.getBoard(SHOP, 'station-kitchen')).lines[0]!.columnId).toBeNull();

    // drop the Grill column: the card falls back
    await d.staff.advanceItem(id, 'cooking', grill!.id);
    const next = await d.pro.setBoardColumns('station-kitchen', [saved[0]!, saved[1]!, saved[2]!, saved[4]!].map((c) => ({ id: c.id, name: c.name, coreStatus: c.coreStatus })));
    expect(next.map((c) => c.sort)).toEqual([0, 1, 2, 3]);
    expect((await d.pro.getBoardColumns('station-kitchen')).map((c) => c.id)).toEqual(next.map((c) => c.id));
    expect((await d.staff.getBoard(SHOP, 'station-kitchen')).lines[0]).toMatchObject({ status: 'cooking', columnId: null });
  });
});

describe('bill split', () => {
  const placeTwo = async (d: LaparDemoData) => d.customer.placeOrder(table(1), { lines: [line('item-nasi-lemak'), line('item-sirap-bandung'), line('item-teh-o-ais-limau')] }); // 550 + 280 + 280

  it('pays by amount until the tab is settled', async () => {
    const d = await make();
    const r = await placeTwo(d);
    const a = await d.staff.recordPayment({ tabId: r.tabId, method: 'duitnow', amountSen: 400 });
    expect(a).toMatchObject({ amountSen: 400, remainingSen: 710, tabClosed: false });
    await rejects(d.staff.recordPayment({ tabId: r.tabId, method: 'cash', amountSen: 1111 }), 'invalid_input', 'amount');
    const b = await d.staff.recordPayment({ tabId: r.tabId, method: 'cash', amountSen: 133 });
    expect(b).toMatchObject({ roundingSen: 2, remainingSen: 577 });
    const c = await d.staff.recordPayment({ tabId: r.tabId, method: 'card' });
    expect(c).toMatchObject({ amountSen: 577, remainingSen: 0, tabClosed: true });
    const detail = await d.staff.getTabDetail(r.tabId);
    expect(detail).toMatchObject({ status: 'closed', paidSen: 1110, roundingSen: 2 });
  });

  it('pays by item and refuses mixing', async () => {
    const d = await make();
    const r = await placeTwo(d);
    const [nasi, kopi, kopiO] = r.lines.map((l) => l.lineId) as [string, string, string];
    const first = await d.staff.recordPayment({ tabId: r.tabId, method: 'cash', orderItemIds: [kopi, kopiO] });
    expect(first).toMatchObject({ amountSen: 560, remainingSen: 550, tabClosed: false });
    let detail = await d.staff.getTabDetail(r.tabId);
    expect(detail.payments[0]!.orderItemIds).toEqual([kopi, kopiO]);
    expect(detail.orders[0]!.lines.filter((l) => l.paidPaymentId).map((l) => l.id)).toEqual([kopi, kopiO]);

    await rejects(d.staff.recordPayment({ tabId: r.tabId, method: 'cash', orderItemIds: [kopi] }), 'invalid_input', 'order_item_ids'); // already paid
    await rejects(d.staff.recordPayment({ tabId: r.tabId, method: 'cash', orderItemIds: ['nope'] }), 'invalid_input', 'order_item_ids');
    const done = await d.staff.recordPayment({ tabId: r.tabId, method: 'duitnow', orderItemIds: [nasi] });
    expect(done).toMatchObject({ amountSen: 550, tabClosed: true });
    detail = await d.staff.getTabDetail(r.tabId);
    expect(detail.status).toBe('closed');

    // an amount payment first, then by item: mixed_split
    const r2 = await d.customer.placeOrder(table(2), { lines: [line('item-nasi-lemak'), line('item-sirap-bandung')] });
    await d.staff.recordPayment({ tabId: r2.tabId, method: 'duitnow', amountSen: 100 });
    await rejects(d.staff.recordPayment({ tabId: r2.tabId, method: 'duitnow', orderItemIds: [r2.lines[0]!.lineId] }), 'invalid_input', 'mixed_split');
  });

  it('only approved, unpaid item or combo lines can be paid by item', async () => {
    const d = await make();
    const r = await d.customer.placeOrder(table(1), { lines: [line('item-set-a')] });
    await rejects(d.staff.recordPayment({ tabId: r.tabId, method: 'cash', orderItemIds: [r.lines[1]!.lineId] }), 'invalid_input', 'order_item_ids'); // component
    const paid = await d.staff.recordPayment({ tabId: r.tabId, method: 'cash', orderItemIds: [r.lines[0]!.lineId] });
    expect(paid.tabClosed).toBe(true);
  });
});

describe('auto pairings', () => {
  it('suggests items bought together in at least 3 approved orders in the last 90 days', async () => {
    const d = await make();
    for (let n = 1; n <= 3; n++) await d.customer.placeOrder(table(n), { lines: [line('item-nasi-lemak'), line('item-teh-o-ais-limau')] });
    await d.customer.placeOrder(table(4), { lines: [line('item-nasi-lemak'), line('item-sirap-bandung')] }); // support 1
    const nasi = (await d.customer.getMenu(table(5))).items.find((i) => i.id === 'item-nasi-lemak')!;
    expect(nasi.suggestions.map((s) => [s.itemId, s.source])).toEqual([
      ['item-teh-tarik', 'manual'],
      ['item-telur-mata', 'manual'],
      ['item-ayam-goreng', 'manual'],
      ['item-teh-o-ais-limau', 'auto'],
    ]);
    const kopiO = (await d.customer.getMenu(table(5))).items.find((i) => i.id === 'item-teh-o-ais-limau')!;
    expect(kopiO.suggestions).toEqual([{ itemId: 'item-nasi-lemak', source: 'auto' }]);

    clock = new Date(clock.getTime() + 91 * 86_400_000); // too old now
    expect((await d.customer.getMenu(table(5))).items.find((i) => i.id === 'item-nasi-lemak')!.suggestions.every((s) => s.source === 'manual')).toBe(true);
  });

  it('is off on Basic and ignores rejected or cancelled lines', async () => {
    const basic = await make('basic');
    for (let n = 1; n <= 3; n++) await basic.customer.placeOrder(table(n), { lines: [line('item-nasi-lemak'), line('item-teh-o-ais-limau')] });
    expect((await basic.customer.getMenu(table(5))).items.find((i) => i.id === 'item-nasi-lemak')!.suggestions.some((s) => s.source === 'auto')).toBe(false);

    const d = await make();
    const orders = [];
    for (let n = 1; n <= 3; n++) orders.push(await d.customer.placeOrder(table(n), { lines: [line('item-nasi-lemak'), line('item-teh-o-ais-limau')] }));
    await d.staff.advanceItem(orders[0]!.lines[1]!.lineId, 'cancelled');
    expect((await d.customer.getMenu(table(5))).items.find((i) => i.id === 'item-nasi-lemak')!.suggestions.some((s) => s.source === 'auto')).toBe(false);
  });
});

describe('uploads', () => {
  it('stores a data URL (the original when the image cannot be decoded)', async () => {
    const d = await make();
    const item = await d.owner.uploadItemPhoto(SHOP, 'item-sirap-bandung', new Blob(['x'], { type: 'image/png' }));
    expect(item.photoUrl).toMatch(/^data:/);
    expect(item.photoState).toBe('staging');
    expect(await d.owner.uploadLogo(SHOP, new Blob(['x'], { type: 'image/png' }))).toMatch(/^data:/);
  });
});

describe('Basic plan', () => {
  it('refuses every Pro path with feature_not_enabled', async () => {
    const d = await make('basic');
    const r = await d.customer.placeOrder(table(1), { lines: [line('item-nasi-lemak'), line('item-sirap-bandung')] });
    const no = (p: Promise<unknown>, key: string) => rejects(p, 'feature_not_enabled', key);
    await no(d.pro.saveStation({ shopId: SHOP, name: 'Grill' }), 'multi_station');
    await no(d.pro.getBoardColumns('station-kitchen'), 'custom_columns');
    await no(d.pro.setBoardColumns('station-kitchen', []), 'custom_columns');
    await no(d.pro.listPromos(SHOP), 'promos');
    await no(d.pro.savePromo({ shopId: SHOP, name: 'x', translations: {}, discountType: 'percent', discountValue: 10, days: [1], startTime: '10:00', endTime: '11:00', active: true, itemIds: [] }), 'promos');
    await no(d.pro.deletePromo('promo-happy-hour'), 'promos');
    await no(d.pro.setComboComponents('item-set-a', [{ itemId: 'item-sirap-bandung', qty: 1 }]), 'combos');
    await no(d.pro.regeneratePickupBoardToken(SHOP), 'takeaway');
    await no(d.pro.getSalesReport(SHOP, '2026-11-01', '2026-11-25'), 'full_reports');
    await no(d.pro.getUpsellReport(SHOP, '2026-11'), 'upsell_report');
    await no(d.pro.exportShopMeta(SHOP), 'export_backup');
    await no(d.pro.exportOrders(SHOP, '2026-11-01', '2026-11-25'), 'export_backup');
    await no(d.customer.placeOrder(COUNTER, { lines: [line('item-sirap-bandung')] }), 'takeaway');
    await no(d.customer.getPickupBoard(d.pickupBoardToken), 'takeaway');
    await no(d.customer.placeOrder(table(2), { lines: [line('item-set-a')] }), 'combos');
    await no(d.staff.recordPayment({ tabId: r.tabId, method: 'cash', amountSen: 100 }), 'bill_split');
    await no(d.staff.recordPayment({ tabId: r.tabId, method: 'cash', orderItemIds: [r.lines[0]!.lineId] }), 'bill_split');
    await no(d.staff.advanceItem(r.lines[0]!.lineId, 'preparing', 'column'), 'custom_columns');
  });
});
