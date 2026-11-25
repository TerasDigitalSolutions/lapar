import { useCallback, useEffect, useRef, useState } from 'react';
import { toLaparError } from '../../data/hooks';
import { useToast } from '../../ui';
import { useUiT } from '../../ui/messages';

/** Loads once and again whenever `key` changes; `reload()` refreshes in place (data is kept meanwhile). */
export function useLoad<T>(load: () => Promise<T>, key: unknown = null) {
  const [state, setState] = useState<{ data: T | null; error: unknown }>({ data: null, error: null });
  const loadRef = useRef(load);
  const seq = useRef(0);
  useEffect(() => {
    loadRef.current = load;
  });
  const reload = useCallback(() => {
    const mine = ++seq.current;
    loadRef.current().then(
      (data) => mine === seq.current && setState({ data, error: null }),
      (error: unknown) => mine === seq.current && setState((s) => ({ data: s.data, error })),
    );
  }, []);
  useEffect(() => {
    const counter = seq;
    reload();
    return () => void counter.current++;
  }, [reload, key]);
  return { data: state.data, error: state.error, reload };
}

/** Readable text for any thrown value (never a raw code). */
export function useErrText() {
  const t = useUiT();
  return (e: unknown): string => t(`err_${toLaparError(e).code}`);
}

/**
 * `run(fn, successMessage?)`: runs one save, shows an error toast on failure (and the optional
 * success toast), tracks `busy`. Resolves to `{ value }` on success (so void saves are truthy), or undefined on failure.
 */
export function useAct() {
  const toast = useToast();
  const errText = useErrText();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T>(fn: () => Promise<T>, success?: string, onError?: (e: unknown) => string | null): Promise<{ value: T } | undefined> => {
      setBusy(true);
      try {
        const result = await fn();
        if (success) toast(success, 'success');
        return { value: result };
      } catch (e) {
        toast(onError?.(e) ?? errText(e), 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast, errText],
  );
  return { run, busy };
}

/** The ids with the one at `index` moved by `delta` (-1 up, +1 down); null when it cannot move. */
export function moved(ids: readonly string[], index: number, delta: -1 | 1): string[] | null {
  const to = index + delta;
  if (to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** sen -> "2.20" for a price field. */
export const priceText = (sen: number): string => (sen / 100).toFixed(2);
