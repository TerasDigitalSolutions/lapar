import { useEffect, useState } from 'react';
import { useData } from '../../data/context';
import type { StaffSession } from '../../data/types';
import { Button, Loading } from '../../ui';
import { OwnerGate } from '../auth/OwnerGate';
import { ShopShell } from '../auth/ShopShell';
import { useAuthT } from '../auth/messages';
import { StaffPinForm } from './StaffPinForm';
import { StaffView } from './StaffView';

/** Device with a PIN session: `StaffPinForm` until `claimStaffSession` succeeds; back to the form when the session ends. */
function PinGate() {
  const { auth } = useData();
  const t = useAuthT();
  const [session, setSession] = useState<StaffSession | null | undefined>(undefined);

  // `forbidden` / `not_signed_in` just mean "no session": show the PIN form.
  useEffect(() => {
    let live = true;
    const check = () => auth.getStaffSession().then((s) => live && setSession(s), () => live && setSession(null));
    void check();
    if (!session) return () => void (live = false);
    // Re-check when the 16 h session runs out, and when the tab comes back to the front.
    const timer = setTimeout(() => void check(), Math.max(0, new Date(session.expiresAt).getTime() - Date.now()) + 500);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [auth, session?.expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined) return <Loading />;
  if (!session) return <StaffPinForm onSubmit={async (slug, pin) => setSession(await auth.claimStaffSession(slug, pin))} />;
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-stone-200 bg-white px-4 py-1">
        <span className="truncate text-sm text-stone-700">{t('staff_signed_in_as', { name: session.staffName })}</span>
        <Button variant="ghost" onClick={() => void auth.endStaffSession().then(() => setSession(null), () => setSession(null))}>
          {t('sign_out')}
        </Button>
      </div>
      <ShopShell shopId={session.shopId}>
        <StaffView shopId={session.shopId} />
      </ShopShell>
    </>
  );
}

/** Owner (no PIN, D34) -> shop picker -> staff screens; anyone else -> PIN form. */
export function StaffGate() {
  return (
    <OwnerGate signedOut={<PinGate />}>
      {(shop) => (
        <ShopShell shopId={shop.id}>
          <StaffView shopId={shop.id} />
        </ShopShell>
      )}
    </OwnerGate>
  );
}
