import { useState } from 'react';
import { toLaparError } from '../../data/hooks';
import { useData } from '../../data/context';
import type { CustomerTabDTO, ServiceReason } from '../../data/types';
import { formatRM } from '../../lib/money';
import { customerStatus, type CustomerStatus } from '../../lib/status';
import { Banner, Button, EmptyState, ErrorState, Field, Loading, Sheet, inputClass } from '../../ui';
import { useT } from './messages';

const STATUS_KEY = {
  waiting: 'status_waiting',
  received: 'status_received',
  cooking: 'status_cooking',
  ready: 'status_ready',
  served: 'status_served',
  cancelled: 'status_cancelled',
} as const satisfies Record<CustomerStatus, string>;

const STATUS_TONE: Record<CustomerStatus, string> = {
  waiting: 'bg-amber-100 text-amber-900',
  received: 'bg-sky-100 text-sky-900',
  cooking: 'bg-orange-100 text-orange-900',
  ready: 'bg-green-100 text-green-900',
  served: 'bg-stone-200 text-stone-800',
  cancelled: 'bg-red-100 text-red-900',
};

/** Orders, line statuses and the running bill. */
export function StatusPanel({ tab, error, onRetry, sent }: { tab: CustomerTabDTO | null; error: unknown; onRetry: () => void; sent: boolean }) {
  const t = useT();
  if (!tab) return error ? <ErrorState error={error} onRetry={onRetry} /> : <Loading />;
  return (
    <div className="flex flex-col gap-4 p-4">
      {sent && <Banner kind="info">{t('order_sent')}</Banner>}
      {tab.orders.length === 0 && <EmptyState title={t('status_empty')}>{t('status_empty_body')}</EmptyState>}
      {tab.orders.map((o) => (
        <section key={o.id} className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3">
          {o.status === 'rejected' && <Banner kind="error">{o.rejectedReason ? t('order_rejected_reason', { reason: o.rejectedReason }) : t('order_rejected')}</Banner>}
          <ul className="flex flex-col gap-2">
            {o.lines.map((l) => {
              const s = customerStatus(l.status);
              return (
                <li key={l.id} className={`flex items-start justify-between gap-3 ${l.kind === 'component' ? 'pl-4 text-sm' : ''}`}>
                  <span className="min-w-0">
                    {l.qty} x {l.name}
                    {l.options.length > 0 && <span className="block text-sm text-stone-600">{l.options.map((x) => x.name).join(', ')}</span>}
                    {l.note && <span className="block text-sm text-stone-600">“{l.note}”</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_TONE[s]}`}>{t(STATUS_KEY[s])}</span>
                    {l.kind !== 'component' && <span className="text-sm">{formatRM(l.lineTotalSen)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {tab.tab && tab.orders.length > 0 && (
        <section aria-label={t('bill')} className="flex flex-col gap-1 rounded-xl bg-stone-100 p-4">
          <div className="flex justify-between text-xl font-bold">
            <span>{t('bill_total')}</span>
            <span>{formatRM(tab.tab.totalSen)}</span>
          </div>
          {tab.tab.pendingSen > 0 && (
            <div className="flex justify-between text-stone-700">
              <span>{t('bill_pending')}</span>
              <span>{formatRM(tab.tab.pendingSen)}</span>
            </div>
          )}
          {tab.tab.paidSen > 0 && (
            <div className="flex justify-between text-stone-700">
              <span>{t('bill_paid')}</span>
              <span>{formatRM(tab.tab.paidSen)}</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Bill / Water / Other buttons and the open requests. Repeat taps merge on the server. */
export function CallPanel({ token, tab, onCalled }: { token: string; tab: CustomerTabDTO | null; onCalled: () => void }) {
  const t = useT();
  const data = useData();
  const [note, setNote] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const REASONS = { bill: t('call_bill'), water: t('call_water'), other: t('call_other') } as const;

  async function call(reason: ServiceReason, text?: string) {
    setBusy(true);
    try {
      await data.customer.callServer(token, reason, text || null);
      setMsg({ kind: 'info', text: t('call_done') });
      setNote(null);
      onCalled();
    } catch (e) {
      setMsg({ kind: 'error', text: toLaparError(e).code === 'shop_inactive' ? t('err_shop_inactive') : t('call_error') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-bold">{t('call_title')}</h2>
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <div className="grid gap-3">
        <Button disabled={busy} className="min-h-16 text-lg" onClick={() => call('bill')}>
          {REASONS.bill}
        </Button>
        <Button disabled={busy} className="min-h-16 text-lg" onClick={() => call('water')}>
          {REASONS.water}
        </Button>
        <Button disabled={busy} variant="secondary" className="min-h-16 text-lg" onClick={() => setNote('')}>
          {REASONS.other}
        </Button>
      </div>
      {tab && tab.openRequests.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('open_requests')}</h3>
          <ul aria-label={t('open_requests')} className="flex flex-col gap-2">
            {tab.openRequests.map((r) => (
              <li key={r.reason} className="flex justify-between rounded-xl border border-stone-200 bg-white p-3">
                <span className="font-semibold">{REASONS[r.reason]}</span>
                <span className="text-stone-700">{r.status === 'acknowledged' ? t('req_acknowledged') : t('req_open')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Sheet open={note !== null} onClose={() => setNote(null)} title={t('call_other_title')}>
        <div className="flex flex-col gap-4">
          <Field label={t('note')} hint={t('note_count', { n: (note ?? '').length })}>
            {(p) => <textarea {...p} className={inputClass} rows={3} maxLength={140} value={note ?? ''} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <Button block disabled={busy} onClick={() => call('other', note?.trim())}>
            {t('call_send')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
