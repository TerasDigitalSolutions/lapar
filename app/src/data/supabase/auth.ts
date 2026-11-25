import { LaparError, type AuthApi, type OwnerShopDTO, type StaffSession } from '../types';
import { rpc } from './authed';
import { getClient } from './client';
import { toLaparError } from './errors';

type ClaimResult = { ok: true; session: StaffSession } | { ok: false; error: string; lockedUntil?: string };

/** Wraps an auth call: any failure becomes a LaparError. */
async function auth<T>(fn: (a: Awaited<ReturnType<typeof getClient>>['auth']) => Promise<{ data: unknown; error: unknown }>): Promise<T> {
  try {
    const { data, error } = await fn((await getClient()).auth);
    if (error) throw error;
    return data as T;
  } catch (e) {
    throw toLaparError(e);
  }
}

type SessionData = { session: { user: { id: string; email?: string; is_anonymous?: boolean } } | null };
const getSession = () => auth<SessionData>((a) => a.getSession());
const hasSession = async () => !!(await getSession()).session;

export const authApi: AuthApi = {
  async getUser() {
    const user = (await getSession()).session?.user;
    return user ? { id: user.id, email: user.email ?? null, isAnonymous: user.is_anonymous === true } : null;
  },

  async signInWithPassword(email, password) {
    await auth((a) => a.signInWithPassword({ email, password }));
  },

  async signOut() {
    await auth(async (a) => ({ data: null, error: (await a.signOut()).error }));
  },

  async verifyLink(tokenHash, type) {
    await auth((a) => a.verifyOtp({ token_hash: tokenHash, type }));
  },

  async setPassword(password) {
    if (password.length < 8) throw new LaparError('invalid_input', 'password');
    await auth((a) => a.updateUser({ password }));
  },

  async getStaffSession() {
    if (!(await hasSession())) return null;
    try {
      return await rpc<StaffSession | null>('my_staff_session');
    } catch (e) {
      if (e instanceof LaparError && e.code === 'not_signed_in') return null;
      throw e;
    }
  },

  async claimStaffSession(shopSlug, pin) {
    if (!(await hasSession())) await auth((a) => a.signInAnonymously());
    const res = await rpc<ClaimResult>('claim_staff_session', { p_shop_slug: shopSlug, p_pin: pin });
    if (res.ok) return res.session;
    // the RPC returns (never raises) a wrong PIN so the attempt counter is kept
    throw new LaparError(res.error === 'pin_locked' ? 'pin_locked' : 'invalid_pin', res.error === 'pin_locked' ? res.lockedUntil : undefined);
  },

  endStaffSession: () => rpc('end_staff_session'),
  myShops: () => rpc<OwnerShopDTO[]>('my_shops'),
  isPlatformAdmin: () => rpc<boolean>('is_platform_admin'),
};
