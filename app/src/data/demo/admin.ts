/** Admin API for the demo: lists the demo shop; everything else is not supported. */
import type { AdminApi } from '../types';
import { assertShop, entitlements, fail, type Ctx } from './util';

export function createAdminApi(ctx: Ctx): AdminApi {
  const no = (name: string) => async (): Promise<never> => fail('not_implemented', name);
  return {
    async listShops() {
      const { shop, plan, orders } = ctx.s;
      const last = orders.reduce<string | null>((m, o) => (m === null || o.createdAt > m ? o.createdAt : m), null);
      return [
        {
          id: shop.id,
          name: shop.name,
          slug: shop.slug,
          planId: plan,
          active: shop.active,
          createdAt: shop.createdAt,
          lastOrderAt: last,
          ownerEmails: ['owner@demo.test'],
          overrides: [],
          entitlements: entitlements(ctx),
        },
      ];
    },
    async getPlatformSettings() {
      return { whatsappNumber: null };
    },
    async setShopActive(shopId, active) {
      assertShop(ctx, shopId);
      ctx.s.shop.active = active;
      ctx.emit();
    },
    createShop: no('admin_create_shop'),
    createOwnerLink: no('admin_owner_link'),
    setPlan: no('admin_set_plan'),
    setOverride: no('admin_set_override'),
    clearOverride: no('admin_clear_override'),
    setPlatformSettings: no('admin_set_platform_settings'),
  };
}
