import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useData } from '../../data/context';
import { toLaparError } from '../../data/hooks';
import type { LaparError, OwnerShopDTO } from '../../data/types';
import { Banner, Button, ErrorState, Loading } from '../../ui';
import { useAuthT } from './messages';
import { OwnerSignIn } from './OwnerSignIn';

type State = { kind: 'loading' } | { kind: 'out' } | { kind: 'error'; error: LaparError } | { kind: 'in'; shops: OwnerShopDTO[] };

/**
 * Owner session gate: sign in (or `signedOut` instead, e.g. the staff PIN form) -> my shops -> picker when several.
 * `children` gets the chosen shop. Renders a thin bar with sign out and switch shop.
 */
export function OwnerGate({ children, signedOut }: { children: (shop: OwnerShopDTO) => ReactNode; signedOut?: ReactNode }) {
  const t = useAuthT();
  const { auth } = useData();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [shopId, setShopId] = useState<string | null>(null);

  const load = useCallback(() => {
    auth
      .getUser()
      .then(async (u): Promise<State> => (u && !u.isAnonymous ? { kind: 'in', shops: await auth.myShops() } : { kind: 'out' }))
      .then(setState, (e: unknown) => setState({ kind: 'error', error: toLaparError(e) }));
  }, [auth]);
  useEffect(load, [load]);

  const signOut = () => void auth.signOut().then(() => (setShopId(null), load()), load);

  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <ErrorState error={state.error} onRetry={load} />;
  if (state.kind === 'out') return signedOut ?? <OwnerSignIn onSignedIn={load} />;

  const shop = state.shops.length === 1 ? state.shops[0] : state.shops.find((s) => s.id === shopId);
  const bar = (
    <div className="flex items-center justify-end gap-2 border-b border-stone-200 bg-white px-3 py-1">
      {state.shops.length > 1 && shop && (
        <Button variant="ghost" onClick={() => setShopId(null)}>
          {t('switch_shop')}
        </Button>
      )}
      <Button variant="ghost" onClick={signOut}>
        {t('sign_out')}
      </Button>
    </div>
  );

  if (!shop)
    return (
      <>
        {bar}
        {state.shops.length === 0 ? (
          <main className="mx-auto max-w-sm p-6">
            <Banner kind="warn">{t('no_shop')}</Banner>
          </main>
        ) : (
          <main className="mx-auto flex max-w-sm flex-col gap-3 p-6">
            <h1 className="text-2xl font-bold text-stone-900">{t('pick_shop')}</h1>
            {state.shops.map((s) => (
              <Button key={s.id} variant="secondary" block onClick={() => setShopId(s.id)}>
                {s.name}
                {!s.active && ` (${t('shop_paused')})`}
              </Button>
            ))}
          </main>
        )}
      </>
    );
  return (
    <>
      {bar}
      {children(shop)}
    </>
  );
}
