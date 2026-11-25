import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useData } from '../data/context';
import { toLaparError } from '../data/hooks';
import type { LaparError, Uuid } from '../data/types';
import type { Entitlements, FeatureKey, LimitKey } from './keys';

const EntitlementsContext = createContext<Entitlements | null>(null);

export function EntitlementsProvider({ value, children }: { value: Entitlements; children: ReactNode }) {
  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

export function useEntitlements(): Entitlements {
  const value = useContext(EntitlementsContext);
  if (!value) throw new Error('useEntitlements() must be used inside <EntitlementsProvider>');
  return value;
}

export const useFeature = (key: FeatureKey): boolean => useEntitlements().features[key];
/** `null` = unlimited. */
export const useLimit = (key: LimitKey): number | null => useEntitlements().limits[key];

/** Loads `getEntitlements(shopId)` once per shop; for route wrappers that then render `EntitlementsProvider`. */
export function useShopEntitlements(shopId: Uuid): { entitlements: Entitlements | null; error: LaparError | null } {
  const data = useData();
  const [state, setState] = useState<{ shopId: Uuid; entitlements: Entitlements | null; error: LaparError | null } | null>(null);
  useEffect(() => {
    let live = true;
    data.getEntitlements(shopId).then(
      (entitlements) => live && setState({ shopId, entitlements, error: null }),
      (e: unknown) => live && setState({ shopId, entitlements: null, error: toLaparError(e) }),
    );
    return () => {
      live = false;
    };
  }, [data, shopId]);
  return state?.shopId === shopId ? state : { entitlements: null, error: null };
}

/** What the Pro sheet's call to action says (ARCHITECTURE 4). */
export type ProCta = { kind: 'demo' } | { kind: 'whatsapp'; number: string } | { kind: 'neutral' };

const ProCtaContext = createContext<ProCta>({ kind: 'neutral' });

export function ProCtaProvider({ value, children }: { value: ProCta; children: ReactNode }) {
  return <ProCtaContext.Provider value={value}>{children}</ProCtaContext.Provider>;
}

export const useProCta = (): ProCta => useContext(ProCtaContext);
