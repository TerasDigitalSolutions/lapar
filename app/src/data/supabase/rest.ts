import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from '../../config';
import { toLaparError } from './errors';

/** Anonymous RPC over plain fetch (apikey only, no Authorization) so the customer route never loads supabase-js. */
export async function rpcAnon<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLIC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw toLaparError({ ...(body as object), status: res.status });
    return body as T;
  } catch (e) {
    throw toLaparError(e);
  }
}
