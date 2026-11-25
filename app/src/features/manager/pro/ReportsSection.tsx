import { useData } from '../../../data/context';
import type { SalesReportDTO } from '../../../data/types';
import { useFeature } from '../../../entitlements/hooks';
import { formatRM } from '../../../lib/money';
import { EmptyState, ErrorState, Loading, ProLocked } from '../../../ui';
import { useLoad } from '../hooks';
import { Card, Heading } from '../parts';
import { Bars, useDateRange, useReportT } from './reportParts';

const avgBill = (sales: number, bills: number): number => (bills ? Math.floor((2 * sales + bills) / (2 * bills)) : 0);

function Report({ r }: { r: SalesReportDTO }) {
  const t = useReportT();
  const sold = r.items.filter((i) => i.qty > 0);
  const best = sold.slice(0, 5);
  const worst = [...r.items].reverse().slice(0, 5);
  const hours = r.byHour.filter((h) => h.salesSen > 0);
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const row = (i: { itemId: string; name: string; qty: number; revenueSen: number }, n: number) => (
    <li key={i.itemId} className="flex min-h-12 items-center justify-between gap-3">
      <span className="font-semibold text-stone-900">
        {n + 1}. {i.name}
      </span>
      <span className="text-stone-700 tabular-nums">
        {t('sold_qty', { n: i.qty })} · {formatRM(i.revenueSen)}
      </span>
    </li>
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-sm text-stone-600">{t('sales')}</p>
          <p className="text-2xl font-extrabold text-stone-900 tabular-nums">{formatRM(r.salesSen)}</p>
        </Card>
        <Card>
          <p className="text-sm text-stone-600">{t('orders')}</p>
          <p className="text-2xl font-extrabold text-stone-900 tabular-nums">{r.orders}</p>
        </Card>
        <Card>
          <p className="text-sm text-stone-600">{t('bills')}</p>
          <p className="text-2xl font-extrabold text-stone-900 tabular-nums">{r.bills}</p>
        </Card>
        <Card>
          <p className="text-sm text-stone-600">{t('average_bill')}</p>
          <p className="text-2xl font-extrabold text-stone-900 tabular-nums">{formatRM(avgBill(r.salesSen, r.bills))}</p>
        </Card>
      </div>
      {r.orders === 0 ? (
        <EmptyState title={t('no_data')} />
      ) : (
        <>
          <Card>
            <h3 className="mb-2 text-lg font-bold text-stone-900">{t('by_day')}</h3>
            <Bars label={t('by_day')} rows={r.byDay.map((d) => ({ key: d.day, label: d.day.slice(5), value: d.salesSen, text: formatRM(d.salesSen) }))} />
          </Card>
          <Card>
            <h3 className="mb-2 text-lg font-bold text-stone-900">{t('by_hour')}</h3>
            <Bars label={t('by_hour')} rows={hours.map((h) => ({ key: String(h.hour), label: pad(h.hour), value: h.salesSen, text: formatRM(h.salesSen) }))} />
          </Card>
          <Card>
            <h3 className="mb-2 text-lg font-bold text-stone-900">{t('best')}</h3>
            <ol className="flex flex-col divide-y divide-stone-200">{best.map(row)}</ol>
          </Card>
          <Card>
            <h3 className="mb-2 text-lg font-bold text-stone-900">{t('worst')}</h3>
            <ol className="flex flex-col divide-y divide-stone-200">{worst.map(row)}</ol>
          </Card>
          <Card>
            <h3 className="mb-2 text-lg font-bold text-stone-900">{t('prep')}</h3>
            <p className="mb-2 text-stone-700">
              {t('prep_overall', { avg: r.prepOverall.avgMinutes, median: r.prepOverall.medianMinutes, count: r.prepOverall.count })}
            </p>
            <ul className="flex flex-col divide-y divide-stone-200">
              {r.prep.map((p) => (
                <li key={p.itemId} className="flex min-h-12 items-center justify-between gap-3">
                  <span className="font-semibold text-stone-900">{p.name}</span>
                  <span className="text-right text-sm text-stone-700 tabular-nums">{t('prep_row', { avg: p.avgMinutes, median: p.medianMinutes, count: p.count })}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

export function ReportsSection({ shopId }: { shopId: string }) {
  const on = useFeature('full_reports');
  if (!on) return <ProLocked feature="full_reports" />;
  return <ReportsBody shopId={shopId} />;
}

function ReportsBody({ shopId }: { shopId: string }) {
  const t = useReportT();
  const api = useData();
  const { from, to, valid, fields } = useDateRange();
  const q = useLoad(() => (valid ? api.pro.getSalesReport(shopId, from, to) : Promise.resolve(null)), `${valid}${from}${to}`);
  return (
    <div className="flex flex-col gap-4">
      <Heading>{t('reports_title')}</Heading>
      {fields}
      {valid && !q.data && !q.error && <Loading />}
      {valid && !q.data && !!q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {valid && q.data && <Report r={q.data} />}
    </div>
  );
}
