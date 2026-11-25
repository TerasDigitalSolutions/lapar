import type { ConnectionState, ShopChange, ShopTable, Unsubscribe, Uuid } from '../types';
import { getClient } from './client';

const TABLES: ShopTable[] = ['orders', 'order_items', 'service_requests', 'tabs'];

interface Sub {
  onChange: (change: ShopChange) => void;
  onState?: (state: ConnectionState) => void;
}
interface Shared {
  subs: Set<Sub>;
  state: ConnectionState;
  /** Set once the channel exists; undefined while the client is still loading. */
  close?: () => void;
}

// One channel per shop per device, shared by every subscriber (each delivery counts against the
// Realtime message quota, and staff screens hold 3-4 subscriptions). Subscribing the same topic twice
// would also fail in supabase-js, so later subscribers only add a listener (DECISIONS B3).
const shared = new Map<Uuid, Shared>();

/** `shop:<id>` with postgres_changes for the four live tables (ARCHITECTURE 8), ref-counted across subscribers. */
export function subscribeShop(
  shopId: Uuid,
  onChange: (change: ShopChange) => void,
  onState?: (state: ConnectionState) => void,
): Unsubscribe {
  const sub: Sub = { onChange, onState };
  let entry = shared.get(shopId);
  if (!entry) {
    const e: Shared = { subs: new Set(), state: 'connecting' };
    entry = e;
    shared.set(shopId, e);
    const setState = (state: ConnectionState) => {
      e.state = state;
      e.subs.forEach((x) => x.onState?.(state));
    };
    void getClient()
      .then((c) => {
        if (shared.get(shopId) !== e) return; // everyone left while the client loaded
        const channel = c.channel(`shop:${shopId}`);
        for (const table of TABLES) {
          channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `shop_id=eq.${shopId}` }, (p) => {
            const row = (p.eventType === 'DELETE' ? p.old : p.new) as { id?: string };
            e.subs.forEach((x) => x.onChange({ table, event: p.eventType, id: row.id ?? '' }));
          });
        }
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') setState('live');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setState('offline');
        });
        e.close = () => void c.removeChannel(channel);
      })
      .catch(() => shared.get(shopId) === e && setState('offline'));
  }
  const mine = entry;
  mine.subs.add(sub);
  onState?.(mine.state);
  return () => {
    if (!mine.subs.delete(sub) || mine.subs.size) return;
    if (shared.get(shopId) === mine) shared.delete(shopId);
    mine.close?.();
  };
}
