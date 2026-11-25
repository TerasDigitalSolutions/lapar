import type { LineOption, PaidMethod, StationRow, TabDetailDTO } from '../../data/types';
import { mytParts } from '../../lib/time';

export interface TicketSlip {
  kind: 'ticket';
  /** "Table 3" or "Pickup #12". */
  place: string;
  station: string;
  /** HH:MM (MYT) */
  time: string;
  pickupTime: string | null;
  lines: { qty: number; name: string; options: string[]; note: string | null }[];
}

export interface BillSlip {
  kind: 'bill';
  shopName: string;
  place: string;
  time: string;
  lines: { qty: number; name: string; totalSen: number }[];
  totalSen: number;
  payments: { method: PaidMethod; amountSen: number; roundingSen: number }[];
  remainingSen: number;
}

export type Slip = TicketSlip | BillSlip;

export const hhmm = (iso: string): string => {
  const p = mytParts(new Date(iso));
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

interface TicketLine {
  qty: number;
  name: string;
  options: LineOption[];
  note: string | null;
  kind: string;
  stationId: string;
}

/** One ticket per station for an order. Priced set lines are skipped (their components are on the board). */
export function ticketSlips(
  order: { place: string; createdAt: string; pickupAt: string | null; lines: readonly TicketLine[] },
  stations: readonly Pick<StationRow, 'id' | 'name'>[],
): TicketSlip[] {
  const byStation = new Map<string, TicketLine[]>();
  for (const l of order.lines.filter((x) => x.kind !== 'combo')) byStation.set(l.stationId, [...(byStation.get(l.stationId) ?? []), l]);
  return [...byStation].map(([id, lines]) => ({
    kind: 'ticket',
    place: order.place,
    station: stations.find((s) => s.id === id)?.name ?? '',
    time: hhmm(order.createdAt),
    pickupTime: order.pickupAt ? hhmm(order.pickupAt) : null,
    lines: lines.map((l) => ({ qty: l.qty, name: l.name, options: l.options.map((o) => o.name), note: l.note })),
  }));
}

export function billSlip(tab: TabDetailDTO, shopName: string, place: string): BillSlip {
  return {
    kind: 'bill',
    shopName,
    place,
    time: hhmm(tab.serverNow),
    lines: tab.orders
      .filter((o) => o.status === 'approved')
      .flatMap((o) => o.lines)
      .filter((l) => l.kind !== 'component' && l.status !== 'cancelled')
      .map((l) => ({ qty: l.qty, name: l.name, totalSen: l.lineTotalSen })),
    totalSen: tab.totalSen,
    payments: tab.payments.map((p) => ({ method: p.method, amountSen: p.amountSen, roundingSen: p.roundingSen })),
    remainingSen: tab.remainingSen,
  };
}
