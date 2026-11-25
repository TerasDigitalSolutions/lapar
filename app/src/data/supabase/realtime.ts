import type { ConnectionState, ShopChange, ShopTable, Unsubscribe, Uuid } from '../types';
import { getClient } from './client';

const TABLES: ShopTable[] = ['orders', 'order_items', 'service_requests', 'tabs'];

/** One channel `shop:<id>` with postgres_changes for the four live tables (ARCHITECTURE 8). */
export function subscribeShop(
  shopId: Uuid,
  onChange: (change: ShopChange) => void,
  onState?: (state: ConnectionState) => void,
): Unsubscribe {
  let stopped = false;
  let teardown: (() => void) | undefined;
  onState?.('connecting');
  void getClient()
    .then((c) => {
      if (stopped) return;
      const channel = c.channel(`shop:${shopId}`);
      for (const table of TABLES) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `shop_id=eq.${shopId}` }, (p) => {
          const row = (p.eventType === 'DELETE' ? p.old : p.new) as { id?: string };
          onChange({ table, event: p.eventType, id: row.id ?? '' });
        });
      }
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') onState?.('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onState?.('offline');
      });
      teardown = () => void c.removeChannel(channel);
    })
    .catch(() => onState?.('offline'));
  return () => {
    stopped = true;
    teardown?.();
  };
}
