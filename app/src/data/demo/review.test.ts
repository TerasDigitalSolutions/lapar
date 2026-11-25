import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoData } from './index';
import { isLaparError, type LaparDemoData } from '../types';

const SHOP = 'shop-kopitiam-teras';
const T1 = 'demo-table-01';
const COUNTER = 'demo-counter';
const NASI = { itemId: 'item-nasi-lemak', qty: 1, optionIds: [] as string[] };

let clock: Date;
const advance = (ms: number) => void (clock = new Date(clock.getTime() + ms));
const make = (): LaparDemoData => createDemoData({ persist: false, now: () => clock, history: false });
beforeEach(() => {
  clock = new Date('2026-11-25T04:00:00Z'); // 12:00 MYT
  localStorage.clear();
});

describe('review fixes', () => {
  it('keeps a paid takeaway number on the pickup board until it is served', async () => {
    const d = make();
    d.setPlan('pro');
    await d.owner.updateShopSettings(SHOP, { approvalMode: 'none' });
    const r = await d.customer.placeOrder(COUNTER, { lines: [NASI, { ...NASI, qty: 2 }] });
    const board = () => d.customer.getPickupBoard(d.pickupBoardToken);
    expect((await board()).preparing).toEqual([r.pickupNo]);
    await d.staff.recordPayment({ tabId: r.tabId, method: 'cash' }); // paid, food not made yet
    expect((await board()).preparing).toEqual([r.pickupNo]);
    const [a, b] = r.lines;
    for (const to of ['preparing', 'cooking', 'ready'] as const) await d.staff.advanceItem(a!.lineId, to);
    expect((await board()).preparing).toEqual([r.pickupNo]); // one line still not ready
    for (const to of ['preparing', 'cooking', 'ready'] as const) await d.staff.advanceItem(b!.lineId, to);
    expect(await board()).toMatchObject({ preparing: [], ready: [r.pickupNo] });
    await d.staff.advanceItem(a!.lineId, 'served');
    await d.staff.advanceItem(b!.lineId, 'served');
    expect(await board()).toMatchObject({ preparing: [], ready: [] });
  });

  it('closes a table tab left open from a previous day and starts a fresh one', async () => {
    const d = make();
    await d.owner.updateShopSettings(SHOP, { approvalMode: 'first_order' });
    const first = await d.customer.placeOrder(T1, { lines: [NASI] });
    await d.staff.approveOrder(first.orderId);
    expect((await d.customer.placeOrder(T1, { lines: [NASI] })).status).toBe('approved'); // same day: reused
    advance(86_400_000);
    expect((await d.customer.getTab(T1)).tab).toBeNull(); // yesterday's bill is hidden
    const next = await d.customer.placeOrder(T1, { lines: [NASI] });
    expect(next.tabId).not.toBe(first.tabId);
    expect(next.status).toBe('pending_approval'); // first-order approval applies again
    const old = await d.staff.getTabDetail(first.tabId);
    expect(old).toMatchObject({ status: 'closed', paidSen: 0 });
    expect(old.closedAt).not.toBeNull();
  });

  it('throttles call_server taps within 10 seconds', async () => {
    const d = make();
    await d.customer.callServer(T1, 'bill');
    advance(9_000);
    await d.customer.callServer(T1, 'bill');
    expect((await d.staff.listServiceRequests(SHOP))[0]).toMatchObject({ tapCount: 1 });
    advance(2_000);
    await d.customer.callServer(T1, 'bill');
    expect((await d.staff.listServiceRequests(SHOP))[0]).toMatchObject({ tapCount: 2 });
  });

  it('refuses a set meal with no components', async () => {
    const d = make();
    d.setPlan('pro');
    const set = await d.owner.saveItem({ shopId: SHOP, categoryId: 'cat-sides', name: 'Empty set', priceSen: 900, isCombo: true });
    const err = await d.customer.placeOrder(T1, { lines: [{ ...NASI, itemId: set.id }] }).then(() => null, (e: unknown) => e);
    expect(isLaparError(err, 'item_unavailable')).toBe(true);
  });
});
