/** Order line status rules (mirror of SQL `advance_item`) and customer labels. */
import type { ItemStatus } from '../data/types';

const MOVES: Partial<Record<ItemStatus, readonly ItemStatus[]>> = {
  new: ['preparing', 'cancelled'],
  preparing: ['cooking', 'new', 'cancelled'],
  cooking: ['ready', 'preparing', 'cancelled'],
  ready: ['served', 'cooking', 'cancelled'],
};

/** Is from -> to allowed? Staying in the same status is allowed only as a column change. */
export function canMove(from: ItemStatus, to: ItemStatus, withColumn = false): boolean {
  if (from === to) return withColumn;
  return MOVES[from]?.includes(to) ?? false;
}

export type CustomerStatus = 'waiting' | 'received' | 'cooking' | 'ready' | 'served' | 'cancelled';

/** DECISIONS D25. */
export function customerStatus(status: ItemStatus): CustomerStatus {
  switch (status) {
    case 'pending':
      return 'waiting';
    case 'new':
      return 'received';
    case 'preparing':
    case 'cooking':
      return 'cooking';
    default:
      return status;
  }
}
