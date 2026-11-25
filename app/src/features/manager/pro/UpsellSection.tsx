import { useState } from 'react';
import { useData } from '../../../data/context';
import { useFeature, useLimit } from '../../../entitlements/hooks';
import { formatRM } from '../../../lib/money';
import { addDays, mytToday } from '../../../lib/time';
import { EmptyState, ErrorState, Field, inputClass, Loading, ProLocked } from '../../../ui';
import { useLoad } from '../hooks';
import { Card, Heading } from '../parts';
import { useReportT } from './reportParts';

export function UpsellSection({ shopId }: { shopId: string }) {
  const on = useFeature('upsell_report');
  if (!on) return <ProLocked feature="upsell_report" />;
  return <UpsellBody shopId={shopId} />;
}

function UpsellBody({ shopId }: { shopId: string }) {
  const t = useReportT();
  const api = useData();
  const limit = useLimit('report_history_days');
  const today = mytToday();
  const max = today.slice(0, 7);
  const min = limit === null ? undefined : addDays(today, -(limit - 1)).slice(0, 7);
  const [month, setMonth] = useState(max);
  const ok = /^\d{4}-\d{2}$/.test(month) && month <= max && (!min || month >= min);
  const q = useLoad(() => (ok ? api.pro.getUpsellReport(shopId, month) : Promise.resolve(null)), `${ok}${month}`);
  const u = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Heading>{t('upsell_title')}</Heading>
      <Field label={t('month')}>
        {(p) => <input {...p} type="month" className={inputClass} value={month} min={min} max={max} onChange={(e) => setMonth(e.target.value)} />}
      </Field>
      {ok && !u && !q.error && <Loading />}
      {ok && !u && !!q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {ok && u && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <p className="text-sm text-stone-600">{t('upsell_earned')}</p>
              <p className="text-2xl font-extrabold text-stone-900 tabular-nums">{formatRM(u.revenueSen)}</p>
            </Card>
            <Card>
              <p className="text-sm text-stone-600">{t('upsell_adds')}</p>
              <p className="text-2xl font-extrabold text-stone-900 tabular-nums">{u.adds}</p>
            </Card>
          </div>
          {u.rows.length === 0 ? (
            <EmptyState title={t('upsell_none')} />
          ) : (
            <Card>
              <ul className="flex flex-col divide-y divide-stone-200">
                {u.rows.map((r) => (
                  <li key={`${r.sourceItemId}>${r.suggestedItemId}`} className="flex min-h-12 flex-col justify-center py-2">
                    <span className="font-semibold text-stone-900">{t('upsell_row', { source: r.sourceName, suggested: r.suggestedName })}</span>
                    <span className="text-sm text-stone-700 tabular-nums">
                      {t('upsell_detail', {
                        adds: r.adds,
                        orders: r.sourceOrders,
                        rate: r.sourceOrders ? Math.round((100 * r.adds) / r.sourceOrders) : 0,
                        amount: formatRM(r.revenueSen),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
