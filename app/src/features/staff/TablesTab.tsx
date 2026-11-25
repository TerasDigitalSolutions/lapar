import { useEffect, useState } from 'react';
import { useData } from '../../data/context';
import { useLiveQuery } from '../../data/hooks';
import type { PaidMethod, RecordPaymentInput,TabSummaryDTO, TableOverviewDTO } from '../../data/types';
import { useFeature } from '../../entitlements/hooks';
import { formatRM, roundCash, splitEqual } from '../../lib/money';
import { Banner, Button, EmptyState, ErrorState, Loading, ProLocked, QtyStepper, Segmented, Sheet, useToast } from '../../ui';
import { PickupBoardView } from '../pickup/PickupBoardView';
import { billSlip, hhmm, PrintSheet, type Slip } from '../print';
import { useErrorText } from './errors';
import { useStaffT } from './messages';
import { lineLabel } from './OrdersTab';

const METHODS: { id: PaidMethod; key: 'm_cash' | 'm_duitnow' | 'm_card' | 'm_other' }[] = [
  { id: 'cash', key: 'm_cash' },
  { id: 'duitnow', key: 'm_duitnow' },
  { id: 'card', key: 'm_card' },
  { id: 'other', key: 'm_other' },
];

type Mode = 'full' | 'items' | 'equal';

