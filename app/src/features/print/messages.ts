import { defineMessages } from '../../i18n';

type Key =
  | 'ticket_title' | 'bill_title' | 'print' | 'preview_ticket' | 'preview_bill' | 'preview_hint'
  | 'pickup_at' | 'note' | 'total' | 'remaining' | 'rounding' | 'thanks'
  | 'm_cash' | 'm_duitnow' | 'm_card' | 'm_other';

export const usePrintT = defineMessages<Key>('print', {
  en: {
    ticket_title: 'Kitchen ticket', bill_title: 'Bill', print: 'Print', preview_ticket: 'Print ticket', preview_bill: 'Print bill',
    preview_hint: 'Prints on a 58 mm roll. Pick your receipt printer in the print dialog.',
    pickup_at: 'Pickup {time}', note: 'Note: {note}', total: 'Total', remaining: 'Left to pay', rounding: 'Rounding',
    thanks: 'Thank you',
    m_cash: 'Cash', m_duitnow: 'DuitNow QR', m_card: 'Card', m_other: 'Other',
  },
});
