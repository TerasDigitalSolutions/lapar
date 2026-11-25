/** In-memory change emitter behind `subscribeShop` and the demo's `onChange`. */
import type { ConnectionState, ShopChange, Unsubscribe } from '../types';

export interface Emitter {
  /** Tell shop subscribers about row changes, then every `onChange` listener. */
  emit(...changes: ShopChange[]): void;
  subscribeShop(onChange: (change: ShopChange) => void, onState?: (state: ConnectionState) => void): Unsubscribe;
  onChange(listener: () => void): Unsubscribe;
}

export function createEmitter(): Emitter {
  const shop = new Set<(change: ShopChange) => void>();
  const any = new Set<() => void>();
  return {
    emit(...changes) {
      for (const change of changes) for (const fn of [...shop]) fn(change);
      for (const fn of [...any]) fn();
    },
    subscribeShop(onChange, onState) {
      shop.add(onChange);
      onState?.('live');
      return () => void shop.delete(onChange);
    },
    onChange(listener) {
      any.add(listener);
      return () => void any.delete(listener);
    },
  };
}
