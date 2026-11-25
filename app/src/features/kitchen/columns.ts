/** Pure kitchen column rules. Generic over column lists so custom columns (Pro) work unchanged. */
import { CORE_BOARD_STATUSES, type BoardColumnDTO, type BoardLineDTO, type ItemStatus, type Uuid } from '../../data/types';

export interface Move {
  to: ItemStatus;
  columnId: Uuid | null;
}

/** Sorted columns; falls back to the four fixed ones when the list is empty. */
export function effectiveColumns(columns: readonly BoardColumnDTO[] | null | undefined): BoardColumnDTO[] {
  if (!columns?.length) return CORE_BOARD_STATUSES.map((coreStatus, sort) => ({ id: null, name: null, coreStatus, sort }));
  return [...columns].sort((a, b) => a.sort - b.sort);
}

/** The line's own column, else the first column of its status. */
export function columnIndexOf(line: Pick<BoardLineDTO, 'status' | 'columnId'>, columns: readonly BoardColumnDTO[]): number {
  const own = line.columnId ? columns.findIndex((c) => c.id === line.columnId) : -1;
  if (own >= 0) return own;
  return Math.max(0, columns.findIndex((c) => c.coreStatus === line.status));
}

/** Next column; past the last one the line is served. */
export function nextMove(line: Pick<BoardLineDTO, 'status' | 'columnId'>, columns: readonly BoardColumnDTO[]): Move {
  const next = columns[columnIndexOf(line, columns) + 1];
  return next ? { to: next.coreStatus, columnId: next.id } : { to: 'served', columnId: null };
}

/** Previous column, or null from the first one. */
export function prevMove(line: Pick<BoardLineDTO, 'status' | 'columnId'>, columns: readonly BoardColumnDTO[]): Move | null {
  const prev = columns[columnIndexOf(line, columns) - 1];
  return prev ? { to: prev.coreStatus, columnId: prev.id } : null;
}

export type AgeClass = 'ok' | 'amber' | 'red';
export const ageClass = (minutes: number): AgeClass => (minutes >= 20 ? 'red' : minutes >= 10 ? 'amber' : 'ok');
