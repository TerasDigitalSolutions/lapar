import { LAPAR_ERROR_CODES, LaparError, type LaparErrorCode } from '../types';

/** A PostgREST/supabase-js error body, optionally with the HTTP `status`. */
interface RawError {
  message?: unknown;
  details?: unknown;
  code?: unknown;
  status?: unknown;
}

const isCode = (m: unknown): m is LaparErrorCode => typeof m === 'string' && (LAPAR_ERROR_CODES as readonly string[]).includes(m);

export function toLaparError(e: unknown): LaparError {
  if (e instanceof LaparError) return e;
  if (e instanceof TypeError) return new LaparError('network'); // fetch failed / offline
  const r = (e ?? {}) as RawError;
  const detail = typeof r.details === 'string' && r.details ? r.details : undefined;
  if (isCode(r.message)) return new LaparError(r.message, detail);
  if (r.code === '23503') return new LaparError('in_use');
  if (r.status === 401 || (typeof r.message === 'string' && /jwt/i.test(r.message))) return new LaparError('not_signed_in');
  if (typeof r.message === 'string' && /failed to fetch|network|load failed/i.test(r.message)) return new LaparError('network');
  return new LaparError('unknown', typeof r.message === 'string' ? r.message : undefined);
}

/** Stub for an API part a later card fills: every method rejects with `not_implemented`. */
export function notImplemented<T extends object>(): T {
  return new Proxy({} as T, { get: () => () => Promise.reject(new LaparError('not_implemented')) });
}
