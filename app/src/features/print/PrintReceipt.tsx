import { createPortal } from 'react-dom';
import { formatRM } from '../../lib/money';
import { Button, Sheet } from '../../ui';
import { usePrintT } from './messages';
import './print.css';
import type { BillSlip, Slip, TicketSlip } from './slips';

type T = ReturnType<typeof usePrintT>;
const METHOD_KEY = { cash: 'm_cash', duitnow: 'm_duitnow', card: 'm_card', other: 'm_other' } as const;

function Ticket({ slip, t }: { slip: TicketSlip; t: T }) {
  return (
    <div>
      <p className="text-center text-xs font-bold uppercase">
        {t('ticket_title')}
        {slip.station && ` · ${slip.station}`}
      </p>
      <p className="text-center text-xl font-extrabold">{slip.place}</p>
      <p className="text-center text-xs">
        {slip.time}
        {slip.pickupTime && ` · ${t('pickup_at', { time: slip.pickupTime })}`}
      </p>
      <hr className="my-1 border-dashed border-black" />
      <ul>
        {slip.lines.map((l, i) => (
          <li key={i} className="py-0.5 text-base font-bold">
            {l.qty} × {l.name}
            {l.options.length > 0 && <span className="block text-sm font-normal">{l.options.join(', ')}</span>}
            {l.note && <span className="block text-sm font-normal">{t('note', { note: l.note })}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bill({ slip, t }: { slip: BillSlip; t: T }) {
  const row = (label: string, sen: number, bold = false) => (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span>{formatRM(sen)}</span>
    </div>
  );
  return (
    <div className="text-sm">
      <p className="text-center text-base font-extrabold">{slip.shopName}</p>
      <p className="text-center text-xs">
        {t('bill_title')} · {slip.place} · {slip.time}
      </p>
      <hr className="my-1 border-dashed border-black" />
      <ul>
        {slip.lines.map((l, i) => (
          <li key={i}>{row(`${l.qty} × ${l.name}`, l.totalSen)}</li>
        ))}
      </ul>
      <hr className="my-1 border-dashed border-black" />
      {row(t('total'), slip.totalSen, true)}
      {slip.payments.map((p, i) => (
        <div key={i}>
          {row(t(METHOD_KEY[p.method]), p.amountSen)}
          {p.roundingSen !== 0 && row(t('rounding'), p.roundingSen)}
        </div>
      ))}
      {slip.remainingSen > 0 && row(t('remaining'), slip.remainingSen, true)}
      <p className="mt-2 text-center text-xs">{t('thanks')}</p>
    </div>
  );
}

function Slips({ slips, t }: { slips: Slip[]; t: T }) {
  return slips.map((s, i) => (
    <div key={i} className="slip mb-3 w-[58mm] bg-white p-[3mm] text-black shadow">
      {s.kind === 'ticket' ? <Ticket slip={s} t={t} /> : <Bill slip={s} t={t} />}
    </div>
  ));
}

/** Preview styled as a thermal receipt, plus the print-only root that `window.print()` prints. */
export function PrintSheet({ slips, onClose }: { slips: Slip[] | null; onClose: () => void }) {
  const t = usePrintT();
  return (
    <>
      <Sheet open={!!slips} onClose={onClose} title={slips?.[0]?.kind === 'bill' ? t('preview_bill') : t('preview_ticket')}>
        {slips && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-stone-600">{t('preview_hint')}</p>
            <div data-testid="receipt-preview" className="bg-stone-200 p-3 font-mono">
              <Slips slips={slips} t={t} />
            </div>
            <Button block onClick={() => window.print()}>
              {t('print')}
            </Button>
          </div>
        )}
      </Sheet>
      {slips &&
        createPortal(
          <div id="lapar-print-root" className="font-mono">
            <Slips slips={slips} t={t} />
          </div>,
          document.body,
        )}
    </>
  );
}