function TabSheet({ shopId, tabId, shopName, onClose, onChanged }: { shopId: string; tabId: string; shopName: string; onClose: () => void; onChanged: () => void }) {
  const t = useStaffT();
  const api = useData().staff;
  const toast = useToast();
  const errorText = useErrorText();
  const canSplit = useFeature('bill_split');
  const canPrint = useFeature('printing');
  const detail = useLiveQuery(() => api.getTabDetail(tabId), { shopId, tables: ['tabs', 'orders', 'order_items'] });
  const [method, setMethod] = useState<PaidMethod | null>(null);
  const [mode, setMode] = useState<Mode>('full');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState(2);
  const [busy, setBusy] = useState(false);
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const d = detail.data;

  const place = d ? (d.tableKind === 'counter' && d.pickupNo ? t('pickup_no', { n: d.pickupNo }) : d.tableLabel) : '';
  const unpaid = (d?.orders ?? [])
    .filter((o) => o.status === 'approved')
    .flatMap((o) => o.lines)
    .filter((l) => l.kind !== 'component' && l.status !== 'cancelled' && !l.paidPaymentId);
  const pickedLines = unpaid.filter((l) => picked.has(l.id));

  // What this payment settles. `input` is what record_payment receives.
  let amount = d?.remainingSen ?? 0;
  let input: Omit<RecordPaymentInput, 'method'> = { tabId };
  if (d && mode === 'items') {
    amount = pickedLines.reduce((sum, l) => sum + l.lineTotalSen, 0);
    input = { tabId, orderItemIds: pickedLines.map((l) => l.id) };
  } else if (d && mode === 'equal') {
    amount = splitEqual(d.remainingSen, people)[0] ?? 0;
    input = { tabId, amountSen: amount };
  }
  const rounded = method === 'cash' ? roundCash(amount) : null;
  const canPay = !!method && !busy && !(mode === 'items' && pickedLines.length === 0);

  const pay = async () => {
    if (!d || !method) return;
    setBusy(true);
    try {
      const r = await api.recordPayment({ ...input, method });
      if (r.tabClosed) {
        toast(t('paid_closed'), 'success');
        onChanged();
        onClose();
      } else {
        setPicked(new Set());
        setPeople((p) => Math.max(1, p - 1));
        detail.reload();
        onChanged();
      }
    } catch (e) {
      toast(errorText(e), 'error');
      detail.reload();
    } finally {
      setBusy(false);
    }
  };

  const modes = [
    { value: 'full' as const, label: t('split_full') },
    { value: 'items' as const, label: t('split_items') },
    { value: 'equal' as const, label: t('split_equal') },
  ];

  return (
    <>
    <Sheet open onClose={onClose} title={d ? place : t('tab_detail')}>
      {!d && !detail.error && <Loading />}
      {!d && detail.error && <ErrorState error={detail.error} onRetry={detail.reload} />}
      {d && (
        <div className="flex flex-col gap-4">
          {d.pickupAt && <p className="text-sm font-semibold text-stone-700">{t('pickup_time', { time: hhmm(d.pickupAt) })}</p>}
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
            {d.payments.map((p) => (
              <div key={p.id} className="col-span-2 flex justify-between" data-testid="payment">
                <dt>{t(METHODS.find((m) => m.id === p.method)!.key)}</dt>
                <dd>{formatRM(p.amountSen)}</dd>
              </div>
            ))}
            {d.paidSen > 0 && (
              <>
                <dt>{t('paid')}</dt>
                <dd className="text-right">{formatRM(d.paidSen)}</dd>
                <dt>{t('remaining')}</dt>
                <dd className="text-right">{formatRM(d.remainingSen)}</dd>
              </>
            )}
          </dl>
          {canPrint ? (
            <Button variant="secondary" onClick={() => setSlips([billSlip(d, shopName, place)])}>
              {t('print_bill')}
            </Button>
          ) : (
            <ProLocked feature="printing">{t('print_bill')}</ProLocked>
          )}
          {d.hasPendingOrders && <Banner kind="warn">{t('pending_warning')}</Banner>}
          {d.status === 'open' && !d.hasPendingOrders && (
            <div className="flex flex-col gap-3">
              {canSplit ? (
                <Segmented label={t('split_mode')} options={modes} value={mode} onChange={setMode} />
              ) : (
                <ProLocked feature="bill_split" />
              )}
              {mode === 'items' && (
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-1 text-sm text-stone-600">{t('split_items_hint')}</legend>
                  {unpaid.map((l) => (
                    <label key={l.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-stone-200 px-3">
                      <input
                        type="checkbox"
                        className="size-6"
                        checked={picked.has(l.id)}
                        onChange={(e) => setPicked((s) => (e.target.checked ? new Set(s).add(l.id) : new Set([...s].filter((x) => x !== l.id))))}
                      />
                      <span className="flex-1">{lineLabel(l.name, l.qty, l.options)}</span>
                      <span>{formatRM(l.lineTotalSen)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {mode === 'equal' && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-base font-semibold">{t('split_people')}</span>
                  <QtyStepper label={t('split_people')} value={people} min={d.paidSen > 0 ? 1 : 2} max={10} onChange={setPeople} />
                </div>
              )}
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
                  <p className="text-2xl font-bold text-stone-900">{t('pay_collect', { amount: formatRM(rounded ?? amount) })}</p>
                  {rounded !== null && rounded !== amount && <p className="text-sm text-stone-600">{t('pay_rounding', { amount: formatRM(rounded - amount) })}</p>}
                  {mode === 'equal' && <p className="text-sm text-stone-600">{t('split_share', { n: people })}</p>}
                </div>
              )}
              <Button disabled={!canPay} onClick={() => void pay()}>
                {t('pay_confirm')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
      <PrintSheet slips={slips} onClose={() => setSlips(null)} />
    </>
  );
}

interface Tile {
  key: string;
  table: TableOverviewDTO;
  tab: TabSummaryDTO | null;
}

export function TablesTab({ shopId }: { shopId: string }) {
  const t = useStaffT();
  const api = useData();
  const takeaway = useFeature('takeaway');
  const tables = useLiveQuery(() => api.staff.listTables(shopId), { shopId, tables: ['tabs', 'orders', 'order_items', 'service_requests'] });
  const [openTab, setOpenTab] = useState<string | null>(null);
  const [board, setBoard] = useState(false);
  const [shop, setShop] = useState<{ name: string; pickupBoardToken: string | null } | null>(null);

  // Shop name and pickup board token: a staff device reads them from its staff session (it may not read settings); an owner on the staff screens has none and falls back to settings.
  useEffect(() => {
    let live = true;
    const set = (v: { name: string; pickupBoardToken: string | null }) => live && setShop(v);
    api.auth
      .getStaffSession()
      .then((s) => (s && s.shopId === shopId ? { name: s.shopName, pickupBoardToken: s.pickupBoardToken } : null))
      .catch(() => null)
      .then((v) => v ?? api.owner.getShopSettings(shopId).then((o) => ({ name: o.name, pickupBoardToken: o.pickupBoardToken ?? null })))
      .then(set, () => undefined);
    return () => {
      live = false;
    };
  }, [api, shopId]);

  if (!tables.data) return tables.error ? <ErrorState error={tables.error} onRetry={tables.reload} /> : <Loading />;
  if (tables.data.length === 0) return <EmptyState title={t('tables_empty')} />;

  const tiles = tables.data.filter((table) => takeaway || table.kind !== 'counter').flatMap<Tile>((table) =>
    table.openTabs.length ? table.openTabs.map((tab) => ({ key: tab.id, table, tab })) : [{ key: table.tableId, table, tab: null }],
  );
  const token = shop?.pickupBoardToken;

  return (
    <div className="flex flex-col gap-3 p-4">
      {!takeaway && <ProLocked feature="takeaway">{t('pickup_board_open')}</ProLocked>}
      {takeaway && token && (
        <Button variant="secondary" onClick={() => setBoard(true)}>
          {t('pickup_board_open')}
        </Button>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(({ key, table, tab }) => {
          const name = table.kind === 'counter' && tab?.pickupNo ? t('pickup_no', { n: tab.pickupNo }) : table.label;
          const body = (
            <>
              <span className="text-lg font-bold text-stone-900">{name}</span>
              {tab ? (
                <>
                  {tab.pickupAt && <span className="text-sm text-stone-700">{t('pickup_time', { time: hhmm(tab.pickupAt) })}</span>}
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
      {openTab && <TabSheet shopId={shopId} tabId={openTab} shopName={shop?.name ?? ''} onClose={() => setOpenTab(null)} onChanged={tables.reload} />}
      {board && token && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-auto bg-white">
          <div className="p-3">
            <Button variant="secondary" onClick={() => setBoard(false)}>
              {t('pickup_board_close')}
            </Button>
          </div>
          <PickupBoardView boardToken={token} />
        </div>
      )}
    </div>
  );
}
