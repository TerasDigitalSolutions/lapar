import { useFeature } from '../../../entitlements/hooks';
import { ProLocked } from '../../../ui';
import { useManagerT } from '../messages';

/** Pro section slot: locked on Basic, a placeholder until its card builds the real screen. */
export function TakeawaySection({ shopId }: { shopId: string }) {
  const t = useManagerT();
  const on = useFeature('takeaway');
  if (!on) return <ProLocked feature="takeaway" />;
  return <p data-shop-id={shopId} className="p-6 text-stone-700">{t('coming_soon')}</p>;
}
