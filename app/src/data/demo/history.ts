/**
 * Thirty days of generated order history (card M1-L fills this in). Rows it returns must have ids
 * starting with HISTORY_PREFIX so index.ts can merge them at load and never persist them.
 */
import type { IsoDate } from '../types';
import type { DemoState, HistoryRows } from './store';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function generateHistory(_state: DemoState, _today: IsoDate): HistoryRows {
  return { tabs: [], orders: [], orderItems: [], payments: [] };
}
