import { SITE_BASE_URL } from '../../config';
import { LAPAR_ERROR_CODES, LaparError, type AdminApi, type AdminShopDTO, type LaparErrorCode, type OwnerLinkDTO, type PlatformSettingsDTO, type Uuid } from '../types';
import { rpc } from './authed';
import { getClient } from './client';
import { toLaparError } from './errors';

const EXPIRES_HOURS = 24;

/** Edge Function failures carry `{ error, detail }` in the response body. */
async function functionError(e: unknown): Promise<LaparError> {
  const res = (e as { context?: unknown }).context;
  if (res instanceof Response) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown; detail?: unknown };
    const code = (LAPAR_ERROR_CODES as readonly string[]).find((c) => c === body.error) as LaparErrorCode | undefined;
    if (code) return new LaparError(code, typeof body.detail === 'string' ? body.detail : undefined);
    if (res.status === 401) return new LaparError('not_signed_in');
    if (res.status === 403) return new LaparError('forbidden');
  }
  return toLaparError(e);
}

export const adminApi: AdminApi = {
  listShops: () => rpc<AdminShopDTO[]>('admin_list_shops'),
  createShop: (input) => rpc<Uuid>('admin_create_shop', { p_name: input.name, p_slug: input.slug }),

  async createOwnerLink(shopId, email, mode): Promise<OwnerLinkDTO> {
    try {
      const { data, error } = await (await getClient()).functions.invoke('admin-owner-link', { body: { shopId, email, mode } });
      if (error) throw await functionError(error);
      const r = data as { email: string; mode: OwnerLinkDTO['mode']; tokenHash: string; verifyType: string };
      const url = `${SITE_BASE_URL}#/welcome?token_hash=${encodeURIComponent(r.tokenHash)}&type=${r.verifyType}`;
      return { email: r.email, mode: r.mode, url, expiresHours: EXPIRES_HOURS };
    } catch (e) {
      throw toLaparError(e);
    }
  },

  setPlan: (shopId, planId) => rpc('admin_set_plan', { p_shop_id: shopId, p_plan_id: planId }),
  setOverride: (i) =>
    rpc('admin_set_override', { p_shop_id: i.shopId, p_key: i.key, p_enabled: i.enabled ?? null, p_limit_value: i.limitValue ?? null, p_note: i.note }),
  clearOverride: (shopId, key) => rpc('admin_clear_override', { p_shop_id: shopId, p_key: key }),
  setShopActive: (shopId, active) => rpc('admin_set_shop_active', { p_shop_id: shopId, p_active: active }),
  getPlatformSettings: () => rpc<PlatformSettingsDTO>('admin_get_platform_settings'),
  setPlatformSettings: (s) => rpc('admin_set_platform_settings', { p_whatsapp_number: s.whatsappNumber }),
};
