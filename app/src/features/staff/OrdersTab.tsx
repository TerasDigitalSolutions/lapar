import { useState } from 'react';
import { useData } from '../../data/context';
import { useLiveQuery, usePolling } from '../../data/hooks';
import type { BoardLineDTO, LineOption, PendingOrderDTO, ServiceReason, ServiceRequestDTO } from '../../data/types';
import { minutesSince } from '../../lib/time';
import { useFeature } from '../../entitlements/hooks';
import { Button, ErrorState, Sheet, useToast } from '../../ui';
import { hhmm, PrintSheet, ticketSlips, type Slip } from '../print';
import { useErrorText } from './errors';
import { useStaffT } from './messages';

/** Re-renders every 30 s so "minutes waiting" stays current. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  usePolling(() => setNow(new Date()), 30_000);
  return now;
}

export const lineLabel = (name: string, qty: number, options: LineOption[]) =>
  `${qty} × ${name}${options.length ? ` (${options.map((o) => o.name).join(', ')})` : ''}`;

const REASON_MAX = 140;

function Waiting({ since, now }: { since: string; now: Date }) {
  const t = useStaffT();
  const n = minutesSince(since, now);
  return <span className={`text-sm font-bold ${n >= 5 ? 'text-red-700' : 'text-stone-600'}`}>{n < 1 ? t('just_now') : t('waiting_min', { n })}</span>;
}

function RejectSheet({ order, onClose, onDone }: { order: PendingOrderDTO | null; onClose: () => void; onDone: (orderId: string, reason: string) => void }) {
  const t = useStaffT();
  const [reason, setReason] = useState('');
  const [showError, setShowError] = useState(false);
  const quick = [t('reason_sold_out'), t('reason_closed'), t('reason_busy')];
  return (
    <Sheet open={order !== null} onClose={onClose} title={t('reject_title')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <Button key={q} variant={reason === q ? 'primary' : 'secondary'} onClick={() => setReason(q)}>
              {q}
            </Button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-base font-semibold text-stone-800">
          {t('reject_free')}
          <textarea
            value={reason}
            maxLength={REASON_MAX}
            rows={2}
            aria-invalid={showError && !reason.trim() ? true : undefined}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-12 rounded-xl border border-stone-300 p-3 text-base font-normal"
          />
          <span className="text-sm font-normal text-stone-600">{t('reject_free_hint')}</span>
        </label>
        {showError && !reason.trim() && <p role="alert" className="text-sm font-medium text-red-700">{t('reason_required')}</p>}
        <Button
          variant="danger"
          block
          onClick={() => {
            if (!reason.trim()) return setShowError(true);
            if (order) onDone(order.orderId, reason.trim());
            setReason('');
            setShowError(false);
          }}
        >
          {t('reject_confirm')}
        </Button>
      </div>
    </Sheet>
  );
}

const CALL_KEY = { bill: 'call_bill', water: 'call_water', other: 'call_other' } as const satisfies Record<ServiceReason, string>;

export function OrdersTab({ shopId, pending, calls, reload }: { shopId: string; pending: PendingOrderDTO[]; calls: ServiceRequestDTO[]; reload: () => void }) {
  const t = useStaffT();
  const api = useData().staff;
  const toast = useToast();
  const now = useNow();
  const errorText = useErrorText();
  const printing = useFeature('printing');
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [rejecting, setRejecting] = useState<PendingOrderDTO | null>(null);
  const ready = useLiveQuery(() => api.listReadyLines(shopId), { shopId, tables: ['orders', 'order_items'] });

  const run = (fn: () => Promise<void>) =>
    fn().then(
      () => (reload(), true),
      (e: unknown) => {
        toast(errorText(e), 'error');
        reload();
        return false;
      },
    );

  const grouped = new Map<string, BoardLineDTO[]>();
  for (const l of ready.data ?? []) grouped.set(l.orderId, [...(grouped.get(l.orderId) ?? []), l]);
  const place = (o: { tableKind: string; tableLabel: string; pickupNo: number | null }) =>
    o.tableKind === 'counter' && o.pickupNo ? t('pickup_no', { n: o.pickupNo }) : o.tableLabel;
  const approve = async (o: PendingOrderDTO) => {
    if (!(await run(() => api.approveOrder(o.orderId))) || !printing) return;
    // Station names only head the ticket; a failed lookup must not hide the preview.
    const stations = await api.listStations(shopId).catch(() => []);
    setSlips(ticketSlips({ place: place(o), createdAt: o.createdAt, pickupAt: o.pickupAt, lines: o.lines }, stations));
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <section aria-labelledby="sec-approvals" className="flex flex-col gap-3">
        <h2 id="sec-approvals" className="text-lg font-bold text-stone-900">{t('approvals')}</h2>
        {pending.length === 0 && <p className="text-stone-600">{t('no_approvals')}</p>}
        <ul className="flex flex-col gap-3">
          {pending.map((o) => (
            <li key={o.orderId} data-testid="pending-order" className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xl font-bold text-stone-900">{place(o)}</span>
                <Waiting since={o.createdAt} now={now} />
              </div>
              {o.pickupAt && <p className="text-sm font-semibold text-stone-700">{t('pickup_time', { time: hhmm(o.pickupAt) })}</p>}
              <ul className="my-2 text-base text-stone-800">
                {o.lines.map((l) => (
                  <li key={l.id} className={l.kind === 'component' ? 'ml-4 text-stone-600' : undefined}>
                    {lineLabel(l.name, l.qty, l.options)}
                    {l.note && <span className="block text-sm text-stone-600">“{l.note}”</span>}
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={() => void approve(o)}>{t('approve')}</Button>
                <Button variant="secondary" onClick={() => setRejecting(o)}>{t('reject')}</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sec-calls" className="flex flex-col gap-3">
        <h2 id="sec-calls" className="text-lg font-bold text-stone-900">{t('calls')}</h2>
        {calls.length === 0 && <p className="text-stone-600">{t('no_calls')}</p>}
        <ul className="flex flex-col gap-3">
          {calls.map((c) => (
            <li key={c.id} className={`rounded-2xl border-2 p-4 ${c.status === 'open' ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-white'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xl font-bold text-stone-900">{c.tableLabel}: {t(CALL_KEY[c.reason])}</span>
                <Waiting since={c.createdAt} now={now} />
              </div>
              {c.note && <p className="text-base text-stone-800">“{c.note}”</p>}
              {c.tapCount > 1 && <p className="text-sm font-semibold text-red-700">{t('call_taps', { n: c.tapCount })}</p>}
              {c.status === 'acknowledged' && <p className="text-sm text-stone-600">{t('call_ack')}</p>}
              <div className="mt-2 grid grid-cols-2 gap-3">
                {c.status === 'open' ? (
                  <Button variant="secondary" onClick={() => void run(() => api.acknowledgeRequest(c.id))}>{t('ack')}</Button>
                ) : (
                  <span />
                )}
                <Button onClick={() => void run(() => api.completeRequest(c.id))}>{t('done')}</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sec-serve" className="flex flex-col gap-3">
        <h2 id="sec-serve" className="text-lg font-bold text-stone-900">{t('to_serve')}</h2>
        {ready.error && !ready.data && <ErrorState error={ready.error} onRetry={ready.reload} />}
        {ready.data && ready.data.length === 0 && <p className="text-stone-600">{t('nothing_to_serve')}</p>}
        <ul className="flex flex-col gap-3">
          {[...grouped.values()].map((lines) => {
            const first = lines[0]!;
            return (
              <li key={first.orderId} className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
                <span className="text-xl font-bold text-stone-900">{place(first)}</span>
                <ul className="mt-2 flex flex-col gap-2">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3">
                      <span className="text-base text-stone-800">{lineLabel(l.name, l.qty, l.options)}</span>
                      <Button aria-label={t('serve_aria', { name: l.name })} onClick={() => void run(() => api.advanceItem(l.id, 'served'))}>
                        {t('serve')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>

      <PrintSheet slips={slips} onClose={() => setSlips(null)} />
      <RejectSheet
        order={rejecting}
        onClose={() => setRejecting(null)}
        onDone={(id, reason) => {
          setRejecting(null);
          void run(() => api.rejectOrder(id, reason));
        }}
      />
    </div>
  );
}
