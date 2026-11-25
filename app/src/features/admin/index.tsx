import { useCallback, useEffect, useState } from 'react';
import { DataProvider, useData } from '../../data/context';
import { toLaparError } from '../../data/hooks';
import { getSupabaseData } from '../../data/supabase';
import type { LaparError } from '../../data/types';
import { Banner, Button, ErrorState, Loading } from '../../ui';
import { OwnerSignIn } from '../auth/OwnerSignIn';
import { AdminView } from './AdminView';
import { useAdminT } from './messages';

type State = { kind: 'loading' } | { kind: 'out' } | { kind: 'no' } | { kind: 'ok' } | { kind: 'error'; error: LaparError };

/** Owner sign-in, then is_platform_admin, then the admin screen; anyone else sees "Not authorised". */
export function AdminGate() {
  const t = useAdminT();
  const { auth } = useData();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(() => {
    auth
      .getUser()
      .then(async (u): Promise<State> => (!u || u.isAnonymous ? { kind: 'out' } : (await auth.isPlatformAdmin()) ? { kind: 'ok' } : { kind: 'no' }))
      .then(setState, (e: unknown) => setState({ kind: 'error', error: toLaparError(e) }));
  }, [auth]);
  useEffect(load, [load]);
  const signOut = () => void auth.signOut().then(load, load);

  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <ErrorState error={state.error} onRetry={load} />;
  if (state.kind === 'out') return <OwnerSignIn onSignedIn={load} />;
  if (state.kind === 'no')
    return (
      <main className="mx-auto flex max-w-sm flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold text-stone-900">{t('not_authorised')}</h1>
        <Banner kind="warn">{t('not_authorised_body')}</Banner>
        <Button variant="secondary" onClick={signOut}>
          {t('sign_out')}
        </Button>
      </main>
    );
  return <AdminView onSignOut={signOut} />;
}

export default function AdminRoute() {
  return (
    <DataProvider value={getSupabaseData()}>
      <AdminGate />
    </DataProvider>
  );
}
