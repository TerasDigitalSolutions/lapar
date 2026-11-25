import { CORE_BOARD_STATUSES, type BoardColumnInput, type BoardStatus } from '../../../data/types';

/** One editable column. `key` is a stable React key; `id` is null for a column not saved yet. */
export interface Col {
  key: string;
  id: string | null;
  name: string;
  coreStatus: BoardStatus;
}

export const COLUMNS_MAX = 12;
export const COLUMN_NAME_MAX = 24;

const rank = (s: BoardStatus) => CORE_BOARD_STATUSES.indexOf(s);

/** Every status keeps one column, so a column can go only when another one has its status. */
export const canRemove = (cols: readonly Col[], index: number): boolean => cols.some((c, i) => i !== index && c.coreStatus === cols[index]!.coreStatus);

export const canAdd = (cols: readonly Col[]): boolean => cols.length < COLUMNS_MAX;

/** A new column of the same step right after `index`. */
export function addAfter(cols: readonly Col[], index: number, key: string): Col[] {
  const next = [...cols];
  next.splice(index + 1, 0, { key, id: null, name: '', coreStatus: cols[index]!.coreStatus });
  return next;
}

/** The list with the column at `index` moved by `delta`; null when it would leave the list or put steps out of order. */
export function moveColumn(cols: readonly Col[], index: number, delta: -1 | 1): Col[] | null {
  const to = index + delta;
  if (to < 0 || to >= cols.length) return null;
  const next = [...cols];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next.every((c, i) => i === 0 || rank(next[i - 1]!.coreStatus) <= rank(c.coreStatus)) ? next : null;
}

/** First problem with the names, or null. */
export function columnNameError(cols: readonly Col[]): 'column_name_required' | 'column_name_long' | null {
  if (cols.some((c) => !c.name.trim())) return 'column_name_required';
  if (cols.some((c) => c.name.trim().length > COLUMN_NAME_MAX)) return 'column_name_long';
  return null;
}

export const toInput = (cols: readonly Col[]): BoardColumnInput[] => cols.map((c) => ({ id: c.id, name: c.name.trim(), coreStatus: c.coreStatus }));
