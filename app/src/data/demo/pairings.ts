/** `refresh_auto_pairings` (DATA-MODEL 6.5) computed on demand over whatever order history exists. */
import type { AutoPairingRow, DemoState } from './store';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;
const MIN_SUPPORT = 3;
const TOP = 3;

export function computeAutoPairings(s: DemoState, now: Date): AutoPairingRow[] {
  const since = now.getTime() - WINDOW_DAYS * DAY_MS;
  const active = new Set(s.items.filter((i) => i.active).map((i) => i.id));
  const approved = new Set(s.orders.filter((o) => o.status === 'approved' && new Date(o.createdAt).getTime() > since).map((o) => o.id));

  const byOrder = new Map<string, Set<string>>();
  for (const l of s.orderItems) {
    if (!approved.has(l.orderId) || l.status === 'cancelled' || l.kind === 'component' || !active.has(l.itemId)) continue;
    const set = byOrder.get(l.orderId) ?? new Set<string>();
    set.add(l.itemId);
    byOrder.set(l.orderId, set);
  }

  const containing = new Map<string, number>();
  const together = new Map<string, Map<string, number>>();
  for (const items of byOrder.values()) {
    for (const a of items) {
      containing.set(a, (containing.get(a) ?? 0) + 1);
      const row = together.get(a) ?? new Map<string, number>();
      for (const b of items) if (b !== a) row.set(b, (row.get(b) ?? 0) + 1);
      together.set(a, row);
    }
  }

  const out: AutoPairingRow[] = [];
  for (const [source, row] of together) {
    const orders = containing.get(source) ?? 1;
    [...row]
      .filter(([, support]) => support >= MIN_SUPPORT)
      .map(([suggestedItemId, support]) => ({ suggestedItemId, support, confidence: support / orders }))
      .sort((x, y) => y.confidence - x.confidence || y.support - x.support || x.suggestedItemId.localeCompare(y.suggestedItemId))
      .slice(0, TOP)
      .forEach((p, i) => out.push({ sourceItemId: source, suggestedItemId: p.suggestedItemId, position: (i + 1) as 1 | 2 | 3, support: p.support, confidence: p.confidence }));
  }
  return out;
}
