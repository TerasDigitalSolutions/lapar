import { LaparError } from '../types';
import { getClient } from './client';
import { toLaparError } from './errors';

export type Client = Awaited<ReturnType<typeof getClient>>;

/** Run a supabase-js call and turn any failure into a LaparError. */
export async function run<T>(fn: (c: Client) => PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  try {
    const { data, error } = await fn(await getClient());
    if (error) {
      const code = (error as { code?: unknown }).code;
      // unique / check violations on direct table writes are bad input, not "unknown"
      if (code === '23505' || code === '23514') throw new LaparError('invalid_input');
      throw toLaparError(error);
    }
    return data as T;
  } catch (e) {
    throw toLaparError(e);
  }
}

/** Authenticated RPC (the session JWT rides along, unlike rpcAnon). */
export const rpc = <T = void>(fn: string, args: Record<string, unknown> = {}): Promise<T> => run<T>((c) => c.rpc(fn, args));
