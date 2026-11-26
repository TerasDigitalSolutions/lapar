import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ShopTheme } from '../data/types';
import { useShopTheme } from './theme';

describe('useShopTheme', () => {
  it('sets data-theme, follows changes and clears on unmount', () => {
    const { rerender, unmount } = renderHook(({ t }: { t: ShopTheme }) => useShopTheme(t), { initialProps: { t: 'pandan' } });
    expect(document.documentElement.dataset.theme).toBe('pandan');
    rerender({ t: 'malam' });
    expect(document.documentElement.dataset.theme).toBe('malam');
    unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('an inner screen unmounting keeps the outer theme', () => {
    const outer = renderHook(() => useShopTheme('pandan'));
    const inner = renderHook(() => useShopTheme('pandan'));
    inner.unmount();
    expect(document.documentElement.dataset.theme).toBe('pandan');
    outer.unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('does nothing without a theme', () => {
    renderHook(() => useShopTheme(null));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
