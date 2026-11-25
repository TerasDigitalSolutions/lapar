import { expect, test } from 'vitest';
import type { BoardColumnDTO } from '../../data/types';
import { ageClass, columnIndexOf, effectiveColumns, nextMove, prevMove } from './columns';

const fixed = effectiveColumns([]);
const custom: BoardColumnDTO[] = [
  { id: 'c3', name: 'Plating', coreStatus: 'ready', sort: 3 },
  { id: 'c1', name: 'Queue', coreStatus: 'new', sort: 1 },
  { id: 'c2', name: 'Wok', coreStatus: 'cooking', sort: 2 },
];
const cols = effectiveColumns(custom);

test('effectiveColumns: four fixed by default, custom sorted', () => {
  expect(fixed.map((c) => c.coreStatus)).toEqual(['new', 'preparing', 'cooking', 'ready']);
  expect(cols.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
});

test('columnIndexOf: own column, else first of status', () => {
  expect(columnIndexOf({ status: 'cooking', columnId: null }, fixed)).toBe(2);
  expect(columnIndexOf({ status: 'cooking', columnId: 'c2' }, cols)).toBe(1);
  expect(columnIndexOf({ status: 'ready', columnId: null }, cols)).toBe(2);
});

test('nextMove and prevMove', () => {
  expect(nextMove({ status: 'new', columnId: null }, fixed)).toEqual({ to: 'preparing', columnId: null });
  expect(nextMove({ status: 'ready', columnId: null }, fixed)).toEqual({ to: 'served', columnId: null });
  expect(nextMove({ status: 'new', columnId: 'c1' }, cols)).toEqual({ to: 'cooking', columnId: 'c2' });
  expect(prevMove({ status: 'new', columnId: null }, fixed)).toBeNull();
  expect(prevMove({ status: 'ready', columnId: 'c3' }, cols)).toEqual({ to: 'cooking', columnId: 'c2' });
});

test('ageClass thresholds', () => {
  expect([9, 10, 19, 20].map(ageClass)).toEqual(['ok', 'amber', 'amber', 'red']);
});
