import { useData } from '../../data/context';
import { useEntitlements } from '../../entitlements/hooks';
import { FEATURE_KEYS, LIMIT_KEYS } from '../../entitlements/keys';
import { entitlementLabel } from '../../entitlements/messages';
import { ErrorState, focusRing, LimitBadge, Loading, ProLocked } from '../../ui';
import { useLoad } from './hooks';
import { useManagerT } from './messages';
import { Card, Heading } from './parts';

const USAGE = { max_tables: 'tables', max_stations: 'stations', max_staff: 'staff' } as const;

export function PlanSection({ shopId }: { shopId: string }) {
  const t = useManagerT();
  const api = useData();
  const ent = useEntitlements();
  const q = useLoad(() => api.owner.getShopPlan(shopId), `${shopId}:${JSON.stringify(ent)}`);
  if (!q.data) return q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : <Loading />;
  const plan = q.data;
  const number = plan.askTerasWhatsapp?.replace(/\D/g, '') || null;
  const history = plan.entitlements.limits.report_history_days;

  return (
    <div className="flex flex-col gap-4">
      <Heading>{t('plan_title')}</Heading>
      <Card>
        <p className="text-sm text-stone-600">{t('plan_current')}</p>
        <p className="text-2xl font-extrabold text-stone-900">{plan.planId === 'pro' ? t('plan_pro') : t('plan_basic')}</p>
      </Card>

      <Card className="flex flex-col gap-2">
        <h3 className="text-lg font-bold text-stone-900">{t('plan_limits')}</h3>
        <ul className="flex flex-col divide-y divide-stone-200">
          {LIMIT_KEYS.filter((k) => k !== 'report_history_days').map((k) => (
            <li key={k} className="flex min-h-12 items-center justify-between gap-3">
              <span className="text-stone-900">{entitlementLabel(k)}</span>
              <span className="flex items-center gap-2">
                {plan.entitlements.limits[k] === null ? (
                  <>
                    <span className="tabular-nums text-stone-700">{plan.usage[USAGE[k as keyof typeof USAGE]]}</span>
                    <span className="text-sm text-stone-600">{t('unlimited')}</span>
                  </>
                ) : (
                  <LimitBadge used={plan.usage[USAGE[k as keyof typeof USAGE]]} limitKey={k} />
                )}
              </span>
            </li>
          ))}
          <li className="flex min-h-12 items-center justify-between gap-3">
            <span className="text-stone-900">{entitlementLabel('report_history_days')}</span>
            <span className="text-stone-700">{history === null ? t('unlimited') : t('days', { n: history })}</span>
          </li>
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-lg font-bold text-stone-900">{t('plan_features')}</h3>
        <ul className="flex flex-col gap-2">
          {FEATURE_KEYS.map((k) => (
            <li key={k}>
              {plan.entitlements.features[k] ? (
                <p className="flex min-h-12 items-center gap-3 text-stone-900">
                  <span aria-hidden="true" className="font-bold text-green-700">
                    ✓
                  </span>
                  <span>
                    {entitlementLabel(k)}
                    <span className="sr-only"> {t('included')}</span>
                  </span>
                </p>
              ) : (
                <ProLocked feature={k} />
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-lg font-bold text-stone-900">{t('ask_teras_title')}</h3>
        {number ? (
          <a
            href={`https://wa.me/${number}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex min-h-12 items-center justify-center rounded-xl bg-green-700 px-5 text-base font-semibold text-white ${focusRing}`}
          >
            {t('ask_teras')}
          </a>
        ) : (
          <p className="text-stone-700">{t('ask_teras_neutral')}</p>
        )}
      </Card>
    </div>
  );
}
