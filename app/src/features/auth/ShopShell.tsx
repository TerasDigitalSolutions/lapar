import type { ReactNode } from 'react';
import { EntitlementsProvider, useShopEntitlements } from '../../entitlements/hooks';
import { ErrorState, Loading, ToastProvider } from '../../ui';

/** Toasts + the shop's entitlements for the staff and manager screens. */
export function ShopShell({ shopId, children }: { shopId: string; children: ReactNode }) {
  const { entitlements, error } = useShopEntitlements(shopId);
  if (error) return <ErrorState error={error} />;
  if (!entitlements) return <Loading />;
  return (
    <EntitlementsProvider value={entitlements}>
      <ToastProvider>{children}</ToastProvider>
    </EntitlementsProvider>
  );
}
