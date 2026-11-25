import { useState } from 'react';
import { useData } from '../../data/context';
import { useLiveQuery } from '../../data/hooks';
import type { PaidMethod, TabSummaryDTO, TableOverviewDTO } from '../../data/types';
import { formatRM, roundCash } from '../../lib/money';
import { Banner, Button, EmptyState, ErrorState, Loading, Sheet, useToast } from '../../ui';
import { useStaffT } from './messages';
import { lineLabel } from './OrdersTab';

const METHODS: { id: PaidMethod; key: 'm_cash' | 'm_duitnow' | 'm_card' | 'm_other' }[] = [
  { id: 'cash', key: 'm_cash' },
  { id: 'duitnow', key: 'm_duitnow' },
  { id: 'card', key: 'm_card' },
  { id: 'other', key: 'm_other' },
];

function TabSheet({ shopId, tabId, onClose, onChanged }: { shopId: string; tabId: string; onClose: () => void; onChanged: () => void }) {
  const t = useStaffT();
  const api = useData().staff;
  const toast = useToast();
  const detail = useLiveQuery(() => api.getTabDetail(tabId), { shopId, tables: ['tabs', 'orders', 'order_items'] });
  const [method, setMethod] = useState<PaidMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const d = detail.data;

  const rounded = d && method === 'cash' ? roundCash(d.remainingSen) : null;
  const pay = async () => {
    if (!d || !method) return;
    setBusy(true);
    try {
      await api.recordPayment({ tabId, method });
      toast(t('paid_closed'), 'success');
      onChanged();
      onClose();
    } catch {
      toast(t('action_failed'), 'error');
      detail.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={d ? (d.tableKind === 'counter' && d.pickupNo ? t('pickup_no', { n: d.pickupNo }) : d.tableLabel) : t('tab_detail')}>
      {!d && !detail.error && <Loading />}
      {!d && detail.error && <ErrorState error={detail.error} onRetry={detail.reload} />}
      {d && (
        <div className="flex flex-col gap-4">
          {d.orders.map((o, i) => (
            <section key={o.id} aria-label={t('order_n', { n: i + 1 })}>
              <h3 className="text-sm font-bold text-stone-600">{t('order_n', { n: i + 1 })}</h3>
              {o.status === 'pending_approval' && <p className="text-sm font-semibold text-orange-700">{t('order_pending')}</p>}
              {o.status === 'rejected' && <p className="text-sm text-stone-600">{t('order_rejected', { reason: o.rejectedReason ?? '' })}</p>}
              <ul className="text-base text-stone-800">
                {o.lines
                  .filter((l) => l.kind !== 'component')
                  .map((l) => (
                    <li key={l.id} className={`flex justify-between gap-3 ${l.status === 'cancelled' ? 'line-through opacity-60' : ''}`}>
                      <span>{lineLabel(l.name, l.qty, l.options)}</span>
                      <span>{formatRM(l.lineTotalSen)}</span>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          <dl className="grid grid-cols-2 gap-1 border-t border-stone-200 pt-3 text-base">
            <dt className="font-bold">{t('total')}</dt>
            <dd className="text-right font-bold">{formatRM(d.totalSen)}</dd>
            {d.paidSen > 0 && (
              <>
                <dt>{t('paid')}</dt>
                <dd className="text-right">{formatRM(d.paidSen)}</dd>
                <dt>{t('remaining')}</dt>
                <dd className="text-right">{formatRM(d.remainingSen)}</dd>
              </>
            )}
          </dl>
          {d.hasPendingOrders && <Banner kind="warn">{t('pending_warning')}</Banner>}
          {d.status === 'open' && !d.hasPendingOrders && (
            <div className="flex flex-col gap-3">
              <p className="text-base font-semibold text-stone-800">{t('pay_method')}</p>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => (
                  <Button key={m.id} variant={method === m.id ? 'primary' : 'secondary'} aria-pressed={method === m.id} onClick={() => setMethod(m.id)}>
                    {t(m.key)}
                  </Button>
                ))}
              </div>
              {d.remainingSen === 0 && <p className="text-stone-600">{t('nothing_owed')}</p>}
              {method && (
                <div className="flex flex-col gap-1 rounded-xl bg-stone-100 p-3 text-center">
                  <p className="text-2xl font-bold text-stone-900">{t('pay_collect', { amount: formatRM(rounded ?? d.remainingSen) })}</p>
                  {rounded !== null && rounded !== d.remainingSen && <p className="text-sm text-stone-600">{t('pay_rounding', { amount: formatRM(rounded - d.remainingSen) })}</p>}
                </div>
              )}
              <Button disabled={!method || busy} onClick={() => void pay()}>
                {t('pay_confirm')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

interface Tile {
  key: string;
  table: TableOverviewDTO;
  tab: TabSummaryDTO | null;
}

export function TablesTab({ shopId }: { shopId: string }) {
  const t = useStaffT();
  const api = useData().staff;
  const tables = useLiveQuery(() => api.listTables(shopId), { shopId, tables: ['tabs', 'orders', 'order_items', 'service_requests'] });
  const [openTab, setOpenTab] = useState<string | null>(null);

  if (!tables.data) return tables.error ? <ErrorState error={tables.error} onRetry={tables.reload} /> : <Loading />;
  if (tables.data.length === 0) return <EmptyState title={t('tables_empty')} />;

  const tiles = tables.data.flatMap<Tile>((table) =>
    table.openTabs.length ? table.openTabs.map((tab) => ({ key: tab.id, table, tab })) : [{ key: table.tableId, table, tab: null }],
  );

  return (
    <div className="p-4">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(({ key, table, tab }) => {
          const name = table.kind === 'counter' && tab?.pickupNo ? t('pickup_no', { n: tab.pickupNo }) : table.label;
          const body = (
            <>
              <span className="text-lg font-bold text-stone-900">{name}</span>
              {tab ? (
                <>
                  <span className="text-xl font-bold text-stone-900">{formatRM(tab.remainingSen)}</span>
                  {tab.pendingOrders > 0 && <span className="text-sm font-semibold text-orange-700">{t('tab_pending', { n: tab.pendingOrders })}</span>}
                  {tab.readyLines > 0 && <span className="text-sm font-semibold text-emerald-700">{t('tab_ready', { n: tab.readyLines })}</span>}
                </>
              ) : (
                <span className="text-stone-500">{t('table_free')}</span>
              )}
              {table.openRequests > 0 && <span className="text-sm font-semibold text-red-700">{t('tab_calls', { n: table.openRequests })}</span>}
            </>
          );
          const cls = 'flex min-h-24 flex-col items-start gap-1 rounded-2xl border-2 p-3 text-left';
          return (
            <li key={key}>
              {tab ? (
                <button type="button" onClick={() => setOpenTab(tab.id)} className={`${cls} w-full border-orange-300 bg-white active:bg-orange-50`}>
                  {body}
                </button>
              ) : (
                <div className={`${cls} border-stone-200 bg-stone-50`}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {openTab && <TabSheet shopId={shopId} tabId={openTab} onClose={() => setOpenTab(null)} onChanged={tables.reload} />}
    </div>
  );
}
