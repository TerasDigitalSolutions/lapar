import { beforeEach, expect, test, vi } from 'vitest';
import { LaparError } from '../types';

// A fake supabase client: no network. `rpcResult` answers rpc(); `calls` records everything.
const calls: { fn: string; args: unknown }[] = [];
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let session: unknown = null;
const signInAnonymously = vi.fn(async () => {
  session = { user: { id: 'anon', is_anonymous: true } };
  return { data: {}, error: null };
});
const update = vi.fn();
const fake = {
  rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), rpcResult),
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    signInAnonymously,
  },
  from: (table: string) => ({
    update: (patch: unknown) => {
      update(table, patch);
      return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'c1', name: 'Mains', sort: 2, available_from: '11:00:00', available_to: '15:00:00', available_days: null, shop_id: 's1', translations: {}, created_at: 'x' }, error: null }) }) }) };
    },
  }),
};
vi.mock('./client', () => ({ getClient: async () => fake }));

const { authApi } = await import('./auth');
const { ownerApi } = await import('./owner');
const { staffApi } = await import('./staff');

beforeEach(() => {
  calls.length = 0;
  session = null;
  rpcResult = { data: null, error: null };
  signInAnonymously.mockClear();
});

const staffSession = { shopId: 's', shopName: 'S', shopSlug: 'shop', staffId: 'st', staffName: 'A', expiresAt: 'x', pickupBoardToken: null };

test('claim signs in anonymously first, then returns the session', async () => {
  rpcResult = { data: { ok: true, session: staffSession }, error: null };
  expect(await authApi.claimStaffSession('shop', '1234')).toEqual(staffSession);
  expect(signInAnonymously).toHaveBeenCalledOnce();
  expect(calls[0]).toEqual({ fn: 'claim_staff_session', args: { p_shop_slug: 'shop', p_pin: '1234' } });
  await authApi.claimStaffSession('shop', '1234');
  expect(signInAnonymously).toHaveBeenCalledOnce(); // already signed in
});

test('claim maps {ok:false} to LaparError', async () => {
  rpcResult = { data: { ok: false, error: 'invalid_pin' }, error: null };
  await expect(authApi.claimStaffSession('shop', '0000')).rejects.toMatchObject({ code: 'invalid_pin' });
  rpcResult = { data: { ok: false, error: 'pin_locked', lockedUntil: '2026-11-25T10:00:00Z' }, error: null };
  const e = await authApi.claimStaffSession('shop', '0000').catch((x: unknown) => x);
  expect(e).toBeInstanceOf(LaparError);
  expect(e).toMatchObject({ code: 'pin_locked', detail: '2026-11-25T10:00:00Z' });
});

test('getStaffSession is null without a session or when the RPC says not signed in', async () => {
  expect(await authApi.getStaffSession()).toBeNull();
  expect(calls).toHaveLength(0);
  session = { user: { id: 'u' } };
  rpcResult = { data: null, error: { message: 'not_signed_in' } };
  expect(await authApi.getStaffSession()).toBeNull();
});

test('staff RPCs send p_* arguments', async () => {
  await staffApi.advanceItem('i1', 'ready');
  await staffApi.getBoard('s1', null);
  expect(calls).toEqual([
    { fn: 'advance_item', args: { p_item_id: 'i1', p_to: 'ready', p_column_id: null } },
    { fn: 'get_board', args: { p_shop_id: 's1', p_station_id: null } },
  ]);
  rpcResult = { data: null, error: { message: 'invalid_transition' } };
  await expect(staffApi.approveOrder('o1')).rejects.toMatchObject({ code: 'invalid_transition' });
});

test('category rows map the availability window and drop table-only columns', async () => {
  const row = await ownerApi.saveCategory({ id: 'c1', shopId: 's1', name: 'Mains', window: { from: '11:00', to: '15:00', days: null } });
  expect(row).toEqual({ id: 'c1', shopId: 's1', name: 'Mains', translations: {}, sort: 2, window: { from: '11:00', to: '15:00', days: null } });
  expect(update).toHaveBeenCalledWith('categories', { name: 'Mains', available_from: '11:00', available_to: '15:00', available_days: null });
});

test('owner staff and plan RPCs', async () => {
  await ownerApi.updateStaff('st', { active: false });
  await ownerApi.setPairings('i', ['a', 'b']);
  expect(calls).toEqual([
    { fn: 'update_staff', args: { p_staff_id: 'st', p_name: null, p_active: false } },
    { fn: 'set_item_pairings', args: { p_item_id: 'i', p_suggested: ['a', 'b'] } },
  ]);
});
