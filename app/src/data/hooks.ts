import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useData } from './context';
import { LaparError, type ConnectionState, type ShopTable, type Uuid } from './types';

export const toLaparError = (e: unknown): LaparError => (e instanceof LaparError ? e : new LaparError('unknown', e instanceof Error ? e.message : undefined));

const subscribeVisible = (f: () => void) => (document.addEventListener('visibilitychange', f), () => document.removeEventListener('visibilitychange', f));
export const usePageVisible = (): boolean => useSyncExternalStore(subscribeVisible, () => document.visibilityState === 'visible', () => true);

const subscribeOnline = (f: () => void) => {
  window.addEventListener('online', f);
  window.addEventListener('offline', f);
  return () => (window.removeEventListener('online', f), window.removeEventListener('offline', f));
};
export const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

/** Calls `fn` every `ms` while the page is visible (and once more when it becomes visible again). */
export function usePolling(fn: () => void, ms: number | null | undefined): void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible || !ms) return;
    const id = setInterval(() => fnRef.current(), ms);
    return () => clearInterval(id);
  }, [visible, ms]);
}

export interface LiveQuery<T> {
  data: T | null;
  error: LaparError | null;
  connection: ConnectionState;
  /** Reload now (not debounced). */
  reload: () => void;
}

const DEBOUNCE_MS = 300;

/**
 * Loads `load()`, then reloads (300 ms debounce) when a change in one of `tables` arrives, fully
 * when the connection returns to `live` after `offline`, when the page becomes visible and on `online`.
 * Missed events are never trusted. `data` keeps its last value while a reload or an error happens.
 */
export function useLiveQuery<T>(
  load: () => Promise<T>,
  opts: { shopId: Uuid; tables: readonly ShopTable[]; pollMs?: number },
): LiveQuery<T> {
  const api = useData();
  const { shopId, pollMs } = opts;
  const tablesKey = opts.tables.join(',');
  const [state, setState] = useState<{ data: T | null; error: LaparError | null }>({ data: null, error: null });
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const loadRef = useRef(load);
  const seq = useRef(0);
  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    const mine = ++seq.current;
    loadRef.current().then(
      (data) => mine === seq.current && setState({ data, error: null }),
      (e: unknown) => mine === seq.current && setState((s) => ({ data: s.data, error: toLaparError(e) })),
    );
  }, []);

  /** Drop any in-flight response. */
  const discard = useCallback(() => void seq.current++, []);

  useEffect(() => {
    const tables = tablesKey.split(',');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: ConnectionState = 'connecting';
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, DEBOUNCE_MS);
    };
    const onVisible = () => document.visibilityState === 'visible' && reload();
    reload();
    const off = api.subscribeShop(
      shopId,
      (c) => tables.includes(c.table) && debounced(),
      (s) => {
        if (last === 'offline' && s === 'live') reload();
        last = s;
        setConnection(s);
      },
    );
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', reload);
    return () => {
      clearTimeout(timer);
      discard();
      off();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', reload);
    };
  }, [api, shopId, tablesKey, reload, discard]);

  usePolling(reload, pollMs);

  return { data: state.data, error: state.error, connection, reload };
}
