import type { ReactNode } from 'react';
import type { ShopTheme } from '../../data/types';
import { useShopTheme } from '../../lib/theme';
import { EntitlementsProvider, useShopEntitlements } from '../../entitlements/hooks';
import { ErrorState, Loading, ToastProvider } from '../../ui';

/** Toasts + the shop's entitlements (and color theme) for the staff and manager screens. */
export function ShopShell({ shopId, theme, children }: { shopId: string; theme?: ShopTheme; children: ReactNode }) {
  useShopTheme(theme);
  const { entitlements, error } = useShopEntitlements(shopId);
  if (error) return <ErrorState error={error} />;
  if (!entitlements) return <Loading />;
  return (
    <EntitlementsProvider value={entitlements}>
      <ToastProvider>{children}</ToastProvider>
    </EntitlementsProvider>
  );
}
