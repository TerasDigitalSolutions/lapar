/** Auth API for the demo: the owner is always signed in; staff PINs are checked against the seed (DATA-MODEL 6.2). */
import type { AuthApi, StaffSession } from '../types';
import { normalizeStaffCode } from '../../lib/staffCode';
import { fail, gate, has, type Ctx } from './util';

const LOCK_MS = 10 * 60_000;
const SESSION_MS = 16 * 3600_000;
const MAX_FAILURES = 5;

export function createAuthApi(ctx: Ctx): AuthApi {
  const sessionFor = (staffId: string): StaffSession | null => {
    const s = ctx.s;
    const member = s.staff.find((m) => m.id === staffId && m.active);
    return member
      ? {
          shopId: s.shop.id,
          shopName: s.shop.name,
          shopSlug: s.shop.slug,
          shopTheme: s.shop.theme,
          staffId: member.id,
          staffName: member.name,
          expiresAt: new Date(ctx.now().getTime() + SESSION_MS).toISOString(),
          pickupBoardToken: has(ctx, 'takeaway') ? (s.shop.pickupBoardToken ?? null) : null,
        }
      : null;
  };

  return {
    async getUser() {
      return { id: 'user-demo-owner', email: 'owner@demo.test', isAnonymous: false };
    },
    async signInWithPassword() {},
    async signOut() {},
    async verifyLink() {
      fail('not_implemented', 'verify_link');
    },
    async setPassword() {
      fail('not_implemented', 'set_password');
    },
    async getStaffSession() {
      const id = ctx.s.actorStaffId;
      return id ? sessionFor(id) : null;
    },

    async claimStaffSession(staffCode, pin) {
      const s = ctx.s;
      if (normalizeStaffCode(staffCode) !== s.staffCode) fail('not_found');
      gate(ctx, 'staff_pins');
      const attempts = s.pinAttempts;
      const now = ctx.now().getTime();
      if (attempts.lockedUntil) {
        if (new Date(attempts.lockedUntil).getTime() > now) fail('pin_locked', attempts.lockedUntil);
        attempts.lockedUntil = null;
        attempts.failures = 0;
      }
      const match = /^[0-9]{4,6}$/.test(pin) ? s.staffPins.find((p) => p.pin === pin && s.staff.some((m) => m.id === p.staffId && m.active)) : undefined;
      if (!match) {
        attempts.failures += 1;
        if (attempts.failures >= MAX_FAILURES) {
          attempts.failures = 0;
          attempts.lockedUntil = new Date(now + LOCK_MS).toISOString();
          ctx.emit();
          fail('pin_locked', attempts.lockedUntil);
        }
        ctx.emit();
        fail('invalid_pin');
      }
      attempts.failures = 0;
      s.actorStaffId = match.staffId;
      ctx.emit();
      return sessionFor(match.staffId) ?? fail('invalid_pin');
    },

    // The demo device stays signed in (the shell has no sign-in screen).
    async endStaffSession() {},

    async myShops() {
      const { shop, plan } = ctx.s;
      return [{ id: shop.id, name: shop.name, slug: shop.slug, active: shop.active, planId: plan, theme: shop.theme }];
    },
    async isPlatformAdmin() {
      return true;
    },
  };
}
