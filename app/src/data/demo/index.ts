/**
 * DemoData: a complete in-memory LaparData for the offline demo and the UI tests.
 * No network, no supabase-js. Live state is saved to localStorage; generated history is not.
 */
import { PLAN_DEFAULTS, resolveEntitlements } from '../../entitlements/keys';
import { readJson, removeKey, writeJson } from '../../lib/storage';
import { mytToday } from '../../lib/time';
import type { LaparDemoData } from '../types';
import { createAdminApi } from './admin';
import { createAuthApi } from './auth';
import { createCustomerApi } from './customer';
import { createEmitter } from './events';
import { generateHistory } from './history';
import { createOwnerApi } from './owner';
import { createProApi } from './pro';
import { PICKUP_BOARD_TOKEN, SHOP_ID, seedState } from './seed';
import { createStaffApi } from './staff';
import { STORAGE_KEY, isDemoState, withoutHistory, type DemoState } from './store';
import { assertShop, type Ctx } from './util';

const SAVE_DEBOUNCE_MS = 500;

export interface DemoOptions {
  /** Read and write localStorage (default true). */
  persist?: boolean;
  /** Clock for timestamps; tests pass a fake. */
  now?: () => Date;
}

/** Results are copied so screens never hold references into the store. */
function isolate<T extends object>(api: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, fn] of Object.entries(api)) {
    out[key] = async (...args: unknown[]) => {
      const result = await (fn as (...a: unknown[]) => unknown)(...args);
      return result === undefined ? result : JSON.parse(JSON.stringify(result));
    };
  }
  return out as T;
}

export function createDemoData({ persist = true, now = () => new Date() }: DemoOptions = {}): LaparDemoData {
  const emitter = createEmitter();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const build = (base: DemoState): DemoState => {
    const h = generateHistory(base, mytToday(now()));
    return {
      ...base,
      tabs: [...base.tabs, ...h.tabs],
      orders: [...base.orders, ...h.orders],
      orderItems: [...base.orderItems, ...h.orderItems],
      payments: [...base.payments, ...h.payments],
    };
  };
  const load = (): DemoState => {
    const saved = persist ? readJson<unknown>(STORAGE_KEY, null) : null;
    return build(isDemoState(saved) ? withoutHistory(saved) : seedState(now().toISOString()));
  };

  const ctx: Ctx = {
    s: load(),
    now,
    id: (prefix) => `${prefix}-${++ctx.s.seq}`,
    emit(...changes) {
      if (persist) {
        clearTimeout(timer);
        timer = setTimeout(() => writeJson(STORAGE_KEY, withoutHistory(ctx.s)), SAVE_DEBOUNCE_MS);
      }
      emitter.emit(...changes);
    },
  };

  const tables = ctx.s.tables
    .filter((t) => t.active)
    .sort((a, b) => a.sort - b.sort)
    .map((t) => ({ token: t.token, label: t.label, kind: t.kind }));

  return {
    kind: 'demo',
    customer: isolate(createCustomerApi(ctx)),
    auth: isolate(createAuthApi(ctx)),
    staff: isolate(createStaffApi(ctx)),
    owner: isolate(createOwnerApi(ctx)),
    pro: isolate(createProApi(ctx)),
    admin: isolate(createAdminApi(ctx)),
    async getEntitlements(shopId) {
      assertShop(ctx, shopId);
      return resolveEntitlements(PLAN_DEFAULTS[ctx.s.plan]);
    },
    subscribeShop(shopId, onChange, onState) {
      assertShop(ctx, shopId);
      return emitter.subscribeShop(onChange, onState);
    },

    shopId: SHOP_ID,
    tables,
    pickupBoardToken: PICKUP_BOARD_TOKEN,
    getPlan: () => ctx.s.plan,
    setPlan(plan) {
      ctx.s.plan = plan;
      ctx.s.shop.planId = plan;
      ctx.emit();
    },
    getClock: () => ctx.s.clock,
    setClock(clock) {
      ctx.s.clock = clock;
      ctx.emit();
    },
    reset() {
      clearTimeout(timer);
      removeKey(STORAGE_KEY);
      ctx.s = build(seedState(now().toISOString()));
      emitter.emit(); // not ctx.emit(): that would save the seed again
    },
    onChange: emitter.onChange,
  };
}
