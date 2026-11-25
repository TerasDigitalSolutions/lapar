import { useState } from 'react';
import { useData } from '../../data/context';
import { usePolling } from '../../data/hooks';
import type { IsoDate } from '../../data/types';
import { useLimit } from '../../entitlements/hooks';
import { formatRM } from '../../lib/money';
import { addDays, mytToday } from '../../lib/time';
import { EmptyState, ErrorState, Field, inputClass, Loading } from '../../ui';
import { useLoad } from './hooks';
import { useManagerT } from './messages';
import { Card, Heading } from './parts';

/** Earliest and latest day the owner may look at; `limit` is `report_history_days` (null = unlimited). */
export function reportBounds(today: IsoDate, limit: number | null): { min: IsoDate | undefined; max: IsoDate } {
  return { min: limit === null ? undefined : addDays(today, -(limit - 1)), max: today };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function TodaySection({ shopId }: { shopId: string }) {
  const t = useManagerT();
  const api = useData();
  const limit = useLimit('report_history_days');
  const today = mytToday();
  const { min, max } = reportBounds(today, limit);
  const [typed, setTyped] = useState<string>(today);
  const [day, setDay] = useState<IsoDate>(today);
  const q = useLoad(() => api.owner.getDailySummary(shopId, day), day);
  usePolling(q.reload, 30_000);

  const outside = !DAY.test(typed) || typed > max || (min !== undefined && typed < min);
  const onChange = (value: string) => {
    setTyped(value);
    if (DAY.test(value) && value <= max && (min === undefined || value >= min)) setDay(value);
  };
  const s = q.data;

  return (
    <div className="flex flex-col gap-4">
      <Heading>{day === today ? t('today_title') : t('day_title', { day })}</Heading>
      <Field
        label={t('today_date')}
        hint={min ? t('today_range', { from: min, to: max }) : undefined}
        error={outside ? (min ? t('today_outside', { from: min, to: max }) : t('today_invalid')) : null}
      >
        {(p) => <input {...p} type="date" className={inputClass} value={typed} min={min} max={max} onChange={(e) => onChange(e.target.value)} />}
      </Field>
      {!s && !q.error && <Loading />}
      {!s && !!q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {s && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <p className="text-sm text-stone-600">{t('sales')}</p>
              <p className="text-2xl font-extrabold text-stone-900 tabular-nums">{formatRM(s.salesSen)}</p>
            </Card>
            <Card>
              <p className="text-sm text-stone-600">{t('orders')}</p>
              <p className="text-2xl font-extrabold text-stone-900 tabular-nums">{s.orders}</p>
            </Card>
            <Card className="col-span-2">
              <p className="text-sm text-stone-600">{t('average_bill', { bills: s.bills })}</p>
              <p className="text-2xl font-extrabold text-stone-900 tabular-nums">{formatRM(s.averageBillSen)}</p>
            </Card>
          </div>
          <Card>
            <h3 className="mb-2 text-lg font-bold text-stone-900">{t('top_items')}</h3>
            {s.topItems.length === 0 ? (
              <EmptyState title={t('no_sales')} />
            ) : (
              <ol className="flex flex-col divide-y divide-stone-200">
                {s.topItems.slice(0, 5).map((i, n) => (
                  <li key={i.itemId} className="flex min-h-12 items-center justify-between gap-3">
                    <span className="font-semibold text-stone-900">
                      {n + 1}. {i.name}
                    </span>
                    <span className="text-stone-700 tabular-nums">
                      {t('sold_qty', { n: i.qty })} · {formatRM(i.revenueSen)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
