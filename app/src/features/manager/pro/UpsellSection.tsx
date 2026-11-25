import { useFeature } from '../../../entitlements/hooks';
import { ProLocked } from '../../../ui';
import { useManagerT } from '../messages';

/** Pro section slot: locked on Basic, a placeholder until its card builds the real screen. */
export function UpsellSection({ shopId }: { shopId: string }) {
  const t = useManagerT();
  const on = useFeature('upsell_report');
  if (!on) return <ProLocked feature="upsell_report" />;
  return <p data-shop-id={shopId} className="p-6 text-stone-700">{t('coming_soon')}</p>;
}
