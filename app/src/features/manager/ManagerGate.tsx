import { useEffect, useState } from 'react';
import { useData } from '../../data/context';
import type { ShopTheme } from '../../data/types';
import { ProCtaProvider, type ProCta } from '../../entitlements/hooks';
import { OwnerGate } from '../auth/OwnerGate';
import { ShopShell } from '../auth/ShopShell';
import { ManagerView } from './ManagerView';

function ManagerShop({ shopId, initialTheme }: { shopId: string; initialTheme: ShopTheme }) {
  const { owner } = useData();
  const [cta, setCta] = useState<ProCta>({ kind: 'neutral' });
  const [theme, setTheme] = useState(initialTheme);
  // The "Ask Teras" number lives in the database (platform setting); none = neutral message.
  useEffect(() => {
    let live = true;
    owner.getShopPlan(shopId).then(
      (p) => live && setCta(p.askTerasWhatsapp ? { kind: 'whatsapp', number: p.askTerasWhatsapp } : { kind: 'neutral' }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [owner, shopId]);
  return (
    <ShopShell shopId={shopId} theme={theme}>
      <ProCtaProvider value={cta}>
        <ManagerView shopId={shopId} onTheme={setTheme} />
      </ProCtaProvider>
    </ShopShell>
  );
}

/** Owner sign-in -> my shops -> picker if several -> entitlements -> ManagerView. */
export function ManagerGate() {
  return <OwnerGate>{(shop) => <ManagerShop key={shop.id} shopId={shop.id} initialTheme={shop.theme} />}</OwnerGate>;
}
