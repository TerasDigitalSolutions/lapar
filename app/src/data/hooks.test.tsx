import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DataProvider, useData } from './context';
import { useLiveQuery } from './hooks';
import type { ConnectionState, LaparData, ShopChange } from './types';

let onChange: (c: ShopChange) => void;
let onState: (s: ConnectionState) => void;
const unsubscribe = vi.fn();
const fake = {
  subscribeShop: (_id: string, c: typeof onChange, s: typeof onState) => ((onChange = c), (onState = s), unsubscribe),
} as unknown as LaparData;
const wrapper = ({ children }: { children: ReactNode }) => <DataProvider value={fake}>{children}</DataProvider>;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = () => {
  let n = 0;
  const load = vi.fn(async () => ++n);
  const hook = renderHook(() => useLiveQuery(load, { shopId: 's', tables: ['orders'] }), { wrapper });
  return { load, hook };
};
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

test('useData throws outside a provider', () => {
  expect(() => renderHook(() => useData())).toThrow();
});

test('loads, debounces matching changes, ignores other tables', async () => {
  const { load, hook } = setup();
  await flush();
  expect(hook.result.current.data).toBe(1);
  act(() => {
    onChange({ table: 'tabs', event: 'UPDATE', id: 'x' });
    onChange({ table: 'orders', event: 'INSERT', id: 'a' });
    onChange({ table: 'orders', event: 'UPDATE', id: 'a' });
  });
  await act(async () => void (await vi.advanceTimersByTimeAsync(299)));
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => void (await vi.advanceTimersByTimeAsync(2)));
  expect(load).toHaveBeenCalledTimes(2);
  expect(hook.result.current.data).toBe(2);
});

test('reloads on offline -> live, visible and online; reports connection', async () => {
  const { load, hook } = setup();
  await flush();
  act(() => onState('live'));
  expect(load).toHaveBeenCalledTimes(1);
  act(() => onState('offline'));
  expect(hook.result.current.connection).toBe('offline');
  act(() => onState('live'));
  expect(load).toHaveBeenCalledTimes(2);
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  expect(load).toHaveBeenCalledTimes(3);
  act(() => void window.dispatchEvent(new Event('online')));
  expect(load).toHaveBeenCalledTimes(4);
});

test('keeps data on error and unsubscribes on unmount', async () => {
  const load = vi.fn().mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('boom'));
  const hook = renderHook(() => useLiveQuery(load, { shopId: 's', tables: ['orders'] }), { wrapper });
  await flush();
  act(() => hook.result.current.reload());
  await flush();
  expect(hook.result.current.data).toBe('ok');
  expect(hook.result.current.error?.code).toBe('unknown');
  hook.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});
