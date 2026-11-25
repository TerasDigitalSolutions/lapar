import type { Entitlements, LaparData } from '../types';
import { adminApi } from './admin';
import { authApi } from './auth';
import { getClient } from './client';
import { customerApi } from './customer';
import { toLaparError } from './errors';
import { ownerApi } from './owner';
import { proApi } from './pro';
import { subscribeShop } from './realtime';
import { staffApi } from './staff';

let data: LaparData | undefined;

export function getSupabaseData(): LaparData {
  data ??= {
    kind: 'supabase',
    customer: customerApi,
    auth: authApi,
    staff: staffApi,
    owner: ownerApi,
    pro: proApi,
    admin: adminApi,
    async getEntitlements(shopId) {
      const { data: res, error } = await (await getClient()).rpc('get_entitlements', { p_shop_id: shopId });
      if (error) throw toLaparError(error);
      return res as Entitlements;
    },
    subscribeShop,
  };
  return data;
}
